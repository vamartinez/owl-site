/**
 * Unit tests for the Findings Review Service.
 * Tests finding lifecycle, review logic, and enforcement action creation.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FindingStatus, Severity, EnforcementActionType } from '../../src/shared/types/common.js';
import {
  determineInitialStatus,
  canBeReviewed,
  isUnreviewed,
  validateDismissalReason,
} from '../../src/services/findings/review.js';
import {
  MIN_DISMISSAL_REASON_LENGTH,
  UNREVIEWED_STATUSES,
  HIGH_SEVERITY_LEVELS,
  LOW_SEVERITY_LEVELS,
} from '../../src/services/findings/types.js';

// --- Pure function tests (no mocking needed) ---

describe('findings-review: determineInitialStatus', () => {
  it('returns pending_review for critical severity (Req 9.2)', () => {
    expect(determineInitialStatus(Severity.CRITICAL)).toBe(FindingStatus.PENDING_REVIEW);
  });

  it('returns pending_review for high severity (Req 9.2)', () => {
    expect(determineInitialStatus(Severity.HIGH)).toBe(FindingStatus.PENDING_REVIEW);
  });

  it('returns generated for medium severity (Req 9.3)', () => {
    expect(determineInitialStatus(Severity.MEDIUM)).toBe(FindingStatus.GENERATED);
  });

  it('returns generated for low severity (Req 9.3)', () => {
    expect(determineInitialStatus(Severity.LOW)).toBe(FindingStatus.GENERATED);
  });
});

describe('findings-review: canBeReviewed', () => {
  it('allows review of generated findings', () => {
    expect(canBeReviewed(FindingStatus.GENERATED)).toBe(true);
  });

  it('allows review of pending_review findings', () => {
    expect(canBeReviewed(FindingStatus.PENDING_REVIEW)).toBe(true);
  });

  it('does not allow review of confirmed findings', () => {
    expect(canBeReviewed(FindingStatus.CONFIRMED)).toBe(false);
  });

  it('does not allow review of dismissed findings', () => {
    expect(canBeReviewed(FindingStatus.DISMISSED)).toBe(false);
  });

  it('does not allow review of corrected findings', () => {
    expect(canBeReviewed(FindingStatus.CORRECTED)).toBe(false);
  });
});

describe('findings-review: isUnreviewed', () => {
  it('generated is unreviewed (Req 9.6)', () => {
    expect(isUnreviewed(FindingStatus.GENERATED)).toBe(true);
  });

  it('pending_review is unreviewed (Req 9.6)', () => {
    expect(isUnreviewed(FindingStatus.PENDING_REVIEW)).toBe(true);
  });

  it('confirmed is not unreviewed', () => {
    expect(isUnreviewed(FindingStatus.CONFIRMED)).toBe(false);
  });

  it('dismissed is not unreviewed', () => {
    expect(isUnreviewed(FindingStatus.DISMISSED)).toBe(false);
  });

  it('corrected is not unreviewed', () => {
    expect(isUnreviewed(FindingStatus.CORRECTED)).toBe(false);
  });
});

describe('findings-review: validateDismissalReason', () => {
  it('returns error when reason is undefined (Req 9.5)', () => {
    const result = validateDismissalReason(undefined);
    expect(result).not.toBeNull();
    expect(result).toContain('required');
  });

  it('returns error when reason is empty string (Req 9.5)', () => {
    const result = validateDismissalReason('');
    expect(result).not.toBeNull();
  });

  it('returns error when reason is less than 10 chars (Req 9.5)', () => {
    const result = validateDismissalReason('too short');
    expect(result).not.toBeNull();
    expect(result).toContain('10');
  });

  it('returns error for exactly 9 characters', () => {
    const result = validateDismissalReason('123456789');
    expect(result).not.toBeNull();
  });

  it('returns null for exactly 10 characters (Req 9.5)', () => {
    const result = validateDismissalReason('1234567890');
    expect(result).toBeNull();
  });

  it('returns null for reason longer than 10 chars', () => {
    const result = validateDismissalReason('This is a valid dismissal reason with enough detail');
    expect(result).toBeNull();
  });
});

// --- Constants verification ---

describe('findings-review: constants', () => {
  it('MIN_DISMISSAL_REASON_LENGTH is 10', () => {
    expect(MIN_DISMISSAL_REASON_LENGTH).toBe(10);
  });

  it('UNREVIEWED_STATUSES contains generated and pending_review', () => {
    expect(UNREVIEWED_STATUSES).toContain(FindingStatus.GENERATED);
    expect(UNREVIEWED_STATUSES).toContain(FindingStatus.PENDING_REVIEW);
    expect(UNREVIEWED_STATUSES).toHaveLength(2);
  });

  it('HIGH_SEVERITY_LEVELS contains critical and high', () => {
    expect(HIGH_SEVERITY_LEVELS).toContain(Severity.CRITICAL);
    expect(HIGH_SEVERITY_LEVELS).toContain(Severity.HIGH);
    expect(HIGH_SEVERITY_LEVELS).toHaveLength(2);
  });

  it('LOW_SEVERITY_LEVELS contains medium and low', () => {
    expect(LOW_SEVERITY_LEVELS).toContain(Severity.MEDIUM);
    expect(LOW_SEVERITY_LEVELS).toContain(Severity.LOW);
    expect(LOW_SEVERITY_LEVELS).toHaveLength(2);
  });
});


// --- Handler Routing Tests ---

describe('findings-review: handler routing', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const mockAwsSdk = () => {
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({}) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      UpdateCommand: vi.fn(),
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

  const supervisorClaims = {
    sub: 'user-1',
    'custom:tenant_id': 'tenant-1',
    'custom:role': 'supervisor',
  };

  const workerClaims = {
    sub: 'user-1',
    'custom:tenant_id': 'tenant-1',
    'custom:role': 'worker',
  };

  it('returns 400 for unsupported routes', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/findings/handler.js');

    const event = {
      httpMethod: 'DELETE',
      resource: '/findings/{id}',
      pathParameters: { id: 'finding-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: supervisorClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('Unsupported route');
  });

  it('returns 401 for unauthenticated requests', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/findings/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/findings',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(401);
  });

  it('returns 403 when worker role tries to read findings', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/findings/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/findings',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: workerClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(403);
  });

  it('returns 403 when worker role tries to review a finding', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/findings/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/findings/{id}/review',
      pathParameters: { id: 'finding-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: workerClaims } },
      body: JSON.stringify({ action: 'confirm' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(403);
  });

  it('returns 400 when POST /findings/{id}/review has no body', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/findings/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/findings/{id}/review',
      pathParameters: { id: 'finding-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: supervisorClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('Request body is required');
  });

  it('returns 400 when POST /findings/{id}/review has invalid action', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/findings/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/findings/{id}/review',
      pathParameters: { id: 'finding-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: supervisorClaims } },
      body: JSON.stringify({ action: 'invalid_action' }),
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('Validation failed');
  });

  it('returns 400 when GET /findings has invalid status filter', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/findings/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/findings',
      pathParameters: null,
      queryStringParameters: { status: 'invalid_status' },
      headers: {},
      requestContext: { authorizer: { claims: supervisorClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('Invalid status filter');
  });

  it('returns 400 when GET /findings has invalid severity filter', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/findings/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/findings',
      pathParameters: null,
      queryStringParameters: { severity: 'extreme' },
      headers: {},
      requestContext: { authorizer: { claims: supervisorClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('Invalid severity filter');
  });

  it('returns 400 when GET /findings has invalid limit', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/findings/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/findings',
      pathParameters: null,
      queryStringParameters: { limit: '0' },
      headers: {},
      requestContext: { authorizer: { claims: supervisorClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('limit must be a number between 1 and 100');
  });

  it('returns 400 when finding ID is missing for GET /findings/{id}', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/findings/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/findings/{id}',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: supervisorClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('Finding ID is required');
  });
});
