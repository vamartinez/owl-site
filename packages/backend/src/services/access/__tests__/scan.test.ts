/**
 * Unit tests for the scan session module.
 * Verifies scan session persistence with status, scan timestamp, worker ID, and site ID.
 *
 * Requirements: 5.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from '../../../../tests/helpers/mock-dynamo.js';
import { createMockClaims } from '../../../../tests/helpers/mock-user.js';

// Mock the dynamo-client module before importing the scan-session module
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock uuid to return deterministic IDs
vi.mock('uuid', () => ({
  v4: () => 'generated-session-id-001',
}));

import { recordScanSession, detectReplay, getScanSessionsForWorker, getScanSessionsForSite } from '../scan-session.js';
import type { ScanSession } from '../types.js';

describe('scan-session: recordScanSession', () => {
  const putCapture: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    setupDynamoMock({ putCapture });
    putCapture.length = 0;
  });

  it('persists a scan session with status and scan timestamp', async () => {
    const timestamp = '2024-06-15T10:30:00.000Z';
    const sessionInput: Omit<ScanSession, 'session_id'> = {
      tenant_id: 'tenant-001',
      worker_id: 'worker-001',
      site_id: 'site-001',
      timestamp,
      scanner_type: 'qr',
      device_id: 'device-abc',
      token_ref: 'token-001',
      decision_ref: 'decision-001',
      result: 'allowed',
      replay_risk_flag: false,
    };

    const result = await recordScanSession(sessionInput);

    // Verify session is persisted via PutCommand
    const calls = getDynamoCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].command).toBe('PutCommand');

    const putInput = calls[0].input as Record<string, unknown>;
    expect(putInput.TableName).toBe('test-ScanSessions');

    const item = putInput.Item as Record<string, unknown>;
    // Verify status (result) is persisted
    expect(item.result).toBe('allowed');
    // Verify scan timestamp is persisted
    expect(item.timestamp).toBe(timestamp);
    // Verify worker ID is persisted
    expect(item.worker_id).toBe('worker-001');
    // Verify site ID is persisted
    expect(item.site_id).toBe('site-001');
  });

  it('generates a session_id and returns the full session record', async () => {
    const sessionInput: Omit<ScanSession, 'session_id'> = {
      tenant_id: 'tenant-001',
      worker_id: 'worker-002',
      site_id: 'site-002',
      timestamp: '2024-06-15T11:00:00.000Z',
      scanner_type: 'sms',
      device_id: 'device-xyz',
      token_ref: 'token-002',
      decision_ref: 'decision-002',
      result: 'denied',
      replay_risk_flag: true,
    };

    const result = await recordScanSession(sessionInput);

    expect(result.session_id).toBe('generated-session-id-001');
    expect(result.tenant_id).toBe('tenant-001');
    expect(result.worker_id).toBe('worker-002');
    expect(result.site_id).toBe('site-002');
    expect(result.timestamp).toBe('2024-06-15T11:00:00.000Z');
    expect(result.result).toBe('denied');
    expect(result.replay_risk_flag).toBe(true);
  });

  it('stores correct partition key with tenant prefix', async () => {
    const sessionInput: Omit<ScanSession, 'session_id'> = {
      tenant_id: 'tenant-abc',
      worker_id: 'worker-100',
      site_id: 'site-100',
      timestamp: '2024-07-01T08:00:00.000Z',
      scanner_type: 'gate_pass',
      device_id: 'device-gate-1',
      token_ref: 'token-100',
      decision_ref: 'decision-100',
      result: 'conditional',
      replay_risk_flag: false,
    };

    await recordScanSession(sessionInput);

    const calls = getDynamoCalls();
    const item = (calls[0].input as Record<string, unknown>).Item as Record<string, unknown>;
    expect(item.PK).toBe('TENANT#tenant-abc');
    expect(item.SK).toBe('SESSION#generated-session-id-001');
  });

  it('stores GSI keys for worker, site, and token lookups', async () => {
    const timestamp = '2024-08-01T12:00:00.000Z';
    const sessionInput: Omit<ScanSession, 'session_id'> = {
      tenant_id: 'tenant-001',
      worker_id: 'worker-050',
      site_id: 'site-050',
      timestamp,
      scanner_type: 'manual',
      device_id: 'device-manual',
      token_ref: 'token-050',
      decision_ref: 'decision-050',
      result: 'allowed',
      replay_risk_flag: false,
    };

    await recordScanSession(sessionInput);

    const calls = getDynamoCalls();
    const item = (calls[0].input as Record<string, unknown>).Item as Record<string, unknown>;
    expect(item.GSI1PK).toBe('WORKER#worker-050');
    expect(item.GSI1SK).toBe(`SESSION#${timestamp}`);
    expect(item.GSI2PK).toBe('SITE#site-050');
    expect(item.GSI2SK).toBe(`SESSION#${timestamp}`);
    expect(item.GSI3PK).toBe('TOKEN#token-050');
    expect(item.GSI3SK).toBe(`SESSION#${timestamp}`);
  });

  it('persists denied result with replay_risk_flag set to true', async () => {
    const sessionInput: Omit<ScanSession, 'session_id'> = {
      tenant_id: 'tenant-001',
      worker_id: 'worker-001',
      site_id: 'site-001',
      timestamp: '2024-06-15T10:30:00.000Z',
      scanner_type: 'qr',
      device_id: 'device-abc',
      token_ref: 'token-replay',
      decision_ref: 'decision-replay',
      result: 'denied',
      replay_risk_flag: true,
    };

    await recordScanSession(sessionInput);

    const calls = getDynamoCalls();
    const item = (calls[0].input as Record<string, unknown>).Item as Record<string, unknown>;
    expect(item.result).toBe('denied');
    expect(item.replay_risk_flag).toBe(true);
  });
});

describe('scan-session: detectReplay', () => {
  beforeEach(() => {
    resetDynamoMock();
  });

  it('returns isReplay=false when no previous sessions exist for token', async () => {
    setupDynamoMock({
      queryResponses: new Map([
        [
          JSON.stringify({
            TableName: 'test-ScanSessions',
            IndexName: 'GSI3',
            ExpressionAttributeValues: { ':tokenPk': 'TOKEN#token-new' },
          }),
          [],
        ],
      ]),
    });

    const result = await detectReplay('tenant-001', 'token-new', 'device-abc');
    expect(result.isReplay).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('returns isReplay=true when token was previously used from different device', async () => {
    setupDynamoMock({
      queryResponses: new Map([
        [
          JSON.stringify({
            TableName: 'test-ScanSessions',
            IndexName: 'GSI3',
            ExpressionAttributeValues: { ':tokenPk': 'TOKEN#token-used' },
          }),
          [{ device_id: 'device-original', session_id: 'session-prev' }],
        ],
      ]),
    });

    const result = await detectReplay('tenant-001', 'token-used', 'device-different');
    expect(result.isReplay).toBe(true);
    expect(result.reason).toContain('different device');
  });

  it('returns isReplay=true when token was previously used from same device', async () => {
    setupDynamoMock({
      queryResponses: new Map([
        [
          JSON.stringify({
            TableName: 'test-ScanSessions',
            IndexName: 'GSI3',
            ExpressionAttributeValues: { ':tokenPk': 'TOKEN#token-reused' },
          }),
          [{ device_id: 'device-same', session_id: 'session-prev' }],
        ],
      ]),
    });

    const result = await detectReplay('tenant-001', 'token-reused', 'device-same');
    expect(result.isReplay).toBe(true);
    expect(result.reason).toContain('already been used');
  });
});

describe('scan-session: getScanSessionsForWorker', () => {
  beforeEach(() => {
    resetDynamoMock();
  });

  it('returns empty array when no sessions exist for worker', async () => {
    setupDynamoMock({
      queryResponses: new Map([
        [
          JSON.stringify({
            TableName: 'test-ScanSessions',
            IndexName: 'GSI1',
            ExpressionAttributeValues: { ':workerPk': 'WORKER#worker-no-sessions' },
          }),
          [],
        ],
      ]),
    });

    const result = await getScanSessionsForWorker('tenant-001', 'worker-no-sessions');
    expect(result).toEqual([]);
  });

  it('returns sessions for the specified worker', async () => {
    const sessions = [
      { session_id: 's1', worker_id: 'worker-001', site_id: 'site-001', timestamp: '2024-06-15T10:00:00.000Z', result: 'allowed' },
      { session_id: 's2', worker_id: 'worker-001', site_id: 'site-002', timestamp: '2024-06-15T11:00:00.000Z', result: 'denied' },
    ];

    setupDynamoMock({
      queryResponses: new Map([
        [
          JSON.stringify({
            TableName: 'test-ScanSessions',
            IndexName: 'GSI1',
            ExpressionAttributeValues: { ':workerPk': 'WORKER#worker-001' },
          }),
          sessions,
        ],
      ]),
    });

    const result = await getScanSessionsForWorker('tenant-001', 'worker-001');
    expect(result).toHaveLength(2);
    expect(result[0].session_id).toBe('s1');
    expect(result[1].session_id).toBe('s2');
  });
});

describe('scan-session: getScanSessionsForSite', () => {
  beforeEach(() => {
    resetDynamoMock();
  });

  it('returns empty array when no sessions exist for site', async () => {
    setupDynamoMock({
      queryResponses: new Map([
        [
          JSON.stringify({
            TableName: 'test-ScanSessions',
            IndexName: 'GSI2',
            ExpressionAttributeValues: { ':sitePk': 'SITE#site-empty' },
          }),
          [],
        ],
      ]),
    });

    const result = await getScanSessionsForSite('tenant-001', 'site-empty');
    expect(result).toEqual([]);
  });

  it('returns sessions for the specified site', async () => {
    const sessions = [
      { session_id: 's1', worker_id: 'worker-001', site_id: 'site-001', timestamp: '2024-06-15T10:00:00.000Z', result: 'allowed' },
    ];

    setupDynamoMock({
      queryResponses: new Map([
        [
          JSON.stringify({
            TableName: 'test-ScanSessions',
            IndexName: 'GSI2',
            ExpressionAttributeValues: { ':sitePk': 'SITE#site-001' },
          }),
          sessions,
        ],
      ]),
    });

    const result = await getScanSessionsForSite('tenant-001', 'site-001');
    expect(result).toHaveLength(1);
    expect(result[0].site_id).toBe('site-001');
  });
});
