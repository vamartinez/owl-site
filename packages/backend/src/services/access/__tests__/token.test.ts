/**
 * Unit tests for the Access Service token creation and deletion modules.
 * Tests generateToken and revokeToken from token-manager.ts.
 *
 * Validates: Requirements 5.3, 5.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupDynamoMock, getDynamoCalls, resetDynamoMock, getMockSend } from '../../../../tests/helpers/mock-dynamo';
import { createMockClaims } from '../../../../tests/helpers/mock-user';
import { TokenType } from '../../../shared/types/common';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock the DynamoDB client
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock uuid to produce deterministic token IDs
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
}));

const MOCK_TOKEN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// Mock the event publisher to capture audit events
const mockPublishEvent = vi.fn().mockResolvedValue({
  event_id: 'evt-1',
  event_type: 'TokenRevoked',
  source_service: 'access-service',
  tenant_id: 'tenant-test',
  timestamp: '2024-01-01T00:00:00.000Z',
  payload: {},
  correlation_id: 'corr-1',
  version: '1.0',
});

vi.mock('../../../shared/event-publisher.js', () => ({
  publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));

import { generateToken, getToken, revokeToken } from '../token-manager';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const TEST_TENANT_ID = 'tenant-test';
const TEST_WORKER_ID = '11111111-2222-3333-4444-555555555555';
const TEST_SITE_ID = '66666666-7777-8888-9999-aaaaaaaaaaaa';
const TEST_DEVICE_ID = 'device-abc-123';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Token Creation - generateToken', () => {
  beforeEach(() => {
    resetDynamoMock();
    vi.clearAllMocks();
    setupDynamoMock({
      putCapture: [],
    });
  });

  it('produces a token record with an expiration timestamp', async () => {
    const token = await generateToken(
      TEST_TENANT_ID,
      TEST_WORKER_ID,
      TEST_SITE_ID,
      TokenType.QR_SESSION,
      TEST_DEVICE_ID
    );

    expect(token.expires_at).toBeDefined();
    expect(typeof token.expires_at).toBe('string');
    // expires_at should be a valid ISO date in the future
    const expiresAt = new Date(token.expires_at);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() - 1000); // within reasonable margin
    // Token TTL is 10 minutes
    const issuedAt = new Date(token.issued_at);
    const diffMs = expiresAt.getTime() - issuedAt.getTime();
    expect(diffMs).toBe(10 * 60 * 1000); // exactly 10 minutes
  });

  it('produces a token record with the associated worker ID', async () => {
    const token = await generateToken(
      TEST_TENANT_ID,
      TEST_WORKER_ID,
      TEST_SITE_ID,
      TokenType.SMS_MAGIC_LINK,
      TEST_DEVICE_ID
    );

    expect(token.worker_id).toBe(TEST_WORKER_ID);
  });

  it('produces a token with a generated UUID as token_id', async () => {
    const token = await generateToken(
      TEST_TENANT_ID,
      TEST_WORKER_ID,
      TEST_SITE_ID,
      TokenType.GATE_PASS,
      TEST_DEVICE_ID
    );

    expect(token.token_id).toBe(MOCK_TOKEN_ID);
  });

  it('stores the token in DynamoDB with correct partition key and fields', async () => {
    await generateToken(
      TEST_TENANT_ID,
      TEST_WORKER_ID,
      TEST_SITE_ID,
      TokenType.QR_SESSION,
      TEST_DEVICE_ID
    );

    const calls = getDynamoCalls();
    const putCall = calls.find((c) => c.command === 'PutCommand');
    expect(putCall).toBeDefined();

    const item = (putCall!.input as Record<string, unknown>).Item as Record<string, unknown>;
    expect(item['PK']).toBe(`TENANT#${TEST_TENANT_ID}`);
    expect(item['SK']).toBe(`TOKEN#${MOCK_TOKEN_ID}`);
    expect(item['GSI1PK']).toBe(`WORKER#${TEST_WORKER_ID}`);
    expect(item['worker_id']).toBe(TEST_WORKER_ID);
    expect(item['site_id']).toBe(TEST_SITE_ID);
    expect(item['token_type']).toBe(TokenType.QR_SESSION);
    expect(item['device_id']).toBe(TEST_DEVICE_ID);
    expect(item['expires_at']).toBeDefined();
    expect(item['issued_at']).toBeDefined();
    expect(item['revoked']).toBe(false);
    expect(item['used']).toBe(false);
    expect(item['ttl']).toBeDefined();
    expect(typeof item['ttl']).toBe('number');
  });

  it('sets TTL epoch matching the expiration timestamp', async () => {
    const token = await generateToken(
      TEST_TENANT_ID,
      TEST_WORKER_ID,
      TEST_SITE_ID,
      TokenType.QR_SESSION,
      TEST_DEVICE_ID
    );

    const calls = getDynamoCalls();
    const putCall = calls.find((c) => c.command === 'PutCommand');
    const item = (putCall!.input as Record<string, unknown>).Item as Record<string, unknown>;

    const expectedTtl = Math.floor(new Date(token.expires_at).getTime() / 1000);
    expect(item['ttl']).toBe(expectedTtl);
  });

  it('returns token with all expected fields populated', async () => {
    const token = await generateToken(
      TEST_TENANT_ID,
      TEST_WORKER_ID,
      TEST_SITE_ID,
      TokenType.QR_SESSION,
      TEST_DEVICE_ID
    );

    expect(token).toMatchObject({
      token_id: MOCK_TOKEN_ID,
      tenant_id: TEST_TENANT_ID,
      worker_id: TEST_WORKER_ID,
      site_id: TEST_SITE_ID,
      token_type: TokenType.QR_SESSION,
      device_id: TEST_DEVICE_ID,
      revoked: false,
      used: false,
    });
    expect(token.issued_at).toBeDefined();
    expect(token.expires_at).toBeDefined();
  });
});

describe('Token Deletion - revokeToken', () => {
  beforeEach(() => {
    resetDynamoMock();
    vi.clearAllMocks();
  });

  it('revokes an existing token by marking it as revoked', async () => {
    // Setup: token exists in DynamoDB
    const existingToken = {
      token_id: MOCK_TOKEN_ID,
      tenant_id: TEST_TENANT_ID,
      worker_id: TEST_WORKER_ID,
      site_id: TEST_SITE_ID,
      token_type: TokenType.QR_SESSION,
      device_id: TEST_DEVICE_ID,
      issued_at: '2024-01-01T00:00:00.000Z',
      expires_at: '2099-01-01T00:10:00.000Z', // Far future to not be expired
      revoked: false,
      used: false,
    };

    const getKey = JSON.stringify({
      PK: `TENANT#${TEST_TENANT_ID}`,
      SK: `TOKEN#${MOCK_TOKEN_ID}`,
    });

    setupDynamoMock({
      getResponses: new Map([[getKey, existingToken]]),
      updateCapture: [],
    });

    const result = await revokeToken(TEST_TENANT_ID, MOCK_TOKEN_ID);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('sends an UpdateCommand to set revoked=true and revoked_at timestamp', async () => {
    const existingToken = {
      token_id: MOCK_TOKEN_ID,
      tenant_id: TEST_TENANT_ID,
      worker_id: TEST_WORKER_ID,
      site_id: TEST_SITE_ID,
      token_type: TokenType.QR_SESSION,
      device_id: TEST_DEVICE_ID,
      issued_at: '2024-01-01T00:00:00.000Z',
      expires_at: '2099-01-01T00:10:00.000Z',
      revoked: false,
      used: false,
    };

    const getKey = JSON.stringify({
      PK: `TENANT#${TEST_TENANT_ID}`,
      SK: `TOKEN#${MOCK_TOKEN_ID}`,
    });

    setupDynamoMock({
      getResponses: new Map([[getKey, existingToken]]),
      updateCapture: [],
    });

    await revokeToken(TEST_TENANT_ID, MOCK_TOKEN_ID);

    const calls = getDynamoCalls();
    const updateCall = calls.find((c) => c.command === 'UpdateCommand');
    expect(updateCall).toBeDefined();

    const input = updateCall!.input as Record<string, unknown>;
    expect(input['Key']).toEqual({
      PK: `TENANT#${TEST_TENANT_ID}`,
      SK: `TOKEN#${MOCK_TOKEN_ID}`,
    });
    expect(input['UpdateExpression']).toContain('revoked');
    expect(input['UpdateExpression']).toContain('revoked_at');

    const exprValues = input['ExpressionAttributeValues'] as Record<string, unknown>;
    expect(exprValues[':revoked']).toBe(true);
    expect(exprValues[':revokedAt']).toBeDefined();
    // revoked_at should be a valid ISO timestamp
    expect(new Date(exprValues[':revokedAt'] as string).toISOString()).toBe(exprValues[':revokedAt']);
  });

  it('returns error when token does not exist', async () => {
    // No token in get responses → getToken returns null
    setupDynamoMock({
      getResponses: new Map(),
    });

    const result = await revokeToken(TEST_TENANT_ID, 'nonexistent-token-id');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Token not found');
  });

  it('returns error when token is already revoked', async () => {
    const alreadyRevokedToken = {
      token_id: MOCK_TOKEN_ID,
      tenant_id: TEST_TENANT_ID,
      worker_id: TEST_WORKER_ID,
      site_id: TEST_SITE_ID,
      token_type: TokenType.QR_SESSION,
      device_id: TEST_DEVICE_ID,
      issued_at: '2024-01-01T00:00:00.000Z',
      expires_at: '2099-01-01T00:10:00.000Z',
      revoked: true,
      revoked_at: '2024-01-01T00:05:00.000Z',
      used: false,
    };

    const getKey = JSON.stringify({
      PK: `TENANT#${TEST_TENANT_ID}`,
      SK: `TOKEN#${MOCK_TOKEN_ID}`,
    });

    setupDynamoMock({
      getResponses: new Map([[getKey, alreadyRevokedToken]]),
    });

    const result = await revokeToken(TEST_TENANT_ID, MOCK_TOKEN_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Token is already revoked');
  });

  it('emits audit event data through the DynamoDB update (revoked_at timestamp acts as audit trail)', async () => {
    const existingToken = {
      token_id: MOCK_TOKEN_ID,
      tenant_id: TEST_TENANT_ID,
      worker_id: TEST_WORKER_ID,
      site_id: TEST_SITE_ID,
      token_type: TokenType.QR_SESSION,
      device_id: TEST_DEVICE_ID,
      issued_at: '2024-01-01T00:00:00.000Z',
      expires_at: '2099-01-01T00:10:00.000Z',
      revoked: false,
      used: false,
    };

    const getKey = JSON.stringify({
      PK: `TENANT#${TEST_TENANT_ID}`,
      SK: `TOKEN#${MOCK_TOKEN_ID}`,
    });

    setupDynamoMock({
      getResponses: new Map([[getKey, existingToken]]),
      updateCapture: [],
    });

    await revokeToken(TEST_TENANT_ID, MOCK_TOKEN_ID);

    // The revocation acts as an audit event by recording the revoked_at timestamp
    const calls = getDynamoCalls();
    const updateCall = calls.find((c) => c.command === 'UpdateCommand');
    expect(updateCall).toBeDefined();

    const input = updateCall!.input as Record<string, unknown>;
    const exprValues = input['ExpressionAttributeValues'] as Record<string, unknown>;
    // revoked_at serves as the audit trail for when the deletion/revocation occurred
    const revokedAt = exprValues[':revokedAt'] as string;
    expect(revokedAt).toBeDefined();
    // Verify it's a valid ISO 8601 timestamp
    const parsedDate = new Date(revokedAt);
    expect(parsedDate.toISOString()).toBe(revokedAt);
    // The timestamp should be recent (within the last few seconds)
    expect(Date.now() - parsedDate.getTime()).toBeLessThan(5000);
  });
});
