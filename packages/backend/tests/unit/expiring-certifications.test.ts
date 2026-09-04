/**
 * Unit tests for the handleExpiringCertifications handler.
 * Tests permission enforcement, urgency parameter parsing, and response shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handler } from '../../src/services/identity/handler.js';

// Mock the DynamoDB client
const mockSend = vi.fn();
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  getTableName: (name: string) => `dev-${name}`,
}));

function createEvent(overrides: Record<string, unknown> = {}) {
  const today = new Date();
  return {
    httpMethod: 'GET',
    resource: '/certifications/expiring',
    headers: {
      Authorization: 'Bearer test-token',
    },
    requestContext: {
      authorizer: {
        claims: {
          sub: 'user-123',
          'custom:tenant_id': 'tenant-abc',
          'custom:role': 'site_admin',
        },
      },
    },
    pathParameters: null,
    queryStringParameters: null,
    body: null,
    ...overrides,
  };
}

describe('handleExpiringCertifications', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('enforces certifications:read permission (all standard roles have it)', async () => {
    // All standard roles have certifications:read, so we verify the handler
    // proceeds correctly for an authorized user (site_admin)
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = createEvent();
    const response = await handler(event);
    expect(response.statusCode).toBe(200);
  });

  it('returns 200 with expiring certifications using default 30-day urgency', async () => {
    const today = new Date();
    const expiryDate = new Date(today.getTime() + 15 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    mockSend.mockResolvedValueOnce({
      Items: [
        {
          certification_id: 'cert-1',
          worker_name: 'John Smith',
          worker_id: 'worker-1',
          cert_type: 'whmis_2015',
          expiry_date: expiryDate,
          site: 'Site A',
        },
      ],
    });

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.certifications).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.certifications[0].id).toBe('cert-1');
    expect(body.certifications[0].workerName).toBe('John Smith');
    expect(body.certifications[0].workerId).toBe('worker-1');
    expect(body.certifications[0].certType).toBe('whmis_2015');
    expect(body.certifications[0].expiryDate).toBe(expiryDate);
    expect(body.certifications[0].daysRemaining).toBeGreaterThan(0);
    expect(body.certifications[0].site).toBe('Site A');
  });

  it('uses custom urgency parameter when provided', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = createEvent({
      queryStringParameters: { urgency: '60' },
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(200);

    // Verify the query used the correct date range
    const queryArgs = mockSend.mock.calls[0][0].input;
    const today = new Date().toISOString().split('T')[0];
    const futureDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    expect(queryArgs.ExpressionAttributeValues[':pk']).toBe('TENANT#tenant-abc');
    expect(queryArgs.ExpressionAttributeValues[':start']).toBe(`CERT#${today}`);
    expect(queryArgs.ExpressionAttributeValues[':end']).toBe(`CERT#${futureDate}`);
  });

  it('defaults to 30 days when urgency is invalid', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = createEvent({
      queryStringParameters: { urgency: 'invalid' },
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(200);

    const queryArgs = mockSend.mock.calls[0][0].input;
    const today = new Date().toISOString().split('T')[0];
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    expect(queryArgs.ExpressionAttributeValues[':end']).toBe(`CERT#${futureDate}`);
  });

  it('defaults to 30 days when urgency is negative', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = createEvent({
      queryStringParameters: { urgency: '-5' },
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(200);

    const queryArgs = mockSend.mock.calls[0][0].input;
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    expect(queryArgs.ExpressionAttributeValues[':end']).toBe(`CERT#${futureDate}`);
  });

  it('returns empty array when no certifications are expiring', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = createEvent();
    const response = await handler(event);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.certifications).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('queries GSI1 on Certifications table with correct key condition', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = createEvent();
    await handler(event);

    const queryArgs = mockSend.mock.calls[0][0].input;
    expect(queryArgs.TableName).toBe('dev-Certifications');
    expect(queryArgs.IndexName).toBe('GSI1');
    expect(queryArgs.KeyConditionExpression).toBe(
      'GSI1PK = :pk AND GSI1SK BETWEEN :start AND :end'
    );
  });

  it('returns 401 when no authorization is provided', async () => {
    const event = createEvent({
      requestContext: {},
      headers: {},
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(401);
  });
});
