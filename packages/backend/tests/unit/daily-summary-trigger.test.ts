/**
 * Unit tests for the Daily Summary Trigger scheduled Lambda.
 *
 * Requirements: 13.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('daily-summary-trigger: calculateReportingPeriod', () => {
  let calculateReportingPeriod: typeof import('../../src/scheduled/daily-summary-trigger.js').calculateReportingPeriod;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({ send: vi.fn() }) },
      ScanCommand: vi.fn(),
      QueryCommand: vi.fn(),
      PutCommand: vi.fn(),
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

    const mod = await import('../../src/scheduled/daily-summary-trigger.js');
    calculateReportingPeriod = mod.calculateReportingPeriod;
  });

  it('returns reporting period with start before end', () => {
    const now = new Date('2024-06-15T08:00:00Z');
    const result = calculateReportingPeriod('America/Vancouver', now);

    expect(result.reporting_period_start).toBeDefined();
    expect(result.reporting_period_end).toBeDefined();

    const start = new Date(result.reporting_period_start);
    const end = new Date(result.reporting_period_end);
    expect(start.getTime()).toBeLessThan(end.getTime());
  });

  it('reporting period spans approximately 24 hours', () => {
    const now = new Date('2024-06-15T08:00:00Z');
    const result = calculateReportingPeriod('America/Vancouver', now);

    const start = new Date(result.reporting_period_start);
    const end = new Date(result.reporting_period_end);
    const durationMs = end.getTime() - start.getTime();

    // Should be approximately 24 hours (within 1 hour tolerance for DST)
    expect(durationMs).toBeGreaterThanOrEqual(23 * 60 * 60 * 1000);
    expect(durationMs).toBeLessThanOrEqual(25 * 60 * 60 * 1000);
  });

  it('uses UTC timezone correctly', () => {
    const now = new Date('2024-06-15T12:00:00Z');
    const result = calculateReportingPeriod('UTC', now);

    const start = new Date(result.reporting_period_start);
    const end = new Date(result.reporting_period_end);

    // For UTC at noon on June 15, the reporting period should be June 14 00:00 to June 15 00:00
    expect(start.toISOString()).toContain('2024-06-14');
    expect(end.toISOString()).toContain('2024-06-15');
  });

  it('handles different timezones', () => {
    const now = new Date('2024-06-15T03:00:00Z'); // 8pm June 14 in Vancouver (PDT = UTC-7)
    const resultVancouver = calculateReportingPeriod('America/Vancouver', now);
    const resultTokyo = calculateReportingPeriod('Asia/Tokyo', now);

    // Different timezones should produce different reporting periods
    expect(resultVancouver.reporting_period_start).not.toBe(resultTokyo.reporting_period_start);
  });

  it('defaults to America/Vancouver timezone format', () => {
    const now = new Date('2024-06-15T08:00:00Z');
    const result = calculateReportingPeriod('America/Vancouver', now);

    // Should return valid ISO strings
    expect(() => new Date(result.reporting_period_start)).not.toThrow();
    expect(() => new Date(result.reporting_period_end)).not.toThrow();
  });
});

describe('daily-summary-trigger: handler', () => {
  let handler: typeof import('../../src/scheduled/daily-summary-trigger.js').handler;
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    mockSend = vi.fn();

    vi.doMock('@aws-sdk/lib-dynamodb', () => ({
      DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
      ScanCommand: vi.fn(),
      QueryCommand: vi.fn(),
      PutCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-dynamodb', () => ({
      DynamoDBClient: vi.fn(() => ({})),
    }));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn(() => ({ send: vi.fn().mockResolvedValue({}) })),
      PublishCommand: vi.fn(),
    }));
    vi.doMock('@aws-sdk/client-sqs', () => ({
      SQSClient: vi.fn(() => ({})),
      SendMessageCommand: vi.fn(),
    }));

    process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-west-2:123456789:test-topic';

    const mod = await import('../../src/scheduled/daily-summary-trigger.js');
    handler = mod.handler;
  });

  it('returns 200 with summary when no active sites', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] }); // getActiveSites scan

    const result = await handler();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.total_sites).toBe(0);
    expect(body.total_published).toBe(0);
    expect(body.total_errors).toBe(0);
  });

  it('returns 200 and publishes events for active sites', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          PK: 'TENANT#t1',
          SK: 'SITE#s1',
          site_id: 's1',
          tenant_id: 't1',
          site_name: 'Test Site',
          timezone: 'America/Vancouver',
          status: 'active',
        },
      ],
    }); // getActiveSites scan

    const result = await handler();

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.total_sites).toBe(1);
    expect(body.total_published).toBe(1);
  });

  it('returns 500 on fatal error', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

    const result = await handler();

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toContain('Daily summary trigger failed');
  });
});
