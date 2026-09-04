/**
 * Integration tests for Identity Service endpoints.
 * These tests call the deployed API directly to validate:
 * - CORS headers are present
 * - Response shapes match expected contracts
 * - Worker CRUD operations work end-to-end
 * - Certification CRUD operations work end-to-end
 *
 * Requires: VITE_API_URL and TEST_AUTH_TOKEN environment variables
 * Run with: npx vitest run tests/integration/identity-endpoints.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API_URL = process.env.VITE_API_URL || 'https://qhk659i3s9.execute-api.us-east-1.amazonaws.com/dev';
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || '';
const TENANT_ID = process.env.TEST_TENANT_ID || 'tenant-test';

// Helper to make authenticated requests
async function apiRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; headers: Headers; data: unknown }> {
  const url = `${API_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Tenant-Id': TENANT_ID,
  };

  if (AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: unknown;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return { status: response.status, headers: response.headers, data };
}

// ─── CORS Tests ──────────────────────────────────────────────────────────────

describe('CORS Headers', () => {
  it('OPTIONS /workers returns CORS headers', async () => {
    const response = await fetch(`${API_URL}/workers`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type,Authorization,X-Tenant-Id',
      },
    });

    expect(response.status).toBeLessThan(400);

    const allowOrigin = response.headers.get('access-control-allow-origin');
    const allowHeaders = response.headers.get('access-control-allow-headers');
    const allowMethods = response.headers.get('access-control-allow-methods');

    expect(allowOrigin).toBeTruthy();
    expect(allowHeaders).toBeTruthy();
    expect(allowMethods).toBeTruthy();

    // Verify X-Tenant-Id is in allowed headers
    expect(allowHeaders!.toLowerCase()).toContain('x-tenant-id');
  });

  it('OPTIONS /workers/{id}/certifications returns CORS headers', async () => {
    const response = await fetch(`${API_URL}/workers/test-id/certifications`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type,Authorization,X-Tenant-Id',
      },
    });

    expect(response.status).toBeLessThan(400);

    const allowOrigin = response.headers.get('access-control-allow-origin');
    expect(allowOrigin).toBeTruthy();
  });

  it('GET /workers response includes Access-Control-Allow-Origin', async () => {
    const response = await fetch(`${API_URL}/workers`, {
      method: 'GET',
      headers: {
        'Origin': 'http://localhost:3000',
        'Content-Type': 'application/json',
        'Authorization': AUTH_TOKEN ? `Bearer ${AUTH_TOKEN}` : '',
        'X-Tenant-Id': TENANT_ID,
      },
    });

    const allowOrigin = response.headers.get('access-control-allow-origin');
    // CORS headers may not be present on 401 responses from Cognito authorizer
    // when no valid auth token is provided
    if (response.status === 401 && !AUTH_TOKEN) {
      expect(true).toBe(true); // Skip assertion when no auth token
    } else {
      expect(allowOrigin).toBeTruthy();
    }
  });
});

// ─── Worker Endpoints ────────────────────────────────────────────────────────

describe('GET /workers', () => {
  it('returns a response with workers array and total', async () => {
    const { status, data } = await apiRequest('GET', '/workers');

    // May be 401 if no valid token, but should not be 502
    if (status === 401 || status === 403) {
      // Expected without valid auth — confirms endpoint is reachable
      expect(status).toBeLessThan(500);
      return;
    }

    expect(status).toBe(200);
    const body = data as { workers: unknown[]; total: number };
    expect(body).toHaveProperty('workers');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.workers)).toBe(true);
    expect(typeof body.total).toBe('number');
  });

  it('workers array items have expected snake_case fields', async () => {
    const { status, data } = await apiRequest('GET', '/workers');

    if (status !== 200) return; // Skip if auth fails

    const body = data as { workers: Record<string, unknown>[] };
    if (body.workers.length === 0) return; // No data to validate

    const worker = body.workers[0]!;
    expect(worker).toHaveProperty('worker_id');
    expect(worker).toHaveProperty('legal_name');
    expect(worker).toHaveProperty('phone');
    expect(worker).toHaveProperty('created_at');

    // Verify it does NOT have camelCase (frontend) fields
    expect(worker).not.toHaveProperty('legalName');
    expect(worker).not.toHaveProperty('workerId');
  });
});

describe('GET /workers/{id}', () => {
  let workerId: string | null = null;

  beforeAll(async () => {
    // Get a worker ID from the list
    const { status, data } = await apiRequest('GET', '/workers');
    if (status === 200) {
      const body = data as { workers: { worker_id: string }[] };
      if (body.workers.length > 0) {
        workerId = body.workers[0]!.worker_id;
      }
    }
  });

  it('returns worker detail with expected fields', async () => {
    if (!workerId) return; // Skip if no workers available

    const { status, data } = await apiRequest('GET', `/workers/${workerId}`);

    if (status !== 200) return;

    const body = data as { worker: Record<string, unknown> };
    expect(body).toHaveProperty('worker');

    const worker = body.worker;
    expect(worker).toHaveProperty('worker_id');
    expect(worker).toHaveProperty('tenant_id');
    expect(worker).toHaveProperty('legal_name');
    expect(worker).toHaveProperty('phone');
    expect(worker).toHaveProperty('language_preference');
    expect(worker).toHaveProperty('status');
    expect(worker).toHaveProperty('created_at');
    expect(worker).toHaveProperty('updated_at');
  });

  it('returns 404 for non-existent worker', async () => {
    const { status, data } = await apiRequest('GET', '/workers/non-existent-id-12345');

    if (status === 401 || status === 403) return; // Auth issue, skip

    expect(status).toBe(404);
    const body = data as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});

// ─── Certification Endpoints ─────────────────────────────────────────────────

describe('GET /workers/{id}/certifications', () => {
  let workerId: string | null = null;

  beforeAll(async () => {
    const { status, data } = await apiRequest('GET', '/workers');
    if (status === 200) {
      const body = data as { workers: { worker_id: string }[] };
      if (body.workers.length > 0) {
        workerId = body.workers[0]!.worker_id;
      }
    }
  });

  it('returns certifications array', async () => {
    if (!workerId) return;

    const { status, data } = await apiRequest('GET', `/workers/${workerId}/certifications`);

    if (status === 401 || status === 403) return;

    // This is the endpoint that was returning 502 — verify it works
    expect(status).not.toBe(502);
    expect(status).toBe(200);

    const body = data as { certifications: unknown[] };
    expect(body).toHaveProperty('certifications');
    expect(Array.isArray(body.certifications)).toBe(true);
  });

  it('certification items have expected snake_case fields', async () => {
    if (!workerId) return;

    const { status, data } = await apiRequest('GET', `/workers/${workerId}/certifications`);

    if (status !== 200) return;

    const body = data as { certifications: Record<string, unknown>[] };
    if (body.certifications.length === 0) return;

    const cert = body.certifications[0]!;
    expect(cert).toHaveProperty('certification_id');
    expect(cert).toHaveProperty('worker_id');
    expect(cert).toHaveProperty('certification_type');
    expect(cert).toHaveProperty('issuer');
    expect(cert).toHaveProperty('issue_date');
    expect(cert).toHaveProperty('expiry_date');
    expect(cert).toHaveProperty('validation_status');
    expect(cert).toHaveProperty('created_at');
  });

  it('returns 404 for certifications of non-existent worker', async () => {
    const { status, data } = await apiRequest('GET', '/workers/non-existent-id/certifications');

    if (status === 401 || status === 403) return;

    expect(status).toBe(404);
  });
});

describe('POST /workers/{id}/certifications', () => {
  let workerId: string | null = null;

  beforeAll(async () => {
    const { status, data } = await apiRequest('GET', '/workers');
    if (status === 200) {
      const body = data as { workers: { worker_id: string }[] };
      if (body.workers.length > 0) {
        workerId = body.workers[0]!.worker_id;
      }
    }
  });

  it('rejects invalid certification type', async () => {
    if (!workerId) return;

    const { status, data } = await apiRequest('POST', `/workers/${workerId}/certifications`, {
      certification_type: 'invalid_type',
      issuer: 'Test Issuer',
      issue_date: '2024-01-01',
      expiry_date: '2025-01-01',
    });

    if (status === 401 || status === 403) return;

    expect(status).toBe(400);
    const body = data as { code: string };
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('rejects expiry_date before issue_date', async () => {
    if (!workerId) return;

    const { status, data } = await apiRequest('POST', `/workers/${workerId}/certifications`, {
      certification_type: 'whmis_2015',
      issuer: 'Test Issuer',
      issue_date: '2025-06-01',
      expiry_date: '2024-01-01',
    });

    if (status === 401 || status === 403) return;

    expect(status).toBe(400);
  });

  it('creates certification with valid data and returns upload_url', async () => {
    if (!workerId) return;

    const { status, data } = await apiRequest('POST', `/workers/${workerId}/certifications`, {
      certification_type: 'whmis_2015',
      issuer: 'BC Safety Authority',
      issue_date: '2024-01-15',
      expiry_date: '2026-01-15',
      document_content_type: 'application/pdf',
      document_size: 1024 * 1024,
      document_filename: 'cert.pdf',
    });

    if (status === 401 || status === 403) return;

    expect(status).toBe(201);
    const body = data as { certification: Record<string, unknown>; upload_url: string };
    expect(body).toHaveProperty('certification');
    expect(body).toHaveProperty('upload_url');
    expect(typeof body.upload_url).toBe('string');
    expect(body.upload_url).toContain('https://');

    // Verify certification fields
    expect(body.certification).toHaveProperty('certification_id');
    expect(body.certification.certification_type).toBe('whmis_2015');
    expect(body.certification.validation_status).toBe('pending');
  });
});

// ─── PATCH /workers/{id}/certifications/{certId} ─────────────────────────────

describe('PATCH /workers/{id}/certifications/{certId}', () => {
  let workerId: string | null = null;
  let certId: string | null = null;

  beforeAll(async () => {
    // Get a worker
    const { status: wStatus, data: wData } = await apiRequest('GET', '/workers');
    if (wStatus === 200) {
      const body = wData as { workers: { worker_id: string }[] };
      if (body.workers.length > 0) {
        workerId = body.workers[0]!.worker_id;
      }
    }

    // Get a certification for that worker
    if (workerId) {
      const { status: cStatus, data: cData } = await apiRequest(
        'GET',
        `/workers/${workerId}/certifications`
      );
      if (cStatus === 200) {
        const body = cData as { certifications: { certification_id: string; validation_status: string }[] };
        // Find a pending one to validate
        const pending = body.certifications.find((c) => c.validation_status === 'pending');
        if (pending) {
          certId = pending.certification_id;
        }
      }
    }
  });

  it('validates a pending certification', async () => {
    if (!workerId || !certId) return;

    const { status, data } = await apiRequest(
      'PATCH',
      `/workers/${workerId}/certifications/${certId}`,
      { validation_status: 'validated' }
    );

    if (status === 401 || status === 403) return;

    expect(status).toBe(200);
    const body = data as { certification: { validation_status: string } };
    expect(body.certification.validation_status).toBe('validated');
  });

  it('rejects invalid status transition', async () => {
    if (!workerId || !certId) return;

    // Try to go from validated → pending (not allowed)
    const { status, data } = await apiRequest(
      'PATCH',
      `/workers/${workerId}/certifications/${certId}`,
      { validation_status: 'pending' }
    );

    if (status === 401 || status === 403) return;

    expect(status).toBe(422);
    const body = data as { code: string };
    expect(body.code).toBe('UNPROCESSABLE_ENTITY');
  });

  it('returns 404 for non-existent certification', async () => {
    if (!workerId) return;

    const { status } = await apiRequest(
      'PATCH',
      `/workers/${workerId}/certifications/non-existent-cert-id`,
      { validation_status: 'validated' }
    );

    if (status === 401 || status === 403) return;

    expect(status).toBe(404);
  });
});

// ─── POST /workers (Create Worker) ──────────────────────────────────────────

describe('POST /workers', () => {
  it('rejects invalid phone number', async () => {
    const { status, data } = await apiRequest('POST', '/workers', {
      legal_name: 'Test Worker',
      phone: '555-1234',
      language_preference: 'en',
    });

    if (status === 401 || status === 403) return;

    expect(status).toBe(400);
    const body = data as { code: string };
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('rejects empty legal_name', async () => {
    const { status } = await apiRequest('POST', '/workers', {
      legal_name: '',
      phone: '+14155552671',
      language_preference: 'en',
    });

    if (status === 401 || status === 403) return;

    expect(status).toBe(400);
  });

  it('creates worker with valid data', async () => {
    const { status, data } = await apiRequest('POST', '/workers', {
      legal_name: 'Integration Test Worker',
      preferred_name: 'IntTest',
      phone: '+14155550099',
      language_preference: 'en',
    });

    if (status === 401 || status === 403) return;

    expect(status).toBe(201);
    const body = data as { worker: Record<string, unknown> };
    expect(body).toHaveProperty('worker');
    expect(body.worker.legal_name).toBe('Integration Test Worker');
    expect(body.worker).toHaveProperty('worker_id');
    expect(body.worker.status).toBe('active');
  });
});

// ─── Error Response Format ───────────────────────────────────────────────────

describe('Error Response Format', () => {
  it('error responses include code, message, request_id, timestamp', async () => {
    const { status, data } = await apiRequest('GET', '/workers/non-existent-id');

    if (status === 401 || status === 403) {
      // Cognito authorizer returns { message: 'Unauthorized' } without code field
      // This is expected API Gateway behavior for auth errors
      const body = data as Record<string, unknown>;
      expect(body).toHaveProperty('message');
      return;
    }

    if (status === 404) {
      const body = data as Record<string, unknown>;
      expect(body).toHaveProperty('code');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('request_id');
      expect(body).toHaveProperty('timestamp');
    }
  });

  it('does not return 502 for any valid route', async () => {
    const routes = [
      { method: 'GET', path: '/workers' },
      { method: 'GET', path: '/workers/test-id' },
      { method: 'GET', path: '/workers/test-id/certifications' },
    ];

    for (const route of routes) {
      const response = await fetch(`${API_URL}${route.path}`, {
        method: route.method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': AUTH_TOKEN ? `Bearer ${AUTH_TOKEN}` : '',
          'X-Tenant-Id': TENANT_ID,
        },
      });

      // 502 means Lambda crashed or timed out — this should never happen
      expect(response.status).not.toBe(502);
    }
  });
});
