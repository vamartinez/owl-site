/**
 * Unit tests for the Forms Service handler routing.
 * Tests routing logic, auth enforcement, and public endpoint access.
 *
 * Requirements: 1.1, 9.6
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
  vi.doMock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn(() => ({})),
    PutObjectCommand: vi.fn(),
  }));
  vi.doMock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/bucket/presigned-url'),
  }));
};

const tenantAdminClaims = {
  sub: 'user-1',
  'custom:tenant_id': 'tenant-1',
  'custom:role': 'tenant_admin',
};

const workerClaims = {
  sub: 'user-2',
  'custom:tenant_id': 'tenant-1',
  'custom:role': 'worker',
};

const supervisorClaims = {
  sub: 'user-3',
  'custom:tenant_id': 'tenant-1',
  'custom:role': 'supervisor',
};

describe('forms: handler routing', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
  });

  // ─── Authentication Tests ─────────────────────────────────────────────────

  it('returns 401 for unauthenticated requests to authenticated endpoints', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/forms',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(401);
  });

  it('returns 403 when worker role tries to create form', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/forms',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: workerClaims } },
      body: JSON.stringify({ name: 'Test Form' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(403);
  });

  it('returns 400 for unsupported routes', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'DELETE',
      resource: '/forms/{id}',
      pathParameters: { id: 'form-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  // ─── CORS Tests ───────────────────────────────────────────────────────────

  it('returns 200 for OPTIONS preflight requests', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'OPTIONS',
      resource: '/forms',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
  });

  // ─── Authenticated Route Tests ────────────────────────────────────────────

  it('routes POST /forms to create form handler', async () => {
    // Mock: duplicate check (no duplicates), form put, audit put
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/forms',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ name: 'Test Form' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(201);
  });

  it('routes GET /forms to list forms handler', async () => {
    // Mock: query for forms list
    mockSend.mockResolvedValueOnce({ Items: [] });

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/forms',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
  });

  it('routes GET /forms/{id} to get form handler', async () => {
    // Mock: get form by ID
    mockSend.mockResolvedValueOnce({
      Item: { form_id: 'form-123', name: 'Test', status: 'borrador', fields: [], tenant_id: 'tenant-1' },
    });

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/forms/{id}',
      pathParameters: { id: 'form-123' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
  });

  it('routes PATCH /forms/{id} to update form handler', async () => {
    // Mock: GetCommand (form exists in borrador), UpdateCommand, PutCommand (audit)
    mockSend
      .mockResolvedValueOnce({
        Item: { form_id: 'form-123', name: 'Old Name', status: 'borrador', fields: [], tenant_id: 'tenant-1', author_id: 'user-1', created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z' },
      })
      .mockResolvedValueOnce({
        Attributes: { form_id: 'form-123', name: 'Updated', status: 'borrador', fields: [], tenant_id: 'tenant-1', author_id: 'user-1', created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-06-01T00:00:00.000Z' },
      })
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/forms/{id}',
      pathParameters: { id: 'form-123' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ name: 'Updated' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
  });

  it('routes POST /forms/{id}/publish to publish handler', async () => {
    // Mock: GetCommand returns a valid draft form, QueryCommand for version check,
    // PutCommand for version, UpdateCommand for form update, PutCommand for audit
    mockSend
      .mockResolvedValueOnce({
        Item: {
          form_id: 'form-123',
          tenant_id: 'tenant-1',
          name: 'Test Form',
          status: 'borrador',
          fields: [{ field_id: 'f1', type: 'texto_corto', label: 'Nombre', required: true, order: 1 }],
          author_id: 'user-1',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      }) // GetCommand: fetch form
      .mockResolvedValueOnce({ Items: [] }) // QueryCommand: get current version
      .mockResolvedValueOnce({}) // PutCommand: create FormVersion
      .mockResolvedValueOnce({
        Attributes: {
          form_id: 'form-123',
          tenant_id: 'tenant-1',
          name: 'Test Form',
          status: 'publicado',
          fields: [{ field_id: 'f1', type: 'texto_corto', label: 'Nombre', required: true, order: 1 }],
          author_id: 'user-1',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-06-01T00:00:00.000Z',
        },
      }) // UpdateCommand: update form status
      .mockResolvedValueOnce({}); // PutCommand: audit entry

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/forms/{id}/publish',
      pathParameters: { id: 'form-123' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims }, identity: { sourceIp: '10.0.0.1' } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
  });

  it('routes POST /forms/{id}/unpublish to unpublish handler', async () => {
    // Mock: GetCommand returns a published form, UpdateCommand changes status, PutCommand for audit
    mockSend
      .mockResolvedValueOnce({
        Item: {
          form_id: 'form-123',
          tenant_id: 'tenant-1',
          name: 'Published Form',
          status: 'publicado',
          fields: [{ field_id: 'f1', type: 'texto_corto', label: 'Nombre', required: true, order: 1 }],
          token_publico: 'some-token',
          current_version: 1,
          author_id: 'user-1',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-02T00:00:00.000Z',
          published_at: '2024-01-02T00:00:00.000Z',
        },
      }) // get form
      .mockResolvedValueOnce({
        Attributes: {
          form_id: 'form-123',
          tenant_id: 'tenant-1',
          name: 'Published Form',
          status: 'despublicado',
          fields: [{ field_id: 'f1', type: 'texto_corto', label: 'Nombre', required: true, order: 1 }],
          token_publico: 'some-token',
          current_version: 1,
          author_id: 'user-1',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-03T00:00:00.000Z',
          published_at: '2024-01-02T00:00:00.000Z',
        },
      }) // update status
      .mockResolvedValueOnce({}); // audit put

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/forms/{id}/unpublish',
      pathParameters: { id: 'form-123' },
      queryStringParameters: null,
      headers: {},
      requestContext: {
        authorizer: { claims: tenantAdminClaims },
        identity: { sourceIp: '10.0.0.1' },
      },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
  });

  it('routes POST /forms/{id}/duplicate to duplicate handler', async () => {
    // Mock: GetCommand returns a form, PutCommand for new form, PutCommand for audit
    mockSend
      .mockResolvedValueOnce({
        Item: {
          form_id: 'form-123',
          tenant_id: 'tenant-1',
          name: 'Test Form',
          status: 'borrador',
          fields: [],
          author_id: 'user-1',
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      }) // GetCommand: fetch original form
      .mockResolvedValueOnce({}) // PutCommand: save duplicate
      .mockResolvedValueOnce({}); // PutCommand: audit entry

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/forms/{id}/duplicate',
      pathParameters: { id: 'form-123' },
      queryStringParameters: null,
      headers: {},
      requestContext: {
        authorizer: { claims: tenantAdminClaims },
        identity: { sourceIp: '10.0.0.1' },
      },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(201);
  });

  it('routes GET /forms/{id}/responses to list responses handler', async () => {
    // Mock GSI1 query for listFormResponses
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/forms/{id}/responses',
      pathParameters: { id: 'form-123' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
  });

  it('routes GET /forms/{id}/responses/{responseId} to get response handler', async () => {
    // Mock GetCommand for getFormResponseDetail
    mockSend.mockResolvedValueOnce({
      Item: {
        response_id: 'resp-456',
        form_id: 'form-123',
        version_number: 1,
        folio: 'ABC12345',
        submitted_at: '2024-03-10T10:00:00.000Z',
        answers: { 'field-1': 'test' },
        metadata: { origin_type: 'qr', user_agent: 'Chrome', ip_address: '10.0.0.1' },
        tenant_id: 'tenant-1',
      },
    });
    // Mock GetCommand for getFormVersion
    mockSend.mockResolvedValueOnce({
      Item: {
        form_id: 'form-123',
        version_number: 1,
        fields_snapshot: [],
        created_at: '2024-01-01T00:00:00.000Z',
        created_by: 'user-1',
      },
    });

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/forms/{id}/responses/{responseId}',
      pathParameters: { id: 'form-123', responseId: 'resp-456' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
  });

  it('routes GET /forms/{id}/responses/export to export handler', async () => {
    // Mock getFormVersions (first query)
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          form_id: 'form-123',
          version_number: 1,
          fields_snapshot: [
            { field_id: 'f1', type: 'texto_corto', label: 'Nombre', required: true, order: 1 },
          ],
          created_at: '2024-01-01T00:00:00.000Z',
          created_by: 'user-1',
        },
      ],
    });
    // Mock fetchAllResponses (second query)
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/forms/{id}/responses/export',
      pathParameters: { id: 'form-123' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['Content-Disposition']).toContain('attachment');
  });

  it('routes GET /forms/{id}/audit to audit handler', async () => {
    mockSend.mockResolvedValueOnce({ Items: [], Count: 0 }); // QueryCommand for audit log

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/forms/{id}/audit',
      pathParameters: { id: 'form-123' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
  });

  it('routes POST /forms/{id}/upload-url to upload URL handler', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/forms/{id}/upload-url',
      pathParameters: { id: 'form-123' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ filename: 'doc.pdf', content_type: 'application/pdf', size: 1024, field_id: 'field-1' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
  });

  // ─── Path Parameter Validation ────────────────────────────────────────────

  it('returns 400 when form ID is missing for GET /forms/{id}', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/forms/{id}',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when response ID is missing for GET /forms/{id}/responses/{responseId}', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/forms/{id}/responses/{responseId}',
      pathParameters: { id: 'form-123' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  // ─── Permission Enforcement Tests ─────────────────────────────────────────

  it('returns 403 when worker tries to update form', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/forms/{id}',
      pathParameters: { id: 'form-123' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: workerClaims } },
      body: JSON.stringify({ name: 'Hacked' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(403);
  });

  it('returns 403 when worker tries to publish form', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/forms/{id}/publish',
      pathParameters: { id: 'form-123' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: workerClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(403);
  });

  it('returns 403 when worker tries to export responses', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/forms/{id}/responses/export',
      pathParameters: { id: 'form-123' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: workerClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(403);
  });

  // ─── Public Endpoint Tests (No Auth Required) ─────────────────────────────

  it('routes GET /public/forms/{token} without auth', async () => {
    // Mock getFormByToken (QueryCommand on GSI1)
    mockSend.mockResolvedValueOnce({
      Items: [{
        form_id: 'form-pub-1',
        tenant_id: 'tenant-1',
        name: 'Public Form',
        description: 'A test form',
        status: 'publicado',
        fields: [{ field_id: 'f1', type: 'texto_corto', label: 'Nombre', required: true, order: 1 }],
        token_publico: 'abc-123-token',
        author_id: 'user-1',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      }],
    });

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/public/forms/{token}',
      pathParameters: { token: 'abc-123-token' },
      queryStringParameters: null,
      headers: {},
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
  });

  it('routes POST /public/forms/{token}/responses without auth', async () => {
    // Mock 1: getFormByToken for rate limiter (QueryCommand on GSI1)
    mockSend.mockResolvedValueOnce({
      Items: [{
        form_id: 'form-pub-1',
        tenant_id: 'tenant-1',
        name: 'Public Form',
        status: 'publicado',
        fields: [{ field_id: 'f1', type: 'texto_corto', label: 'Nombre', required: false, order: 1 }],
        token_publico: 'abc-123-token',
        current_version: 1,
        author_id: 'user-1',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      }],
    });
    // Mock 2: checkRateLimit GetCommand (no existing record)
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // Mock 3: checkRateLimit UpdateCommand (create new window)
    mockSend.mockResolvedValueOnce({});
    // Mock 4: getFormByToken inside submitFormResponse (QueryCommand on GSI1)
    mockSend.mockResolvedValueOnce({
      Items: [{
        form_id: 'form-pub-1',
        tenant_id: 'tenant-1',
        name: 'Public Form',
        status: 'publicado',
        fields: [{ field_id: 'f1', type: 'texto_corto', label: 'Nombre', required: false, order: 1 }],
        token_publico: 'abc-123-token',
        current_version: 1,
        author_id: 'user-1',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      }],
    });
    // Mock 5: PutCommand for FormResponse
    mockSend.mockResolvedValueOnce({});
    // Mock 6: PutCommand for audit entry
    mockSend.mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/public/forms/{token}/responses',
      pathParameters: { token: 'abc-123-token' },
      queryStringParameters: null,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)',
        'Origin': 'https://app.sytedocs.com',
        'Referer': 'https://app.sytedocs.com/forms/abc-123-token',
      },
      requestContext: { identity: { sourceIp: '192.168.1.1' } },
      body: JSON.stringify({ answers: { 'f1': 'Test answer' } }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.folio).toBeDefined();
    expect(body.response_id).toBeDefined();
    expect(body.message).toBe('Respuesta enviada exitosamente');
  });

  it('routes POST /public/forms/{token}/upload-url without auth', async () => {
    // Mock getFormByToken to return a published form
    mockSend.mockResolvedValueOnce({
      Items: [{
        form_id: 'form-pub-1',
        tenant_id: 'tenant-1',
        name: 'Test Form',
        status: 'publicado',
        fields: [],
        token_publico: 'abc-123-token',
        author_id: 'user-1',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      }],
    });

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/public/forms/{token}/upload-url',
      pathParameters: { token: 'abc-123-token' },
      queryStringParameters: null,
      headers: {},
      body: JSON.stringify({ filename: 'photo.png', content_type: 'image/png', size: 2048, field_id: 'field-1' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.upload_url).toBeDefined();
    expect(body.file_key).toContain('forms/tenant-1/form-pub-1/responses/');
    expect(body.fields['Content-Type']).toBe('image/png');
  });

  it('returns 400 when token is missing for public endpoints', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/public/forms/{token}',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for unsupported public routes', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'DELETE',
      resource: '/public/forms/{token}',
      pathParameters: { token: 'abc-123-token' },
      queryStringParameters: null,
      headers: {},
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });
});
