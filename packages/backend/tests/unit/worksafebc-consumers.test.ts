/**
 * WorkSafeBC async consumer tests.
 * Property 3 (extraction outcome totality) + analysis terminal states.
 * Requirements: 2.7, 2.8, 3.9, 8.6-adjacent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
const mockExtractText = vi.fn();
const mockAnalyze = vi.fn();
const mockSqsSend = vi.fn();
const mockSnsSend = vi.fn();

vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: (...a: unknown[]) => mockSend(...a) },
  getTableName: (n: string) => `dev-${n}`,
}));
vi.mock('../../src/services/report-validation/text-extractor.js', () => ({
  extractText: (...a: unknown[]) => mockExtractText(...a),
}));
vi.mock('../../src/services/report-validation/worksafebc-validation-engine.js', () => ({
  analyzeCompliance: (...a: unknown[]) => mockAnalyze(...a),
}));
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: class { send = (...a: unknown[]) => mockSqsSend(...a); },
  SendMessageCommand: class { constructor(public input: unknown) {} },
}));
vi.mock('@aws-sdk/client-sns', () => ({
  SNSClient: class { send = (...a: unknown[]) => mockSnsSend(...a); },
  PublishCommand: class { constructor(public input: unknown) {} },
}));

import {
  extractionConsumerHandler,
  analysisConsumerHandler,
} from '../../src/services/report-validation/worksafebc-consumers.js';

const baseSession = {
  session_id: 's1',
  tenant_id: 't1',
  site_id: 'site1',
  document_group_id: 'g1',
  document_key: 'k',
  document_name: 'd.pdf',
  document_size_bytes: 1000,
  document_page_count: 10,
  category: 'plan_seguridad',
  status: 'categorizado',
};

/** Capture the status written by the UpdateCommand in a transition(). */
function lastWrittenStatus(): string | undefined {
  const calls = mockSend.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const input = (calls[i][0] as { input?: Record<string, unknown> }).input;
    const vals = input?.['ExpressionAttributeValues'] as Record<string, unknown> | undefined;
    if (vals && ':s' in vals) return vals[':s'] as string;
  }
  return undefined;
}

const evt = (kind: string) => ({
  Records: [{ body: JSON.stringify({ kind, session_id: 's1', tenant_id: 't1' }) }],
});

beforeEach(() => {
  mockSend.mockReset();
  mockExtractText.mockReset();
  mockAnalyze.mockReset();
  mockSqsSend.mockReset();
  mockSnsSend.mockReset();
  process.env['PDF_COMPLIANCE_QUEUE_URL'] = 'https://sqs/q';
  process.env['PDF_COMPLIANCE_TOPIC_ARN'] = 'arn:aws:sns:us-west-2:1:topic';
});

describe('extractionConsumerHandler (Property 3: outcome totality)', () => {
  it('>500 pages → extraccion_fallida, no analyze enqueued', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...baseSession, document_page_count: 501 } }); // load
    mockSend.mockResolvedValue({}); // update
    await extractionConsumerHandler(evt('extract'));
    expect(lastWrittenStatus()).toBe('extraccion_fallida');
    expect(mockSqsSend).not.toHaveBeenCalled();
  });

  it('password-protected → extraccion_fallida', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...baseSession } });
    mockSend.mockResolvedValue({});
    mockExtractText.mockResolvedValueOnce({ error_type: 'password_protected', message: 'x' });
    await extractionConsumerHandler(evt('extract'));
    expect(lastWrittenStatus()).toBe('extraccion_fallida');
    expect(mockSqsSend).not.toHaveBeenCalled();
  });

  it('success → texto_extraido and enqueues analyze', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...baseSession } });
    mockSend.mockResolvedValue({});
    mockExtractText.mockResolvedValueOnce({ text: 'hello', page_count: 5, extraction_method: 'bda', character_count: 5 });
    await extractionConsumerHandler(evt('extract'));
    expect(lastWrittenStatus()).toBe('texto_extraido');
    expect(mockSqsSend).toHaveBeenCalledTimes(1);
  });
});

describe('analysisConsumerHandler', () => {
  it('success → analisis_completado with report', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...baseSession } }); // load
    mockSend.mockResolvedValue({}); // analizando + completado updates
    mockExtractText.mockResolvedValueOnce({ text: 'body', page_count: 3, extraction_method: 'bda', character_count: 4 });
    mockAnalyze.mockResolvedValueOnce({
      findings: [],
      compliance_level: 'conforme',
      recommendations: [],
      ai_model_version: 'gpt-oss:120b-cloud',
    });
    await analysisConsumerHandler(evt('analyze'));
    expect(lastWrittenStatus()).toBe('analisis_completado');
  });

  it('analysis throws → analisis_fallido', async () => {
    mockSend.mockResolvedValueOnce({ Item: { ...baseSession } });
    mockSend.mockResolvedValue({});
    mockExtractText.mockResolvedValueOnce({ text: 'body', page_count: 3, extraction_method: 'bda', character_count: 4 });
    mockAnalyze.mockRejectedValueOnce(new Error('model down'));
    await analysisConsumerHandler(evt('analyze'));
    expect(lastWrittenStatus()).toBe('analisis_fallido');
  });
});
