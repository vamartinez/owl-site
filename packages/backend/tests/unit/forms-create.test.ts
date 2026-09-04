/**
 * Unit tests for form creation endpoint (POST /forms).
 * Tests validation, duplicate name check, DynamoDB persistence, and audit logging.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn().mockImplementation((params) => ({ input: params })),
    GetCommand: vi.fn().mockImplementation((params) => ({ input: params })),
    QueryCommand: vi.fn().mockImplementation((params) => ({ input: params })),
    UpdateCommand: vi.fn().mockImplementation((params) => ({ input: params })),
    DeleteCommand: vi.fn(),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

const tenantAdminClaims = {
  sub: 'user-admin-1',
  'custom:tenant_id': 'tenant-abc',
  'custom:role': 'tenant_admin',
};

const siteAdminClaims = {
  sub: 'user-site-1',
  'custom:tenant_id': 'tenant-abc',
  'custom:role': 'site_admin',
};

function createEvent(body: unknown) {
  return {
    httpMethod: 'POST',
    resource: '/forms',
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    requestContext: {
      authorizer: { claims: tenantAdminClaims },
      identity: { sourceIp: '192.168.1.1' },
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

describe('forms: create form (POST /forms)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
  });

  // ─── Successful Creation ──────────────────────────────────────────────────

  it('creates a form with valid name and returns 201', async () => {
    // First call: QueryCommand for duplicate check (no duplicates)
    // Second call: PutCommand for form creation
    // Third call: PutCommand for audit entry
    mockSend
      .mockResolvedValueOnce({ Items: [] }) // duplicate check
      .mockResolvedValueOnce({}) // form put
      .mockResolvedValueOnce({}); // audit put

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({ name: 'Mi Formulario de Seguridad' });
    const response = await handler(event);

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.form).toBeDefined();
    expect(body.form.name).toBe('Mi Formulario de Seguridad');
    expect(body.form.status).toBe('borrador');
    expect(body.form.fields).toEqual([]);
    expect(body.form.form_id).toBeDefined();
    expect(body.form.tenant_id).toBe('tenant-abc');
    expect(body.form.author_id).toBe('user-admin-1');
    expect(body.form.created_at).toBeDefined();
    expect(body.form.updated_at).toBeDefined();
  });

  it('creates a form with name and description', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({
      name: 'Formulario Contratista',
      description: 'Formulario para capturar datos de contratistas en obra',
    });
    const response = await handler(event);

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.form.description).toBe('Formulario para capturar datos de contratistas en obra');
  });

  it('creates a form without description (optional field)', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({ name: 'Solo Nombre' });
    const response = await handler(event);

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.form.description).toBeUndefined();
  });

  it('assigns a UUID v4 as form_id', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({ name: 'Test UUID' });
    const response = await handler(event);

    const body = JSON.parse(response.body);
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(body.form.form_id).toMatch(uuidV4Regex);
  });

  it('records created_at in ISO 8601 UTC format', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({ name: 'Test Timestamp' });
    const response = await handler(event);

    const body = JSON.parse(response.body);
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
    expect(body.form.created_at).toMatch(isoRegex);
    expect(body.form.updated_at).toMatch(isoRegex);
  });

  // ─── Name Validation ──────────────────────────────────────────────────────

  it('rejects name shorter than 3 characters', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({ name: 'AB' });
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('rejects name longer than 200 characters', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({ name: 'A'.repeat(201) });
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('rejects name with only spaces', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({ name: '     ' });
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('accepts name with exactly 3 characters', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({ name: 'ABC' });
    const response = await handler(event);

    expect(response.statusCode).toBe(201);
  });

  it('accepts name with exactly 200 characters', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({ name: 'A'.repeat(200) });
    const response = await handler(event);

    expect(response.statusCode).toBe(201);
  });

  it('accepts name with spaces if it has at least one non-space character', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({ name: '  A  ' });
    const response = await handler(event);

    expect(response.statusCode).toBe(201);
  });

  // ─── Description Validation ───────────────────────────────────────────────

  it('rejects description longer than 1000 characters', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({
      name: 'Valid Name',
      description: 'D'.repeat(1001),
    });
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('accepts description with exactly 1000 characters', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({
      name: 'Valid Name',
      description: 'D'.repeat(1000),
    });
    const response = await handler(event);

    expect(response.statusCode).toBe(201);
  });

  // ─── Duplicate Name Check ─────────────────────────────────────────────────

  it('returns 409 when form name already exists in tenant', async () => {
    // Duplicate check returns an existing form
    mockSend.mockResolvedValueOnce({
      Items: [{ form_id: 'existing-form', name: 'Formulario Existente' }],
    });

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({ name: 'Formulario Existente' });
    const response = await handler(event);

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('CONFLICT');
    expect(body.message).toContain('Ya existe un formulario con ese nombre');
  });

  // ─── Missing Body ─────────────────────────────────────────────────────────

  it('returns 400 when request body is missing', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/forms',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when name is missing from body', async () => {
    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({ description: 'No name provided' });
    const response = await handler(event);

    expect(response.statusCode).toBe(400);
  });

  // ─── Audit Logging ────────────────────────────────────────────────────────

  it('logs audit entry on successful creation', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] }) // duplicate check
      .mockResolvedValueOnce({}) // form put
      .mockResolvedValueOnce({}); // audit put

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({ name: 'Audit Test Form' });
    await handler(event);

    // Third call should be the audit PutCommand
    expect(mockSend).toHaveBeenCalledTimes(3);
    const auditCall = mockSend.mock.calls[2]![0];
    const auditItem = auditCall.input.Item;
    expect(auditItem.action).toBe('formulario_creado');
    expect(auditItem.entity_type).toBe('formulario');
    expect(auditItem.actor_id).toBe('user-admin-1');
    expect(auditItem.tenant_id).toBe('tenant-abc');
  });

  it('rejects creation if audit logging fails', async () => {
    mockSend
      .mockResolvedValueOnce({ Items: [] }) // duplicate check
      .mockResolvedValueOnce({}) // form put
      .mockRejectedValueOnce(new Error('DynamoDB audit write failed')); // audit fails

    const { handler } = await import('../../src/services/forms/handler.js');

    const event = createEvent({ name: 'Audit Fail Form' });
    const response = await handler(event);

    // Should return 500 because audit failure rejects the operation
    expect(response.statusCode).toBe(500);
  });

  // ─── Role Authorization ───────────────────────────────────────────────────

  it('allows site_admin to create forms', async () => {
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
      requestContext: {
        authorizer: { claims: siteAdminClaims },
        identity: { sourceIp: '10.0.0.1' },
      },
      body: JSON.stringify({ name: 'Site Admin Form' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(201);
  });
});
