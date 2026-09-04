/**
 * WorkSafeBC async pipeline consumers.
 *
 * Two SQS-triggered handlers sharing the report-validation bundle:
 *  - extractionConsumerHandler: 'extract' → BDA text extraction (reused) →
 *    status texto_extraido | extraccion_fallida → enqueue 'analyze'
 *  - analysisConsumerHandler: 'analyze' → WorkSafeBC validation engine →
 *    build ReporteCumplimiento → status analisis_completado | analisis_fallido
 *
 * Both publish an SNS state-change event on every terminal transition.
 *
 * Requirements: 2.1-2.8, 3.1, 3.9, 4.1-4.9, 6.2, 6.5, 6.6
 */

import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import { extractText } from './text-extractor.js';
import { analyzeCompliance } from './worksafebc-validation-engine.js';
import {
  ANALYSIS_SESSIONS_TABLE,
  MAX_EXECUTIVE_SUMMARY_CHARS,
  type AnalysisSession,
  type SessionStatus,
  type ReporteCumplimiento,
} from './worksafebc-types.js';

const logger = createLogger('worksafebc-consumers');
const sqsClient = new SQSClient({});
const snsClient = new SNSClient({});

const ANALYSIS_QUEUE_URL = (): string => process.env['PDF_COMPLIANCE_QUEUE_URL'] ?? '';
const STATE_TOPIC_ARN = (): string =>
  process.env['PDF_COMPLIANCE_TOPIC_ARN'] ?? process.env['SNS_TOPIC_ARN'] ?? '';

interface SqsRecord {
  body: string;
}
interface SqsEvent {
  Records: SqsRecord[];
}
interface PipelineMessage {
  kind: 'extract' | 'analyze';
  session_id: string;
  tenant_id: string;
}

function pk(tenantId: string): string {
  return `TENANT#${tenantId}`;
}
function sk(sessionId: string): string {
  return `SESSION#${sessionId}`;
}

async function loadSession(tenantId: string, sessionId: string): Promise<AnalysisSession | null> {
  const res = await docClient.send(
    new GetCommand({
      TableName: getTableName(ANALYSIS_SESSIONS_TABLE),
      Key: { PK: pk(tenantId), SK: sk(sessionId) },
    })
  );
  return (res.Item as AnalysisSession | undefined) ?? null;
}

/** Patch session fields and publish an SNS state-change event. */
async function transition(
  session: AnalysisSession,
  status: SessionStatus,
  patch: Partial<AnalysisSession>
): Promise<void> {
  const fields: Record<string, unknown> = { status, ...patch };
  const names: Record<string, string> = { '#s': 'status' };
  const values: Record<string, unknown> = { ':s': status };
  const sets: string[] = ['#s = :s'];
  let i = 0;
  for (const [k, v] of Object.entries(patch)) {
    const nk = `#f${i}`;
    const vk = `:v${i}`;
    names[nk] = k;
    values[vk] = v;
    sets.push(`${nk} = ${vk}`);
    i += 1;
  }
  await docClient.send(
    new UpdateCommand({
      TableName: getTableName(ANALYSIS_SESSIONS_TABLE),
      Key: { PK: pk(session.tenant_id), SK: sk(session.session_id) },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );

  const topicArn = STATE_TOPIC_ARN();
  if (topicArn) {
    try {
      await snsClient.send(
        new PublishCommand({
          TopicArn: topicArn,
          Message: JSON.stringify({
            session_id: session.session_id,
            tenant_id: session.tenant_id,
            site_id: session.site_id,
            status,
            failure_reason: (fields['failure_reason'] as string) ?? null,
          }),
          MessageAttributes: {
            event_type: { DataType: 'String', StringValue: 'worksafebc_session_state_change' },
          },
        })
      );
    } catch (err) {
      logger.warn('SNS publish failed (non-fatal)', { error: String(err) });
    }
  }
}

async function enqueueAnalyze(session: AnalysisSession): Promise<void> {
  const queueUrl = ANALYSIS_QUEUE_URL();
  if (!queueUrl) return;
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ kind: 'analyze', session_id: session.session_id, tenant_id: session.tenant_id }),
    })
  );
}

// ── 7.1 Extraction consumer ──────────────────────────────────────────────────

export async function extractionConsumerHandler(event: SqsEvent): Promise<void> {
  for (const record of event.Records) {
    const msg = JSON.parse(record.body) as PipelineMessage;
    if (msg.kind !== 'extract') continue;

    const session = await loadSession(msg.tenant_id, msg.session_id);
    if (!session) {
      logger.error('extract: session not found', { session_id: msg.session_id });
      continue;
    }

    // >500 pages → immediate fail (Requirement 2.8).
    if (session.document_page_count > 500) {
      await transition(session, 'extraccion_fallida', { failure_reason: 'document exceeds 500 pages' });
      continue;
    }

    try {
      const result = await extractText({
        tenant_id: session.tenant_id,
        report_id: session.session_id,
        version: 1,
        s3_key: session.document_key,
        mime_type: 'application/pdf',
        file_size: session.document_size_bytes,
        page_count: session.document_page_count,
      });

      if ('error_type' in result) {
        const reason =
          result.error_type === 'password_protected'
            ? 'document is password-protected'
            : result.error_type === 'insufficient_text'
              ? 'more than 50% of pages were unprocessable'
              : `extraction failed: ${result.error_type}`;
        await transition(session, 'extraccion_fallida', { failure_reason: reason });
        continue; // do NOT enqueue analyze (Requirement 2.7)
      }

      await transition(session, 'texto_extraido', {
        extraction_metrics: {
          pages_processed: result.page_count,
          pages_ocr_applied: 0,
          avg_confidence: 1,
        },
      });
      await enqueueAnalyze(session);
    } catch (err) {
      logger.error('extraction consumer error', { session_id: session.session_id, error: String(err) });
      await transition(session, 'extraccion_fallida', { failure_reason: 'extraction service error' });
    }
  }
}

// ── 8.6 Analysis consumer ─────────────────────────────────────────────────────

export async function analysisConsumerHandler(event: SqsEvent): Promise<void> {
  for (const record of event.Records) {
    const msg = JSON.parse(record.body) as PipelineMessage;
    if (msg.kind !== 'analyze') continue;

    const session = await loadSession(msg.tenant_id, msg.session_id);
    if (!session) {
      logger.error('analyze: session not found', { session_id: msg.session_id });
      continue;
    }
    if (!session.category) {
      await transition(session, 'analisis_fallido', { failure_reason: 'session has no category' });
      continue;
    }

    await transition(session, 'analizando', {});

    try {
      // NOTE: extracted text re-fetch — v1 re-extracts; a later optimization
      // can persist extracted text. Kept simple + correct for QA.
      const extraction = await extractText({
        tenant_id: session.tenant_id,
        report_id: session.session_id,
        version: 1,
        s3_key: session.document_key,
        mime_type: 'application/pdf',
        file_size: session.document_size_bytes,
        page_count: session.document_page_count,
      });
      if ('error_type' in extraction) {
        await transition(session, 'analisis_fallido', { failure_reason: 'could not reload extracted text' });
        continue;
      }

      const analysis = await analyzeCompliance({
        session_id: session.session_id,
        tenant_id: session.tenant_id,
        extracted_text: extraction.text,
        category: session.category,
        regulatory_version_id: session.regulatory_kb_version_id ?? 'latest',
      });

      const report: ReporteCumplimiento = {
        compliance_level: analysis.compliance_level,
        executive_summary: buildExecutiveSummary(analysis.compliance_level, analysis.findings.length),
        findings: analysis.findings,
        recommendations: analysis.recommendations,
        category: session.category,
        ai_model_version: analysis.ai_model_version,
        regulatory_kb_version_id: session.regulatory_kb_version_id ?? 'latest',
        generated_at: new Date().toISOString(),
      };

      await transition(session, 'analisis_completado', {
        report,
        completed_at: new Date().toISOString(),
        ai_model_version: analysis.ai_model_version,
      });
    } catch (err) {
      logger.error('analysis consumer error', { session_id: session.session_id, error: String(err) });
      await transition(session, 'analisis_fallido', {
        failure_reason: 'analysis failed — verify the document format or contact support',
      });
    }
  }
}

function buildExecutiveSummary(level: string, findingCount: number): string {
  const s = `Compliance level: ${level}. ${findingCount} finding(s) identified against the WorkSafeBC OHS Regulation.`;
  return s.slice(0, MAX_EXECUTIVE_SUMMARY_CHARS);
}
