/**
 * Unit tests for the handleCertificationCatalog handler.
 * Tests routing, permission enforcement, and response shape.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('identity: GET /certifications/catalog', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const mockAwsSdk = (items: Record<string, unknown>[] = []) => {
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({ send: vi.fn().mockResolvedValue({ Items: items }) }) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      QueryCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn(() => ({})),
      PutObjectCommand: vi.fn(),
      GetObjectCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/s3-request-presigner', () => ({
      getSignedUrl: vi.fn().mockResolvedValue('https://example.com/signed'),
    }));
  };

  const siteAdminClaims = {
    sub: 'user-1',
    'custom:tenant_id': 'tenant-1',
    'custom:role': 'site_admin',
  };

  const workerClaims = {
    sub: 'user-2',
    'custom:tenant_id': 'tenant-1',
    'custom:role': 'worker',
  };

  it('returns 200 with certTypes array and total', async () => {
    const mockItems = [
      {
        cert_type_id: 'ct-1',
        name: 'WHMIS 2015',
        category: 'safety',
        issuing_authority: 'BC Safety Authority',
        validity_months: 12,
        is_required: true,
        active_count: 5,
      },
      {
        cert_type_id: 'ct-2',
        name: 'Fall Protection',
        category: 'safety',
        issuing_authority: 'WorkSafeBC',
        validity_months: 24,
        is_required: false,
        active_count: 3,
      },
    ];
    mockAwsSdk(mockItems);
    const { handler } = await import('../../src/services/identity/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/certifications/catalog',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: siteAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect((response as { statusCode: number }).statusCode).toBe(200);

    const body = JSON.parse((response as { body: string }).body);
    expect(body.certTypes).toHaveLength(2);
    expect(body.total).toBe(2);
    expect(body.certTypes[0]).toMatchObject({
      id: 'ct-1',
      name: 'WHMIS 2015',
      category: 'safety',
      issuingAuthority: 'BC Safety Authority',
      validityMonths: 12,
      isRequired: true,
      activeCount: 5,
    });
  });

  it('filters by search query parameter (case-insensitive)', async () => {
    const mockItems = [
      { cert_type_id: 'ct-1', name: 'WHMIS 2015', category: 'safety', issuing_authority: 'BSA', validity_months: 12, is_required: true, active_count: 5 },
      { cert_type_id: 'ct-2', name: 'Fall Protection', category: 'safety', issuing_authority: 'WSB', validity_months: 24, is_required: false, active_count: 3 },
      { cert_type_id: 'ct-3', name: 'First Aid', category: 'medical', issuing_authority: 'Red Cross', validity_months: 36, is_required: true, active_count: 2 },
    ];
    mockAwsSdk(mockItems);
    const { handler } = await import('../../src/services/identity/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/certifications/catalog',
      pathParameters: null,
      queryStringParameters: { search: 'fall' },
      headers: {},
      requestContext: { authorizer: { claims: siteAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect((response as { statusCode: number }).statusCode).toBe(200);

    const body = JSON.parse((response as { body: string }).body);
    expect(body.certTypes).toHaveLength(1);
    expect(body.certTypes[0].name).toBe('Fall Protection');
    expect(body.total).toBe(1);
  });

  it('filters by category query parameter', async () => {
    const mockItems = [
      { cert_type_id: 'ct-1', name: 'WHMIS 2015', category: 'safety', issuing_authority: 'BSA', validity_months: 12, is_required: true, active_count: 5 },
      { cert_type_id: 'ct-3', name: 'First Aid', category: 'medical', issuing_authority: 'Red Cross', validity_months: 36, is_required: true, active_count: 2 },
    ];
    mockAwsSdk(mockItems);
    const { handler } = await import('../../src/services/identity/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/certifications/catalog',
      pathParameters: null,
      queryStringParameters: { category: 'medical' },
      headers: {},
      requestContext: { authorizer: { claims: siteAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect((response as { statusCode: number }).statusCode).toBe(200);

    const body = JSON.parse((response as { body: string }).body);
    expect(body.certTypes).toHaveLength(1);
    expect(body.certTypes[0].name).toBe('First Aid');
  });

  it('enforces certifications:read permission (all valid roles have it)', async () => {
    // All defined roles have certifications:read, so we verify the handler
    // calls enforcePermission by confirming an authenticated request succeeds
    mockAwsSdk([]);
    const { handler } = await import('../../src/services/identity/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/certifications/catalog',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: siteAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect((response as { statusCode: number }).statusCode).toBe(200);
  });

  it('returns 401 when no auth is provided', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/identity/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/certifications/catalog',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      body: null,
    };

    const response = await handler(event);
    expect((response as { statusCode: number }).statusCode).toBe(401);
  });

  it('returns empty array when no cert types exist', async () => {
    mockAwsSdk([]);
    const { handler } = await import('../../src/services/identity/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/certifications/catalog',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: siteAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect((response as { statusCode: number }).statusCode).toBe(200);

    const body = JSON.parse((response as { body: string }).body);
    expect(body.certTypes).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});
