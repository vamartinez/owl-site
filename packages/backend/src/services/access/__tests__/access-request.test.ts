/**
 * Unit tests for the access request module.
 * Verifies that decision records are created with the correct worker, site,
 * timestamp, and decision result.
 *
 * Requirements: 5.1
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from '../../../../tests/helpers/mock-dynamo';
import { createMockClaims } from '../../../../tests/helpers/mock-user';

// Mock the DynamoDB client before importing modules under test
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock uuid to produce predictable IDs
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'generated-uuid-001'),
}));

import { recordScanSession } from '../scan-session';

describe('Access Request Module — Decision Record Creation', () => {
  beforeEach(() => {
    resetDynamoMock();
  });

  describe('recordScanSession creates decision records', () => {
    it('creates a decision record with the correct worker ID', async () => {
      const putCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({ putCapture });

      await recordScanSession({
        tenant_id: 'tenant-test',
        worker_id: 'worker-abc-123',
        site_id: 'site-xyz-789',
        timestamp: '2024-06-15T10:30:00.000Z',
        scanner_type: 'qr',
        device_id: 'device-001',
        token_ref: 'token-ref-001',
        decision_ref: 'decision-ref-001',
        result: 'allowed',
        replay_risk_flag: false,
      });

      expect(putCapture).toHaveLength(1);
      const item = putCapture[0].Item as Record<string, unknown>;
      expect(item.worker_id).toBe('worker-abc-123');
    });

    it('creates a decision record with the correct site ID', async () => {
      const putCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({ putCapture });

      await recordScanSession({
        tenant_id: 'tenant-test',
        worker_id: 'worker-abc-123',
        site_id: 'site-xyz-789',
        timestamp: '2024-06-15T10:30:00.000Z',
        scanner_type: 'qr',
        device_id: 'device-001',
        token_ref: 'token-ref-001',
        decision_ref: 'decision-ref-001',
        result: 'allowed',
        replay_risk_flag: false,
      });

      expect(putCapture).toHaveLength(1);
      const item = putCapture[0].Item as Record<string, unknown>;
      expect(item.site_id).toBe('site-xyz-789');
    });

    it('creates a decision record with the correct timestamp', async () => {
      const putCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({ putCapture });

      const timestamp = '2024-06-15T10:30:00.000Z';

      await recordScanSession({
        tenant_id: 'tenant-test',
        worker_id: 'worker-abc-123',
        site_id: 'site-xyz-789',
        timestamp,
        scanner_type: 'qr',
        device_id: 'device-001',
        token_ref: 'token-ref-001',
        decision_ref: 'decision-ref-001',
        result: 'allowed',
        replay_risk_flag: false,
      });

      expect(putCapture).toHaveLength(1);
      const item = putCapture[0].Item as Record<string, unknown>;
      expect(item.timestamp).toBe(timestamp);
    });

    it('creates a decision record with a decision result', async () => {
      const putCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({ putCapture });

      await recordScanSession({
        tenant_id: 'tenant-test',
        worker_id: 'worker-abc-123',
        site_id: 'site-xyz-789',
        timestamp: '2024-06-15T10:30:00.000Z',
        scanner_type: 'qr',
        device_id: 'device-001',
        token_ref: 'token-ref-001',
        decision_ref: 'decision-ref-001',
        result: 'denied',
        replay_risk_flag: false,
      });

      expect(putCapture).toHaveLength(1);
      const item = putCapture[0].Item as Record<string, unknown>;
      expect(item.result).toBe('denied');
    });

    it('creates a decision record with a generated session_id', async () => {
      const putCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({ putCapture });

      const session = await recordScanSession({
        tenant_id: 'tenant-test',
        worker_id: 'worker-abc-123',
        site_id: 'site-xyz-789',
        timestamp: '2024-06-15T10:30:00.000Z',
        scanner_type: 'qr',
        device_id: 'device-001',
        token_ref: 'token-ref-001',
        decision_ref: 'decision-ref-001',
        result: 'allowed',
        replay_risk_flag: false,
      });

      expect(session.session_id).toBe('generated-uuid-001');
      const item = putCapture[0].Item as Record<string, unknown>;
      expect(item.session_id).toBe('generated-uuid-001');
    });

    it('stores the record with tenant-prefixed partition key', async () => {
      const putCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({ putCapture });

      await recordScanSession({
        tenant_id: 'tenant-acme',
        worker_id: 'worker-abc-123',
        site_id: 'site-xyz-789',
        timestamp: '2024-06-15T10:30:00.000Z',
        scanner_type: 'qr',
        device_id: 'device-001',
        token_ref: 'token-ref-001',
        decision_ref: 'decision-ref-001',
        result: 'allowed',
        replay_risk_flag: false,
      });

      expect(putCapture).toHaveLength(1);
      const item = putCapture[0].Item as Record<string, unknown>;
      expect(item.PK).toBe('TENANT#tenant-acme');
      expect((item.SK as string).startsWith('SESSION#')).toBe(true);
    });

    it('uses the correct table name for scan sessions', async () => {
      const putCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({ putCapture });

      await recordScanSession({
        tenant_id: 'tenant-test',
        worker_id: 'worker-abc-123',
        site_id: 'site-xyz-789',
        timestamp: '2024-06-15T10:30:00.000Z',
        scanner_type: 'qr',
        device_id: 'device-001',
        token_ref: 'token-ref-001',
        decision_ref: 'decision-ref-001',
        result: 'allowed',
        replay_risk_flag: false,
      });

      expect(putCapture).toHaveLength(1);
      expect(putCapture[0].TableName).toBe('test-ScanSessions');
    });

    it('returns the full session object with all fields', async () => {
      const putCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({ putCapture });

      const session = await recordScanSession({
        tenant_id: 'tenant-test',
        worker_id: 'worker-abc-123',
        site_id: 'site-xyz-789',
        timestamp: '2024-06-15T10:30:00.000Z',
        scanner_type: 'qr',
        device_id: 'device-001',
        token_ref: 'token-ref-001',
        decision_ref: 'decision-ref-001',
        result: 'conditional',
        replay_risk_flag: true,
        policy_version_used: 'v2.1',
      });

      expect(session).toEqual({
        session_id: 'generated-uuid-001',
        tenant_id: 'tenant-test',
        worker_id: 'worker-abc-123',
        site_id: 'site-xyz-789',
        timestamp: '2024-06-15T10:30:00.000Z',
        scanner_type: 'qr',
        device_id: 'device-001',
        token_ref: 'token-ref-001',
        decision_ref: 'decision-ref-001',
        result: 'conditional',
        replay_risk_flag: true,
        policy_version_used: 'v2.1',
      });
    });

    it('records GSI keys for worker and site indexing', async () => {
      const putCapture: Array<Record<string, unknown>> = [];
      setupDynamoMock({ putCapture });

      await recordScanSession({
        tenant_id: 'tenant-test',
        worker_id: 'worker-abc-123',
        site_id: 'site-xyz-789',
        timestamp: '2024-06-15T10:30:00.000Z',
        scanner_type: 'qr',
        device_id: 'device-001',
        token_ref: 'token-ref-001',
        decision_ref: 'decision-ref-001',
        result: 'allowed',
        replay_risk_flag: false,
      });

      const item = putCapture[0].Item as Record<string, unknown>;
      expect(item.GSI1PK).toBe('WORKER#worker-abc-123');
      expect(item.GSI1SK).toBe('SESSION#2024-06-15T10:30:00.000Z');
      expect(item.GSI2PK).toBe('SITE#site-xyz-789');
      expect(item.GSI2SK).toBe('SESSION#2024-06-15T10:30:00.000Z');
      expect(item.GSI3PK).toBe('TOKEN#token-ref-001');
      expect(item.GSI3SK).toBe('SESSION#2024-06-15T10:30:00.000Z');
    });
  });
});
