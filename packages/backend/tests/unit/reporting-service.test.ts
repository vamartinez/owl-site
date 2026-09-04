/**
 * Unit tests for the Reporting Service.
 * Tests summary generation logic, CSV export, PDF export, and handler routing.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DecisionResult, FindingStatus, CertificationStatus } from '../../src/shared/types/common.js';
import type {
  AccessDecisionCounts,
  FindingCounts,
  UnresolvedEnforcementSummary,
  CertificationComplianceItem,
  DailyComplianceSummary,
  Report,
} from '../../src/services/reporting/types.js';

// --- Pure function tests: AI Narrative Generation ---

describe('reporting: generateAINarrative', () => {
  let generateAINarrative: typeof import('../../src/services/reporting/summary-generator.js').generateAINarrative;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({ send: vi.fn() }) },
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

    const mod = await import('../../src/services/reporting/summary-generator.js');
    generateAINarrative = mod.generateAINarrative;
  });

  it('returns "no activity recorded" narrative when noActivity is true (Req 13.6)', () => {
    const accessDecisions: AccessDecisionCounts = { allowed: 0, conditional: 0, denied: 0, total: 0 };
    const findings: FindingCounts = { generated: 0, confirmed: 0, dismissed: 0, pending_review: 0, total: 0 };
    const enforcement: UnresolvedEnforcementSummary = { count: 0, actions: [] };
    const certCompliance: CertificationComplianceItem[] = [];

    const narrative = generateAINarrative(accessDecisions, findings, enforcement, certCompliance, true);

    expect(narrative.summary_text).toContain('No activity was recorded');
    expect(narrative.risk_trend).toBe('stable');
    expect(narrative.key_observations).toContain('No access requests processed');
  });

  it('includes denied access observations when denials exist', () => {
    const accessDecisions: AccessDecisionCounts = { allowed: 5, conditional: 1, denied: 3, total: 9 };
    const findings: FindingCounts = { generated: 0, confirmed: 0, dismissed: 0, pending_review: 0, total: 0 };
    const enforcement: UnresolvedEnforcementSummary = { count: 0, actions: [] };
    const certCompliance: CertificationComplianceItem[] = [];

    const narrative = generateAINarrative(accessDecisions, findings, enforcement, certCompliance, false);

    expect(narrative.key_observations.some((o) => o.includes('3 access request(s) denied'))).toBe(true);
  });

  it('includes conditional access observations', () => {
    const accessDecisions: AccessDecisionCounts = { allowed: 5, conditional: 2, denied: 0, total: 7 };
    const findings: FindingCounts = { generated: 0, confirmed: 0, dismissed: 0, pending_review: 0, total: 0 };
    const enforcement: UnresolvedEnforcementSummary = { count: 0, actions: [] };
    const certCompliance: CertificationComplianceItem[] = [];

    const narrative = generateAINarrative(accessDecisions, findings, enforcement, certCompliance, false);

    expect(narrative.key_observations.some((o) => o.includes('2 conditional'))).toBe(true);
  });

  it('includes confirmed findings observations', () => {
    const accessDecisions: AccessDecisionCounts = { allowed: 5, conditional: 0, denied: 0, total: 5 };
    const findings: FindingCounts = { generated: 1, confirmed: 3, dismissed: 1, pending_review: 0, total: 5 };
    const enforcement: UnresolvedEnforcementSummary = { count: 0, actions: [] };
    const certCompliance: CertificationComplianceItem[] = [];

    const narrative = generateAINarrative(accessDecisions, findings, enforcement, certCompliance, false);

    expect(narrative.key_observations.some((o) => o.includes('3 safety finding(s) confirmed'))).toBe(true);
    expect(narrative.regulatory_highlights.length).toBeGreaterThan(0);
  });

  it('includes pending review findings in recommended focus areas', () => {
    const accessDecisions: AccessDecisionCounts = { allowed: 5, conditional: 0, denied: 0, total: 5 };
    const findings: FindingCounts = { generated: 0, confirmed: 0, dismissed: 0, pending_review: 4, total: 4 };
    const enforcement: UnresolvedEnforcementSummary = { count: 0, actions: [] };
    const certCompliance: CertificationComplianceItem[] = [];

    const narrative = generateAINarrative(accessDecisions, findings, enforcement, certCompliance, false);

    expect(narrative.recommended_focus_areas.some((a) => a.includes('pending safety findings'))).toBe(true);
  });

  it('includes unresolved enforcement actions in observations', () => {
    const accessDecisions: AccessDecisionCounts = { allowed: 5, conditional: 0, denied: 0, total: 5 };
    const findings: FindingCounts = { generated: 0, confirmed: 0, dismissed: 0, pending_review: 0, total: 0 };
    const enforcement: UnresolvedEnforcementSummary = { count: 3, actions: [] };
    const certCompliance: CertificationComplianceItem[] = [];

    const narrative = generateAINarrative(accessDecisions, findings, enforcement, certCompliance, false);

    expect(narrative.key_observations.some((o) => o.includes('3 unresolved'))).toBe(true);
    expect(narrative.recommended_focus_areas.some((a) => a.includes('enforcement'))).toBe(true);
  });

  it('detects expired certifications', () => {
    const accessDecisions: AccessDecisionCounts = { allowed: 5, conditional: 0, denied: 0, total: 5 };
    const findings: FindingCounts = { generated: 0, confirmed: 0, dismissed: 0, pending_review: 0, total: 0 };
    const enforcement: UnresolvedEnforcementSummary = { count: 0, actions: [] };
    const certCompliance: CertificationComplianceItem[] = [
      {
        worker_id: 'w1',
        worker_name: 'John',
        certification_type: 'whmis_2015',
        status: CertificationStatus.EXPIRED,
        compliance_status: 'expired',
        expiry_date: '2024-01-01',
      },
    ];

    const narrative = generateAINarrative(accessDecisions, findings, enforcement, certCompliance, false);

    expect(narrative.key_observations.some((o) => o.includes('expired certification'))).toBe(true);
    expect(narrative.recommended_focus_areas.some((a) => a.includes('expired'))).toBe(true);
  });

  it('sets risk_trend to worsening when many risk indicators', () => {
    const accessDecisions: AccessDecisionCounts = { allowed: 5, conditional: 0, denied: 3, total: 8 };
    const findings: FindingCounts = { generated: 0, confirmed: 3, dismissed: 0, pending_review: 0, total: 3 };
    const enforcement: UnresolvedEnforcementSummary = { count: 2, actions: [] };
    const certCompliance: CertificationComplianceItem[] = [];

    const narrative = generateAINarrative(accessDecisions, findings, enforcement, certCompliance, false);

    // 3 denied + 3 confirmed + 2 enforcement = 8 > 5
    expect(narrative.risk_trend).toBe('worsening');
  });

  it('sets risk_trend to improving when no risk indicators', () => {
    const accessDecisions: AccessDecisionCounts = { allowed: 10, conditional: 0, denied: 0, total: 10 };
    const findings: FindingCounts = { generated: 2, confirmed: 0, dismissed: 2, pending_review: 0, total: 4 };
    const enforcement: UnresolvedEnforcementSummary = { count: 0, actions: [] };
    const certCompliance: CertificationComplianceItem[] = [];

    const narrative = generateAINarrative(accessDecisions, findings, enforcement, certCompliance, false);

    expect(narrative.risk_trend).toBe('improving');
  });
});

// --- CSV Export Tests ---

describe('reporting: CSV export', () => {
  let generateDailySummaryCsv: typeof import('../../src/services/reporting/csv-export.js').generateDailySummaryCsv;
  let generateReportCsv: typeof import('../../src/services/reporting/csv-export.js').generateReportCsv;
  let escapeCsvField: typeof import('../../src/services/reporting/csv-export.js').escapeCsvField;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/services/reporting/csv-export.js');
    generateDailySummaryCsv = mod.generateDailySummaryCsv;
    generateReportCsv = mod.generateReportCsv;
    escapeCsvField = mod.escapeCsvField;
  });

  it('escapeCsvField wraps fields with commas in quotes', () => {
    expect(escapeCsvField('hello, world')).toBe('"hello, world"');
  });

  it('escapeCsvField wraps fields with quotes in escaped quotes', () => {
    expect(escapeCsvField('say "hello"')).toBe('"say ""hello"""');
  });

  it('escapeCsvField wraps fields with newlines in quotes', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('escapeCsvField returns plain value when no special chars', () => {
    expect(escapeCsvField('simple')).toBe('simple');
  });

  it('generates CSV with all sections for a summary with data (Req 13.4)', () => {
    const summary = createMockSummary(false);
    const csv = generateDailySummaryCsv(summary);

    expect(csv).toContain('Daily Compliance Summary');
    expect(csv).toContain('Access Decisions');
    expect(csv).toContain('Safety Findings');
    expect(csv).toContain('Unresolved Enforcement Actions');
    expect(csv).toContain('Certification Compliance');
    expect(csv).toContain('Active Policy Versions');
    expect(csv).toContain('AI Analysis');
  });

  it('generates CSV with zero counts for no-activity summary (Req 13.6)', () => {
    const summary = createMockSummary(true);
    const csv = generateDailySummaryCsv(summary);

    expect(csv).toContain('No Activity,true');
    expect(csv).toContain('Allowed,0');
    expect(csv).toContain('Total,0');
  });

  it('generates report CSV with records array', () => {
    const report: Report = {
      report_id: 'r1',
      tenant_id: 't1',
      site_id: 's1',
      report_type: 'access_decision_log',
      status: 'completed',
      reporting_period_start: '2024-01-01T00:00:00Z',
      reporting_period_end: '2024-01-02T00:00:00Z',
      requested_by: 'user1',
      requested_at: '2024-01-02T01:00:00Z',
    };

    const data = {
      records: [
        { decision_id: 'd1', result: 'allowed', timestamp: '2024-01-01T08:00:00Z' },
        { decision_id: 'd2', result: 'denied', timestamp: '2024-01-01T09:00:00Z' },
      ],
    };

    const csv = generateReportCsv(report, data);

    expect(csv).toContain('Report Metadata');
    expect(csv).toContain('decision_id,result,timestamp');
    expect(csv).toContain('d1,allowed');
    expect(csv).toContain('d2,denied');
  });
});

// --- Handler Routing Tests ---

describe('reporting: handler routing', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const mockAwsSdk = () => {
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({ send: vi.fn().mockResolvedValue({ Items: [] }) }) },
      PutCommand: vi.fn(),
      GetCommand: vi.fn(),
      QueryCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({ send: vi.fn().mockResolvedValue({}) })),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({ send: vi.fn().mockResolvedValue({}) })),
      SendMessageCommand: vi.fn(),
    }));
  };

  const siteAdminClaims = {
    sub: 'user-1',
    'custom:tenant_id': 'tenant-1',
    'custom:role': 'site_admin',
  };

  const workerClaims = {
    sub: 'user-1',
    'custom:tenant_id': 'tenant-1',
    'custom:role': 'worker',
  };

  it('returns 400 for unsupported routes', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/reporting/handler.js');

    const event = {
      httpMethod: 'DELETE',
      resource: '/reports/{id}',
      pathParameters: { id: 'report-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: siteAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response).toBeDefined();
    expect((response as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 401 for unauthenticated requests', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/reporting/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/sites/{id}/daily-summary',
      pathParameters: { id: 'site-1' },
      queryStringParameters: null,
      headers: {},
      body: null,
    };

    const response = await handler(event);
    expect(response).toBeDefined();
    expect((response as { statusCode: number }).statusCode).toBe(401);
  });

  it('returns 403 when worker role tries to read reports', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/reporting/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/sites/{id}/daily-summary',
      pathParameters: { id: 'site-1' },
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: workerClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response).toBeDefined();
    expect((response as { statusCode: number }).statusCode).toBe(403);
  });

  it('returns 400 when site ID is missing for daily-summary', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/reporting/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/sites/{id}/daily-summary',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: siteAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response).toBeDefined();
    expect((response as { statusCode: number }).statusCode).toBe(400);
    const body = JSON.parse((response as { body: string }).body);
    expect(body.message).toContain('Site ID is required');
  });

  it('returns 400 when POST /reports has no body', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/reporting/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/reports',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: siteAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response).toBeDefined();
    expect((response as { statusCode: number }).statusCode).toBe(400);
    const body = JSON.parse((response as { body: string }).body);
    expect(body.message).toContain('Request body is required');
  });

  it('returns 400 when POST /reports has invalid report_type', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/reporting/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/reports',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: siteAdminClaims } },
      body: JSON.stringify({
        site_id: 'site-1',
        report_type: 'invalid_type',
        reporting_period_start: '2024-01-01T00:00:00Z',
        reporting_period_end: '2024-01-02T00:00:00Z',
      }),
    };

    const response = await handler(event);
    expect(response).toBeDefined();
    expect((response as { statusCode: number }).statusCode).toBe(400);
    const body = JSON.parse((response as { body: string }).body);
    expect(body.message).toContain('Validation failed');
  });

  it('returns 400 when POST /reports has end before start', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/reporting/handler.js');

    const event = {
      httpMethod: 'POST',
      resource: '/reports',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: siteAdminClaims } },
      body: JSON.stringify({
        site_id: 'site-1',
        report_type: 'daily_compliance_summary',
        reporting_period_start: '2024-01-02T00:00:00Z',
        reporting_period_end: '2024-01-01T00:00:00Z',
      }),
    };

    const response = await handler(event);
    expect(response).toBeDefined();
    expect((response as { statusCode: number }).statusCode).toBe(400);
    const body = JSON.parse((response as { body: string }).body);
    expect(body.message).toContain('reporting_period_end must be after');
  });

  it('returns 400 when report ID is missing for GET /reports/{id}', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/reporting/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/reports/{id}',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: siteAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response).toBeDefined();
    expect((response as { statusCode: number }).statusCode).toBe(400);
    const body = JSON.parse((response as { body: string }).body);
    expect(body.message).toContain('Report ID is required');
  });

  it('returns 400 when worker ID is missing for compliance-summary', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/reporting/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/workers/{id}/compliance-summary',
      pathParameters: null,
      queryStringParameters: null,
      headers: {},
      requestContext: { authorizer: { claims: siteAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response).toBeDefined();
    expect((response as { statusCode: number }).statusCode).toBe(400);
    const body = JSON.parse((response as { body: string }).body);
    expect(body.message).toContain('Worker ID is required');
  });

  it('returns 400 when export format is invalid', async () => {
    mockAwsSdk();
    const { handler } = await import('../../src/services/reporting/handler.js');

    const event = {
      httpMethod: 'GET',
      resource: '/reports/{id}/export',
      pathParameters: { id: 'report-1' },
      queryStringParameters: { format: 'xml' },
      headers: {},
      requestContext: { authorizer: { claims: siteAdminClaims } },
      body: null,
    };

    const response = await handler(event);
    expect(response).toBeDefined();
    expect((response as { statusCode: number }).statusCode).toBe(400);
    const body = JSON.parse((response as { body: string }).body);
    expect(body.message).toContain('Format must be');
  });
});

// --- Types and Constants Tests ---

describe('reporting: types', () => {
  it('MAX_REPORT_GENERATION_TIME_MS is 60000 (Req 13.1, 13.5)', async () => {
    const { MAX_REPORT_GENERATION_TIME_MS } = await import('../../src/services/reporting/types.js');
    expect(MAX_REPORT_GENERATION_TIME_MS).toBe(60_000);
  });
});

// --- Helper ---

function createMockSummary(noActivity: boolean): DailyComplianceSummary {
  if (noActivity) {
    return {
      summary_id: 'sum-1',
      tenant_id: 'tenant-1',
      site_id: 'site-1',
      reporting_period_start: '2024-01-01T00:00:00Z',
      reporting_period_end: '2024-01-02T00:00:00Z',
      generated_at: '2024-01-02T00:01:00Z',
      access_decisions: { allowed: 0, conditional: 0, denied: 0, total: 0 },
      findings: { generated: 0, confirmed: 0, dismissed: 0, pending_review: 0, total: 0 },
      unresolved_enforcement_actions: { count: 0, actions: [] },
      certification_compliance: [],
      active_policy_versions: [],
      ai_narrative: {
        summary_text: 'No activity was recorded for this site during the reporting period.',
        key_observations: ['No access requests processed', 'No findings generated'],
        regulatory_highlights: [],
        risk_trend: 'stable',
        recommended_focus_areas: [],
      },
      no_activity: true,
    };
  }

  return {
    summary_id: 'sum-2',
    tenant_id: 'tenant-1',
    site_id: 'site-1',
    reporting_period_start: '2024-01-01T00:00:00Z',
    reporting_period_end: '2024-01-02T00:00:00Z',
    generated_at: '2024-01-02T00:01:00Z',
    access_decisions: { allowed: 8, conditional: 2, denied: 1, total: 11 },
    findings: { generated: 3, confirmed: 2, dismissed: 1, pending_review: 1, total: 7 },
    unresolved_enforcement_actions: {
      count: 2,
      actions: [
        {
          enforcement_action_id: 'ea-1',
          action_type: 'deny_entry',
          status: 'pending',
          created_at: '2024-01-01T10:00:00Z',
          worker_id: 'w1',
        },
        {
          enforcement_action_id: 'ea-2',
          action_type: 'notify_supervisor',
          status: 'in_progress',
          created_at: '2024-01-01T14:00:00Z',
          finding_id: 'f1',
        },
      ],
    },
    certification_compliance: [
      {
        worker_id: 'w1',
        worker_name: 'John Doe',
        certification_type: 'whmis_2015',
        status: CertificationStatus.VALIDATED,
        compliance_status: 'compliant',
        expiry_date: '2025-06-01',
      },
      {
        worker_id: 'w2',
        worker_name: 'Jane Smith',
        certification_type: 'fall_protection',
        status: CertificationStatus.EXPIRED,
        compliance_status: 'expired',
        expiry_date: '2023-12-01',
      },
    ],
    active_policy_versions: [
      {
        policy_id: 'pol-1',
        policy_version_id: 'pv-1',
        version_number: 3,
        effective_from: '2023-11-01',
        policy_name: 'Site Safety Policy',
      },
    ],
    ai_narrative: {
      summary_text: 'Site processed 11 access request(s) with 8 approved. 7 safety finding(s) were generated during the period. 2 enforcement action(s) remain unresolved.',
      key_observations: [
        '1 access request(s) denied out of 11 total',
        '2 conditional access grant(s) requiring follow-up',
        '2 safety finding(s) confirmed',
        '1 finding(s) awaiting review',
        '2 unresolved enforcement action(s)',
        '1 expired certification(s) detected',
      ],
      regulatory_highlights: [
        'Confirmed findings require corrective action tracking',
        '1 worker(s) with non-compliant certification status',
      ],
      risk_trend: 'worsening',
      recommended_focus_areas: [
        'Review pending safety findings',
        'Resolve outstanding enforcement actions',
        'Follow up on expired certifications',
      ],
    },
    no_activity: false,
  };
}
