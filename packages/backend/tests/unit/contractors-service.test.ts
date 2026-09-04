/**
 * Unit tests for the Contractors Service.
 * Tests handler routing, validation, and business logic.
 *
 * Requirements: 17.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn(),
    GetCommand: vi.fn(),
    QueryCommand: vi.fn(),
    DeleteCommand: vi.fn(),
    UpdateCommand: vi.fn(),
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

const tenantAdminClaims = {
  sub: 'user-1',
  'custom:tenant_id': 'tenant-1',
  'custom:role': 'tenant_admin',
};

const workerClaims = {
  sub: 'user-1',
  'custom:tenant_id': 'tenant-1',
  'custom:role': 'worker',
};

describe('contractors: handler routing', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
  });

  it('returns 401 for unauthenticated requests', async () => {
    const { handler } = await import('../../src/services/contractors/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/contractors',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(401);
  });

  it('returns 403 when worker role tries to create contractor', async () => {
    const { handler } = await import('../../src/services/contractors/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/contractors',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: workerClaims } },
      body: JSON.stringify({
        company_name: 'Test Co',
        contact_name: 'John',
        contact_email: 'john@test.com',
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(403);
  });

  it('returns 400 for unsupported routes', async () => {
    const { handler } = await import('../../src/services/contractors/handler.js');

    const event = {
      httpMethod: 'DELETE',
      resource: '/contractors/{id}',
      pathParameters: { id: 'c1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when contractor ID is missing for GET', async () => {
    const { handler } = await import('../../src/services/contractors/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/contractors/{id}',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('Contractor ID is required');
  });

  it('returns 400 when POST /contractors has no body', async () => {
    const { handler } = await import('../../src/services/contractors/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/contractors',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('Request body is required');
  });

  it('returns 400 when POST /contractors has invalid email', async () => {
    const { handler } = await import('../../src/services/contractors/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/contractors',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({
        company_name: 'Test Co',
        contact_name: 'John',
        contact_email: 'not-an-email',
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('Validation failed');
  });

  it('returns 400 when company_name exceeds 200 chars', async () => {
    const { handler } = await import('../../src/services/contractors/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/contractors',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({
        company_name: 'A'.repeat(201),
        contact_name: 'John',
        contact_email: 'john@test.com',
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it('creates contractor successfully with valid input', async () => {
    mockSend.mockResolvedValue({}); // PutCommand

    const { handler } = await import('../../src/services/contractors/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/contractors',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({
        company_name: 'Test Construction Co',
        contact_name: 'John Doe',
        contact_email: 'john@testconstruction.com',
        contact_phone: '+14155552671',
      }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.contractor.company_name).toBe('Test Construction Co');
    expect(body.contractor.contact_name).toBe('John Doe');
    expect(body.contractor.status).toBe('active');
    expect(body.contractor.contractor_id).toBeDefined();
  });

  it('lists contractors successfully', async () => {
    // 1) main paginated query returns one contractor row
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          contractor_id: 'c1',
          tenant_id: 'tenant-1',
          company_name: 'Co 1',
          status: 'active',
        },
      ],
    });
    // 2) Select: 'COUNT' query returns the tenant-wide total
    mockSend.mockResolvedValueOnce({ Count: 1 });
    // 3) per-row compliance: listContractorWorkers (no workers assigned)
    mockSend.mockResolvedValueOnce({ Items: [] });

    const { handler } = await import('../../src/services/contractors/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/contractors',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.contractors).toHaveLength(1);
    // total comes from the COUNT query, not the current page length
    expect(body.total).toBe(1);
    // enriched join columns are present on each row
    expect(body.contractors[0].total_workers).toBe(0);
    expect(body.contractors[0].compliance_percent).toBe(100);
  });

  it('reports the tenant-wide total from the COUNT query, not just the current page', async () => {
    // 1) main query is Limit-bounded and returns only the first page (2 rows)
    mockSend.mockResolvedValueOnce({
      Items: [
        { contractor_id: 'c1', tenant_id: 'tenant-1', company_name: 'Co 1', status: 'active' },
        { contractor_id: 'c2', tenant_id: 'tenant-1', company_name: 'Co 2', status: 'active' },
      ],
      LastEvaluatedKey: { PK: 'TENANT#tenant-1', SK: 'CONTRACTOR#c2' },
    });
    // 2) COUNT query reports the real total across all pages
    mockSend.mockResolvedValueOnce({ Count: 7 });
    // 3+4) per-row compliance lookups (no workers for either row)
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({ Items: [] });

    const { handler } = await import('../../src/services/contractors/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/contractors',
      pathParameters: null,
      queryStringParameters: { limit: '2' },
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.contractors).toHaveLength(2);
    // total is the tenant-wide COUNT (7), not the page length (2)
    expect(body.total).toBe(7);
    // a nextCursor is emitted when there are more pages
    expect(body.nextCursor).toBeDefined();
  });

  it('returns 404 when contractor not found for GET', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined }); // GetCommand

    const { handler } = await import('../../src/services/contractors/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/contractors/{id}',
      pathParameters: { id: 'nonexistent' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(404);
  });

  it('assigns worker to contractor successfully', async () => {
    // First call: getContractor (verify exists)
    mockSend.mockResolvedValueOnce({
      Item: { contractor_id: 'c1', tenant_id: 'tenant-1', company_name: 'Co 1', status: 'active' },
    });
    // Second call: PutCommand (assign worker)
    mockSend.mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/contractors/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/contractors/{id}/workers',
      pathParameters: { id: 'c1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ worker_id: 'w1' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.assignment.worker_id).toBe('w1');
    expect(body.assignment.contractor_id).toBe('c1');
  });

  it('returns 404 when removing non-existent worker assignment', async () => {
    const error = new Error('Condition not met');
    error.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValueOnce(error);

    const { handler } = await import('../../src/services/contractors/handler.js');

    const event = {
      httpMethod: 'DELETE',
      resource: '/contractors/{id}/workers/{workerId}',
      pathParameters: { id: 'c1', workerId: 'w1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(404);
  });
});
