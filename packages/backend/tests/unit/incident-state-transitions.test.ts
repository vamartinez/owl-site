/**
 * Unit tests for incident state transition, severity, regulatory flag,
 * and external status endpoints.
 *
 * Requirements: 4.3, 4.4, 5.2, 5.3, 5.4, 16.1, 16.2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
const mockPublishToSns = vi.fn();

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
  vi.doMock('@aws-sdk/client-scheduler', () => ({
    SchedulerClient: vi.fn(() => ({})),
    CreateScheduleCommand: vi.fn(),
  }));
  vi.doMock('../../src/shared/event-publisher.js', () => ({
    publishToSns: mockPublishToSns,
    buildPlatformEvent: vi.fn((params: Record<string, unknown>) => ({
      event_id: 'evt-1',
      ...params,
    })),
    publishEvent: mockPublishToSns,
  }));
};

// Set env vars before imports
process.env['INCIDENT_EVENT_BUS_NAME'] = 'arn:aws:sns:us-east-1:123456789:test-topic';
process.env['TABLE_PREFIX'] = 'test_';

const tenantAdminClaims = {
  sub: 'user-1',
  email: 'admin@test.com',
  'custom:tenant_id': 'tenant-1',
  'custom:role': 'tenant_admin',
};

const csoClaims = {
  sub: 'user-2',
  email: 'cso@test.com',
  'custom:tenant_id': 'tenant-1',
  'custom:role': 'cso',
};

const supervisorClaims = {
  sub: 'user-3',
  email: 'supervisor@test.com',
  'custom:tenant_id': 'tenant-1',
  'custom:role': 'supervisor',
  'custom:assigned_sites': 'site-1,site-2',
};

const workerClaims = {
  sub: 'user-4',
  email: 'worker@test.com',
  'custom:tenant_id': 'tenant-1',
  'custom:role': 'worker',
};

function makeIncidentRecord(overrides: Record<string, unknown> = {}) {
  return {
    incident_id: 'inc-1',
    tenant_id: 'tenant-1',
    site_id: 'site-1',
    title: 'Test Incident',
    description: 'A test incident',
    incident_type: 'injury',
    incident_datetime: '2024-01-01T10:00:00Z',
    report_datetime: '2024-01-01T10:05:00Z',
    location: 'Building A',
    persons_involved_count: 1,
    reporting_user_id: 'user-1',
    reporting_user_name: 'admin@test.com',
    severity: 'medium',
    regulatory_flag: 'internal_only',
    status: 'open',
    external_report_status: 'not_reportable',
    regulatory_indicators: {
      medical_treatment_beyond_first_aid: false,
      lost_time: false,
      hospitalization: false,
      fatality: false,
      amputation: false,
      loss_of_eye: false,
      structural_collapse: false,
      hazardous_substance_release: false,
      fire_or_explosion: false,
    },
    jurisdiction: 'british_columbia',
    created_at: '2024-01-01T10:05:00Z',
    updated_at: '2024-01-01T10:05:00Z',
    ...overrides,
  };
}

describe('incidents: PATCH /incidents/{id}/state', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockPublishToSns.mockReset();
    mockPublishToSns.mockResolvedValue({ event_id: 'evt-1' });
    mockAwsSdk();
  });

  it('transitions from open to under_review successfully (Req 5.2, 5.3)', async () => {
    const incident = makeIncidentRecord({ status: 'open' });
    // GetCommand: return existing incident
    mockSend.mockResolvedValueOnce({ Item: incident });
    // UpdateCommand: return updated incident
    mockSend.mockResolvedValueOnce({ Attributes: { ...incident, status: 'under_review' } });
    // PutCommand: timeline event
    mockSend.mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/state',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ status: 'under_review' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.incident.status).toBe('under_review');
  });

  it('rejects invalid state transition with 422 and valid transitions (Req 5.4)', async () => {
    const incident = makeIncidentRecord({ status: 'open' });
    // GetCommand: return existing incident
    mockSend.mockResolvedValueOnce({ Item: incident });

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/state',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ status: 'closed' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(422);
    const body = JSON.parse(response.body);
    expect(body.details.current_state).toBe('open');
    expect(body.details.valid_transitions).toContain('under_review');
    expect(body.details.valid_transitions).toContain('regulatory_review');
  });

  it('returns 400 for invalid status value', async () => {
    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/state',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ status: 'invalid_status' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when incident not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/state',
      pathParameters: { id: 'nonexistent' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ status: 'under_review' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(404);
  });

  it('returns 400 when body is missing', async () => {
    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/state',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });
});

describe('incidents: PATCH /incidents/{id}/severity', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockPublishToSns.mockReset();
    mockPublishToSns.mockResolvedValue({ event_id: 'evt-1' });
    mockAwsSdk();
  });

  it('changes severity successfully with audit trail (Req 4.3)', async () => {
    const incident = makeIncidentRecord({ severity: 'low' });
    // GetCommand
    mockSend.mockResolvedValueOnce({ Item: incident });
    // UpdateCommand
    mockSend.mockResolvedValueOnce({ Attributes: { ...incident, severity: 'critical' } });
    // PutCommand: timeline event
    mockSend.mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/severity',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ severity: 'critical' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.incident.severity).toBe('critical');
  });

  it('returns 400 for invalid severity value', async () => {
    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/severity',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ severity: 'extreme' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when incident not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/severity',
      pathParameters: { id: 'nonexistent' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ severity: 'high' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(404);
  });
});

describe('incidents: PATCH /incidents/{id}/regulatory-flag', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockPublishToSns.mockReset();
    mockPublishToSns.mockResolvedValue({ event_id: 'evt-1' });
    mockAwsSdk();
  });

  it('changes regulatory flag successfully (Req 4.4)', async () => {
    const incident = makeIncidentRecord({ regulatory_flag: 'internal_only' });
    // GetCommand
    mockSend.mockResolvedValueOnce({ Item: incident });
    // UpdateCommand
    mockSend.mockResolvedValueOnce({
      Attributes: { ...incident, regulatory_flag: 'potentially_reportable' },
    });
    // PutCommand: timeline event
    mockSend.mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/regulatory-flag',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ regulatory_flag: 'potentially_reportable' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.incident.regulatory_flag).toBe('potentially_reportable');
  });

  it('publishes immediate notification when flag is immediately_reportable (Req 4.4)', async () => {
    const incident = makeIncidentRecord({ regulatory_flag: 'internal_only' });
    // GetCommand
    mockSend.mockResolvedValueOnce({ Item: incident });
    // UpdateCommand
    mockSend.mockResolvedValueOnce({
      Attributes: { ...incident, regulatory_flag: 'immediately_reportable' },
    });
    // PutCommand: timeline event
    mockSend.mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/regulatory-flag',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ regulatory_flag: 'immediately_reportable' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    // Verify SNS was called (for the immediate notification + incident.updated)
    expect(mockPublishToSns).toHaveBeenCalled();
  });

  it('returns 400 for invalid regulatory flag', async () => {
    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/regulatory-flag',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ regulatory_flag: 'invalid_flag' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });
});

describe('incidents: PATCH /incidents/{id}/external-status', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockPublishToSns.mockReset();
    mockPublishToSns.mockResolvedValue({ event_id: 'evt-1' });
    mockAwsSdk();
  });

  it('changes external status successfully for tenant_admin (Req 16.1, 16.2)', async () => {
    const incident = makeIncidentRecord({ external_report_status: 'not_reportable' });
    // GetCommand
    mockSend.mockResolvedValueOnce({ Item: incident });
    // UpdateCommand
    mockSend.mockResolvedValueOnce({
      Attributes: { ...incident, external_report_status: 'reported_worksafebc' },
    });
    // PutCommand: timeline event
    mockSend.mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/external-status',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ external_report_status: 'reported_worksafebc' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.incident.external_report_status).toBe('reported_worksafebc');
  });

  it('allows cso role to change external status (Req 21.2)', async () => {
    const incident = makeIncidentRecord({ external_report_status: 'not_reportable' });
    // GetCommand
    mockSend.mockResolvedValueOnce({ Item: incident });
    // UpdateCommand
    mockSend.mockResolvedValueOnce({
      Attributes: { ...incident, external_report_status: 'external_report_pending' },
    });
    // PutCommand: timeline event
    mockSend.mockResolvedValueOnce({});

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/external-status',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: csoClaims } },
      body: JSON.stringify({ external_report_status: 'external_report_pending' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(200);
  });

  it('returns 403 for supervisor role (Req 21.2)', async () => {
    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/external-status',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: supervisorClaims } },
      body: JSON.stringify({ external_report_status: 'reported_osha' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(403);
  });

  it('returns 403 for worker role (Req 21.2)', async () => {
    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/external-status',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: workerClaims } },
      body: JSON.stringify({ external_report_status: 'reported_osha' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(403);
  });

  it('returns 400 for invalid external report status', async () => {
    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/external-status',
      pathParameters: { id: 'inc-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ external_report_status: 'invalid_status' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when incident not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const { handler } = await import('../../src/services/incidents/handler.js');

    const event = {
      httpMethod: 'PATCH',
      resource: '/incidents/{id}/external-status',
      pathParameters: { id: 'nonexistent' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: tenantAdminClaims } },
      body: JSON.stringify({ external_report_status: 'reported_osha' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(404);
  });
});
