/**
 * Unit tests for the Lead Capture Service.
 * Tests validation, handler routing, and storage.
 *
 * Requirements: 16.3, 16.4, 16.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn(),
    GetCommand: vi.fn(),
    QueryCommand: vi.fn(),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
  vi.doMock('@aws-sdk/client-sns', () => ({
    SNSClient: vi.fn(() => ({})),
    PublishCommand: vi.fn(),
  }));
  vi.doMock('@aws-sdk/client-sqs', () => ({
    SQSClient: vi.fn(() => ({})),
    SendMessageCommand: vi.fn(),
  }));
};

describe('leads: handler', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
  });

  it('returns 400 when body is missing', async () => {
    const { handler } = await import('../../src/services/leads/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/leads',
      headers: {},
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('Request body is required');
  });

  it('returns 400 when company_name is missing', async () => {
    const { handler } = await import('../../src/services/leads/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/leads',
      headers: {},
      body: JSON.stringify({
        contact_name: 'John',
        email: 'john@test.com',
        message: 'Interested in your platform',
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.details?.errors?.company_name).toBeDefined();
  });

  it('returns 400 when contact_name is missing', async () => {
    const { handler } = await import('../../src/services/leads/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/leads',
      headers: {},
      body: JSON.stringify({
        company_name: 'Test Co',
        email: 'john@test.com',
        message: 'Interested in your platform',
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.details?.errors?.contact_name).toBeDefined();
  });

  it('returns 400 when email is invalid', async () => {
    const { handler } = await import('../../src/services/leads/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/leads',
      headers: {},
      body: JSON.stringify({
        company_name: 'Test Co',
        contact_name: 'John',
        email: 'not-an-email',
        message: 'Interested in your platform',
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.details?.errors?.email).toBeDefined();
  });

  it('returns 400 when message is missing', async () => {
    const { handler } = await import('../../src/services/leads/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/leads',
      headers: {},
      body: JSON.stringify({
        company_name: 'Test Co',
        contact_name: 'John',
        email: 'john@test.com',
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.details?.errors?.message).toBeDefined();
  });

  it('returns 400 when company_name exceeds 200 characters', async () => {
    const { handler } = await import('../../src/services/leads/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/leads',
      headers: {},
      body: JSON.stringify({
        company_name: 'A'.repeat(201),
        contact_name: 'John',
        email: 'john@test.com',
        message: 'Interested',
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when contact_name exceeds 150 characters', async () => {
    const { handler } = await import('../../src/services/leads/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/leads',
      headers: {},
      body: JSON.stringify({
        company_name: 'Test Co',
        contact_name: 'A'.repeat(151),
        email: 'john@test.com',
        message: 'Interested',
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when message exceeds 1000 characters', async () => {
    const { handler } = await import('../../src/services/leads/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/leads',
      headers: {},
      body: JSON.stringify({
        company_name: 'Test Co',
        contact_name: 'John',
        email: 'john@test.com',
        message: 'A'.repeat(1001),
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when phone is not E.164 format', async () => {
    const { handler } = await import('../../src/services/leads/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/leads',
      headers: {},
      body: JSON.stringify({
        company_name: 'Test Co',
        contact_name: 'John',
        email: 'john@test.com',
        phone: '555-1234', // Not E.164
        message: 'Interested',
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it('creates lead successfully with all required fields', async () => {
    mockSend.mockResolvedValueOnce({}); // PutCommand

    const { handler } = await import('../../src/services/leads/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/leads',
      headers: {},
      body: JSON.stringify({
        company_name: 'Test Construction Co',
        contact_name: 'John Doe',
        email: 'john@testconstruction.com',
        message: 'We are interested in your compliance platform for our 5 construction sites.',
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.lead_id).toBeDefined();
    expect(body.message).toContain('Thank you');
  });

  it('creates lead successfully with optional phone in E.164 format', async () => {
    mockSend.mockResolvedValueOnce({}); // PutCommand

    const { handler } = await import('../../src/services/leads/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/leads',
      headers: {},
      body: JSON.stringify({
        company_name: 'Test Co',
        contact_name: 'John',
        email: 'john@test.com',
        phone: '+14155552671',
        message: 'Interested in your platform',
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
  });

  it('handles OPTIONS request for CORS preflight', async () => {
    const { handler } = await import('../../src/services/leads/handler.js');

    const event = {
      httpMethod: 'OPTIONS',
      resource: '/leads',
      headers: {},
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
  });

  it('returns 400 for unsupported routes', async () => {
    const { handler } = await import('../../src/services/leads/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/leads',
      headers: {},
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it('does not require authentication (public endpoint)', async () => {
    mockSend.mockResolvedValueOnce({}); // PutCommand

    const { handler } = await import('../../src/services/leads/handler.js');

    // No auth headers or claims
    const event = {
      httpMethod: 'POST',
      resource: '/leads',
      headers: {},
      body: JSON.stringify({
        company_name: 'Test Co',
        contact_name: 'John',
        email: 'john@test.com',
        message: 'Interested',
      }),
    };

    const response = await handler(event);
    // Should succeed without auth
    expect(response.statusCode).toBe(201);
  });
});
