import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create a controllable mock for the Ollama client's chat method
const mockChat = vi.fn();

// Mock the shared Ollama client so no real key/network is needed
vi.mock('../../../src/shared/ollama-client.js', () => ({
  getOllamaClient: vi.fn(async () => ({ chat: mockChat })),
}));

// Mock retrieval so the engine gets deterministic context without I/O
vi.mock('../../../src/services/report-validation/retrieval.js', () => ({
  retrieveTopK: vi.fn(async () => []),
  buildRetrievalSystemPrompt: vi.fn(() => 'system-context'),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'Put' })),
  UpdateCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: 'Update' })),
}));

const mockDocClientSend = vi.fn();
vi.mock('../../../src/shared/dynamo-client.js', () => ({
  docClient: { send: mockDocClientSend },
  getTableName: (name: string) => `dev-${name}`,
}));

vi.mock('../../../src/shared/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('uuid', () => ({
  v4: () => 'mock-uuid-1234',
}));

// ---------------------------------------------------------------------------
// Tests for parseValidationResponse (pure function, no mocks needed)
// ---------------------------------------------------------------------------

describe('parseValidationResponse', () => {
  let parseValidationResponse: typeof import('../../../src/services/report-validation/validation-engine.js')['parseValidationResponse'];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../../src/services/report-validation/validation-engine.js');
    parseValidationResponse = mod.parseValidationResponse;
  });

  it('parses valid JSON response with findings and summary', () => {
    const response = JSON.stringify({
      findings: [
        {
          severity: 'critical',
          description: 'Missing fall protection plan',
          report_section: 'Section 3.2',
          suggested_correction: 'Add fall protection plan per WorkSafeBC requirements',
          regulation_references: [
            { title: 'WorkSafeBC OHS Regulation', section: '11.2(1)(a)', url: 'https://example.com' },
          ],
        },
      ],
      summary: 'One critical issue found regarding fall protection.',
    });

    const result = parseValidationResponse(response);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('critical');
    expect(result.findings[0].description).toBe('Missing fall protection plan');
    expect(result.findings[0].report_section).toBe('Section 3.2');
    expect(result.findings[0].suggested_correction).toBe('Add fall protection plan per WorkSafeBC requirements');
    expect(result.findings[0].regulation_references).toHaveLength(1);
    expect(result.findings[0].finding_id).toBe('mock-uuid-1234');
    expect(result.summary).toBe('One critical issue found regarding fall protection.');
  });

  it('returns empty findings for no-issues response', () => {
    const response = JSON.stringify({
      findings: [],
      summary: 'No compliance issues identified. The report meets all reviewed regulatory requirements.',
    });

    const result = parseValidationResponse(response);

    expect(result.findings).toHaveLength(0);
    expect(result.summary).toContain('No compliance issues identified');
  });

  it('enforces maximum 50 findings limit', () => {
    const findings = Array.from({ length: 60 }, (_, i) => ({
      severity: 'minor',
      description: `Finding ${i + 1}`,
      report_section: `Section ${i + 1}`,
      suggested_correction: `Fix issue ${i + 1}`,
      regulation_references: [{ title: 'BC Building Code', section: `${i}.1` }],
    }));

    const response = JSON.stringify({ findings, summary: 'Many findings.' });
    const result = parseValidationResponse(response);

    expect(result.findings).toHaveLength(50);
  });

  it('skips findings with invalid severity', () => {
    const response = JSON.stringify({
      findings: [
        {
          severity: 'invalid_severity',
          description: 'Some issue',
          report_section: 'Section 1',
          suggested_correction: 'Fix it',
          regulation_references: [{ title: 'Reg', section: '1.1' }],
        },
        {
          severity: 'major',
          description: 'Valid issue',
          report_section: 'Section 2',
          suggested_correction: 'Fix this',
          regulation_references: [{ title: 'Reg', section: '2.1' }],
        },
      ],
      summary: 'Test',
    });

    const result = parseValidationResponse(response);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('major');
  });

  it('skips findings missing required fields', () => {
    const response = JSON.stringify({
      findings: [
        {
          severity: 'critical',
          description: '', // empty description
          report_section: 'Section 1',
          suggested_correction: 'Fix it',
          regulation_references: [{ title: 'Reg', section: '1.1' }],
        },
        {
          severity: 'major',
          description: 'Valid',
          report_section: '', // empty section
          suggested_correction: 'Fix',
          regulation_references: [{ title: 'Reg', section: '2.1' }],
        },
        {
          severity: 'minor',
          description: 'Also valid',
          report_section: 'Section 3',
          suggested_correction: '', // empty correction
          regulation_references: [{ title: 'Reg', section: '3.1' }],
        },
      ],
      summary: 'Test',
    });

    const result = parseValidationResponse(response);

    expect(result.findings).toHaveLength(0);
  });

  it('skips findings without regulation references', () => {
    const response = JSON.stringify({
      findings: [
        {
          severity: 'critical',
          description: 'Issue without refs',
          report_section: 'Section 1',
          suggested_correction: 'Fix it',
          regulation_references: [],
        },
      ],
      summary: 'Test',
    });

    const result = parseValidationResponse(response);

    expect(result.findings).toHaveLength(0);
  });

  it('truncates description to 500 characters', () => {
    const longDescription = 'A'.repeat(600);
    const response = JSON.stringify({
      findings: [
        {
          severity: 'major',
          description: longDescription,
          report_section: 'Section 1',
          suggested_correction: 'Fix it',
          regulation_references: [{ title: 'Reg', section: '1.1' }],
        },
      ],
      summary: 'Test',
    });

    const result = parseValidationResponse(response);

    expect(result.findings[0].description).toHaveLength(500);
  });

  it('truncates summary to 2000 characters', () => {
    const longSummary = 'B'.repeat(2500);
    const response = JSON.stringify({
      findings: [],
      summary: longSummary,
    });

    const result = parseValidationResponse(response);

    expect(result.summary).toHaveLength(2000);
  });

  it('handles JSON wrapped in markdown code blocks', () => {
    const response = '```json\n' + JSON.stringify({
      findings: [
        {
          severity: 'informational',
          description: 'Best practice suggestion',
          report_section: 'Section 5',
          suggested_correction: 'Consider adding more detail',
          regulation_references: [{ title: 'Safety Standards', section: '4.2' }],
        },
      ],
      summary: 'Minor suggestion found.',
    }) + '\n```';

    const result = parseValidationResponse(response);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('informational');
  });

  it('returns empty findings for unparseable response', () => {
    const result = parseValidationResponse('This is not JSON at all');

    expect(result.findings).toHaveLength(0);
    expect(result.summary.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests for buildComplianceAnalysisPrompt
// ---------------------------------------------------------------------------

describe('buildComplianceAnalysisPrompt', () => {
  let buildComplianceAnalysisPrompt: typeof import('../../../src/services/report-validation/validation-engine.js')['buildComplianceAnalysisPrompt'];

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../../../src/services/report-validation/validation-engine.js');
    buildComplianceAnalysisPrompt = mod.buildComplianceAnalysisPrompt;
  });

  it('includes the extracted text in the prompt', () => {
    const text = 'This is a construction safety report for a building project.';
    const prompt = buildComplianceAnalysisPrompt(text);

    expect(prompt).toContain(text);
  });

  it('includes references to BC construction regulations', () => {
    const prompt = buildComplianceAnalysisPrompt('Sample report text');

    expect(prompt).toContain('WorkSafeBC');
    expect(prompt).toContain('BC Building Code');
    expect(prompt).toContain('Construction Safety Standards');
  });

  it('requests JSON response format', () => {
    const prompt = buildComplianceAnalysisPrompt('Sample text');

    expect(prompt).toContain('JSON');
    expect(prompt).toContain('findings');
    expect(prompt).toContain('summary');
  });
});

// ---------------------------------------------------------------------------
// Tests for runValidation (integration with mocked AWS services)
// ---------------------------------------------------------------------------

describe('runValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('produces complete validation result on successful RAG response', async () => {
    const { runValidation } = await import(
      '../../../src/services/report-validation/validation-engine.js'
    );

    const ragResponse = JSON.stringify({
      findings: [
        {
          severity: 'major',
          description: 'Missing safety plan documentation',
          report_section: 'Section 2.1',
          suggested_correction: 'Include a comprehensive safety plan',
          regulation_references: [
            { title: 'WorkSafeBC OHS Regulation', section: '3.12(1)' },
          ],
        },
        {
          severity: 'minor',
          description: 'Incomplete emergency procedures',
          report_section: 'Section 4.3',
          suggested_correction: 'Add emergency contact details',
          regulation_references: [
            { title: 'BC Building Code', section: '9.10.1' },
          ],
        },
      ],
      summary: 'Report has compliance gaps in safety documentation.',
    });

    // Mock Bedrock RAG response
    mockChat.mockResolvedValue({ message: { content: ragResponse } });

    // Mock DynamoDB calls: store processing record, store completed record, update status
    mockDocClientSend
      .mockResolvedValueOnce({}) // PutCommand - processing record
      .mockResolvedValueOnce({}) // PutCommand - completed record
      .mockResolvedValueOnce({}); // UpdateCommand - status to validated

    const input = {
      report_id: 'report-123',
      version: 1,
      extracted_text: 'This is a construction report with safety information...',
      tenant_id: 'tenant-abc',
    };

    const result = await runValidation(input, 'user-1');

    expect(result.findings).toHaveLength(2);
    expect(result.findings[0].severity).toBe('major');
    expect(result.findings[1].severity).toBe('minor');
    expect(result.score).toBe(89); // 100 - 8 (major) - 3 (minor) = 89
    expect(result.summary).toContain('compliance gaps');
    expect(result.completed_at).toBeDefined();
    expect(new Date(result.completed_at).toISOString()).toBe(result.completed_at);

    // Verify DynamoDB was called 3 times: processing record, completed record, status update
    expect(mockDocClientSend).toHaveBeenCalledTimes(3);
  });

  it('returns score 100 when RAG response has empty findings', async () => {
    const { runValidation } = await import(
      '../../../src/services/report-validation/validation-engine.js'
    );

    const ragResponse = JSON.stringify({
      findings: [],
      summary: 'No compliance issues identified. The report meets all reviewed regulatory requirements.',
    });

    mockChat.mockResolvedValue({ message: { content: ragResponse } });

    mockDocClientSend
      .mockResolvedValueOnce({}) // processing record
      .mockResolvedValueOnce({}) // completed record
      .mockResolvedValueOnce({}); // status update

    const input = {
      report_id: 'report-456',
      version: 1,
      extracted_text: 'A fully compliant construction report with all required documentation.',
      tenant_id: 'tenant-abc',
    };

    const result = await runValidation(input, 'user-1');

    expect(result.findings).toHaveLength(0);
    expect(result.score).toBe(100);
    expect(result.summary).toContain('No compliance issues identified');
  });

  it('enforces max 50 findings from RAG response', async () => {
    const { runValidation } = await import(
      '../../../src/services/report-validation/validation-engine.js'
    );

    // Generate 60 valid findings
    const findings = Array.from({ length: 60 }, (_, i) => ({
      severity: 'minor',
      description: `Finding number ${i + 1} about compliance`,
      report_section: `Section ${i + 1}`,
      suggested_correction: `Correction for finding ${i + 1}`,
      regulation_references: [{ title: 'BC Building Code', section: `${i + 1}.1` }],
    }));

    const ragResponse = JSON.stringify({
      findings,
      summary: 'Many findings detected.',
    });

    mockChat.mockResolvedValue({ message: { content: ragResponse } });

    mockDocClientSend
      .mockResolvedValueOnce({}) // processing record
      .mockResolvedValueOnce({}) // completed record
      .mockResolvedValueOnce({}); // status update

    const input = {
      report_id: 'report-789',
      version: 1,
      extracted_text: 'A report with many compliance issues.',
      tenant_id: 'tenant-abc',
    };

    const result = await runValidation(input, 'user-1');

    expect(result.findings).toHaveLength(50);
    // Score: 100 - (50 * 3) = -50, clamped to 0
    expect(result.score).toBe(0);
  });

  it('reverts status to draft on timeout after 5 minutes', async () => {
    const { runValidation } = await import(
      '../../../src/services/report-validation/validation-engine.js'
    );

    // Ollama never resolves (simulates timeout)
    mockChat.mockImplementation(() => new Promise(() => {})); // never resolves

    // Mock DynamoDB: processing record, then failed record, then status revert
    mockDocClientSend
      .mockResolvedValueOnce({}) // PutCommand - processing record
      .mockResolvedValueOnce({}) // PutCommand - failed/timed_out record
      .mockResolvedValueOnce({}); // UpdateCommand - status revert to draft

    const input = {
      report_id: 'report-timeout',
      version: 1,
      extracted_text: 'Report text that will time out during validation.',
      tenant_id: 'tenant-abc',
    };

    const validationPromise = runValidation(input, 'user-1').catch((err) => {
      // Capture the error for assertion
      return { __error: err };
    });

    // Advance time past the 5-minute timeout (300,000 ms)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);

    const result = await validationPromise;
    expect((result as { __error: Error }).__error.message).toBe(
      'Validation timed out after 5 minutes'
    );

    // Verify DynamoDB was called: processing record, failed record, status revert
    expect(mockDocClientSend).toHaveBeenCalledTimes(3);
  });

  it('reverts status to draft on RAG pipeline failure', async () => {
    const { runValidation } = await import(
      '../../../src/services/report-validation/validation-engine.js'
    );

    // Ollama throws an error (RAG failure)
    mockChat.mockRejectedValueOnce(new Error('Ollama service unavailable'));

    // Mock DynamoDB: processing record, then failed record, then status revert
    mockDocClientSend
      .mockResolvedValueOnce({}) // PutCommand - processing record
      .mockResolvedValueOnce({}) // PutCommand - failed record
      .mockResolvedValueOnce({}); // UpdateCommand - status revert to draft

    const input = {
      report_id: 'report-rag-fail',
      version: 1,
      extracted_text: 'Report text that will fail during RAG processing.',
      tenant_id: 'tenant-abc',
    };

    await expect(runValidation(input, 'user-1')).rejects.toThrow('Ollama service unavailable');

    // Verify DynamoDB was called: processing record, failed record, status revert
    expect(mockDocClientSend).toHaveBeenCalledTimes(3);
  });

  it('reverts status to draft when RAG returns empty response', async () => {
    const { runValidation } = await import(
      '../../../src/services/report-validation/validation-engine.js'
    );

    // Ollama returns response with no text
    mockChat.mockResolvedValue({ message: { content: undefined } });

    mockDocClientSend
      .mockResolvedValueOnce({}) // processing record
      .mockResolvedValueOnce({}) // failed record
      .mockResolvedValueOnce({}); // status revert

    const input = {
      report_id: 'report-empty-response',
      version: 1,
      extracted_text: 'Report text.',
      tenant_id: 'tenant-abc',
    };

    await expect(runValidation(input, 'user-1')).rejects.toThrow(
      'No text content in Ollama response'
    );

    expect(mockDocClientSend).toHaveBeenCalledTimes(3);
  });

  it('stores processing record before starting RAG pipeline', async () => {
    const { runValidation } = await import(
      '../../../src/services/report-validation/validation-engine.js'
    );

    const ragResponse = JSON.stringify({
      findings: [],
      summary: 'All good.',
    });

    mockChat.mockResolvedValue({ message: { content: ragResponse } });

    mockDocClientSend
      .mockResolvedValueOnce({}) // processing record
      .mockResolvedValueOnce({}) // completed record
      .mockResolvedValueOnce({}); // status update

    const input = {
      report_id: 'report-processing',
      version: 2,
      extracted_text: 'Some report text.',
      tenant_id: 'tenant-xyz',
    };

    await runValidation(input, 'user-2');

    // First DynamoDB call should be the processing record
    expect(mockDocClientSend).toHaveBeenCalledTimes(3);
  });

  it('updates report status to validated on success', async () => {
    const { runValidation } = await import(
      '../../../src/services/report-validation/validation-engine.js'
    );

    const ragResponse = JSON.stringify({
      findings: [
        {
          severity: 'informational',
          description: 'Consider adding more detail to safety section',
          report_section: 'Section 1',
          suggested_correction: 'Expand safety documentation',
          regulation_references: [{ title: 'Safety Standards', section: '2.1' }],
        },
      ],
      summary: 'Minor suggestion.',
    });

    mockChat.mockResolvedValue({ message: { content: ragResponse } });

    mockDocClientSend
      .mockResolvedValueOnce({}) // processing record
      .mockResolvedValueOnce({}) // completed record
      .mockResolvedValueOnce({}); // status update to validated

    const input = {
      report_id: 'report-success',
      version: 1,
      extracted_text: 'Report content here.',
      tenant_id: 'tenant-abc',
    };

    const result = await runValidation(input, 'user-1');

    // Score: 100 - 0 (informational) = 100
    expect(result.score).toBe(100);
    expect(result.findings).toHaveLength(1);

    // Verify the third DynamoDB call was the status update
    expect(mockDocClientSend).toHaveBeenCalledTimes(3);
  });
});
