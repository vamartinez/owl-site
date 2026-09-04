/**
 * Validation Engine Module.
 * Orchestrates the RAG pipeline for AI-powered compliance validation:
 * - Receives extracted text from the text extractor
 * - Retrieves top-k relevant regulatory clauses (retrieveTopK)
 * - Generates the analysis with Ollama Cloud (gpt-oss:120b-cloud)
 * - Parses the response into structured ComplianceFinding[]
 * - Computes deterministic compliance score via score-calculator
 * - Stores ValidationResultRecord in DynamoDB
 * - Updates report status to "validated" on success
 * - Reverts status to "draft" on failure/timeout
 *
 * Provider migration (ai-provider-migration, Ollama variant): Bedrock's
 * RetrieveAndGenerate bundled retrieval + generation in one call. Ollama's
 * chat API generates only, so retrieval is a separate step (retrieveTopK)
 * whose clauses are injected into the system prompt. The parser, score
 * calculator, and output contract are UNCHANGED.
 *
 * Requirements: 3.2, 3.4, 3.5, 3.6, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getOllamaClient } from '../../shared/ollama-client.js';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import { calculateComplianceScore } from './score-calculator.js';
import { retrieveTopK, buildRetrievalSystemPrompt } from './retrieval.js';
import type {
  ComplianceFinding,
  FindingSeverity,
  RegulationReference,
  ValidationResultRecord,
} from './types.js';
import {
  MAX_FINDINGS,
  MAX_SUMMARY_LENGTH,
  MAX_FINDING_DESCRIPTION_LENGTH,
  MAX_SUGGESTED_CORRECTION_LENGTH,
  VALIDATION_TIMEOUT_MS,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPORTS_TABLE = 'reports';
const VALIDATION_RESULTS_TABLE = 'validation-results';

/** Ollama Cloud model for compliance generation (was Bedrock haiku RAG). */
export const VALIDATION_OLLAMA_MODEL_CONFIG = {
  modelId: 'gpt-oss:120b-cloud',
  maxTokens: 4096,
  temperature: 0.1,
} as const;

/** Number of regulatory clauses to retrieve and inject as context. */
const TOP_K = 8;

const logger = createLogger('report-validation-engine');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input for the validation engine pipeline.
 */
export interface ValidationEngineInput {
  report_id: string;
  version: number;
  extracted_text: string;
  tenant_id: string;
}

/**
 * Output from a successful validation.
 */
export interface ValidationEngineOutput {
  findings: ComplianceFinding[];
  summary: string;
  score: number;
  completed_at: string;
}

// ---------------------------------------------------------------------------
// Prompt Construction
// ---------------------------------------------------------------------------

/**
 * Constructs the compliance analysis prompt for the RAG pipeline.
 * Includes the extracted report text and instructions for structured analysis.
 *
 * Requirement 3.4: query Knowledge Base with extracted report content to identify
 * compliance gaps against WorkSafeBC OHS Regulation, BC Building Code, and
 * Construction Safety Standards.
 */
export function buildComplianceAnalysisPrompt(extractedText: string): string {
  return `You are a construction compliance analyst specializing in British Columbia construction regulations. Analyze the following construction report for compliance with:
- WorkSafeBC Occupational Health and Safety (OHS) Regulation
- BC Building Code
- Construction Safety Standards applicable in British Columbia

For each compliance issue found, provide a structured finding with:
1. severity: one of "critical" (regulatory violation), "major" (significant compliance gap), "minor" (improvement recommendation), or "informational" (best practice suggestion)
2. description: a clear description of the issue (max 500 characters)
3. report_section: the section heading or page reference where the issue was found
4. suggested_correction: actionable recommendation to resolve the issue (max 500 characters)
5. regulation_references: array of objects with "title" (regulation name), "section" (specific clause), and optionally "url" (link to regulation text)

Also provide a brief overall summary of the compliance assessment (max 2000 characters).

Respond ONLY with valid JSON in this exact format:
{
  "findings": [
    {
      "severity": "critical|major|minor|informational",
      "description": "...",
      "report_section": "...",
      "suggested_correction": "...",
      "regulation_references": [{"title": "...", "section": "...", "url": "..."}]
    }
  ],
  "summary": "..."
}

If no compliance issues are found, return: {"findings": [], "summary": "No compliance issues identified. The report meets all reviewed regulatory requirements."}

Report content to analyze:
---
${extractedText}
---`;
}

// ---------------------------------------------------------------------------
// RAG Pipeline Invocation
// ---------------------------------------------------------------------------

/**
 * Generates the compliance analysis with Ollama Cloud, injecting the retrieved
 * regulatory clauses as system context. Replaces Bedrock RetrieveAndGenerate:
 * retrieval is now an explicit prior step (retrieveTopK) rather than bundled.
 *
 * Requirement 3.4: analyse extracted report content against WorkSafeBC OHS
 * Regulation, BC Building Code, and Construction Safety Standards.
 */
async function generateComplianceAnalysis(prompt: string): Promise<string> {
  // Retrieve the most relevant regulatory clauses for this report.
  const clauses = await retrieveTopK(prompt, { k: TOP_K });

  const client = await getOllamaClient();
  const response = await client.chat({
    model: VALIDATION_OLLAMA_MODEL_CONFIG.modelId,
    messages: [
      { role: 'system', content: buildRetrievalSystemPrompt(clauses) },
      { role: 'user', content: prompt },
    ],
    stream: false,
    options: {
      temperature: VALIDATION_OLLAMA_MODEL_CONFIG.temperature,
      num_predict: VALIDATION_OLLAMA_MODEL_CONFIG.maxTokens,
    },
  });

  const text = response.message?.content;
  if (!text) {
    throw new Error('No text content in Ollama response');
  }

  return text;
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

/**
 * Validates that a severity value is one of the allowed values.
 */
function isValidSeverity(value: string): value is FindingSeverity {
  return ['critical', 'major', 'minor', 'informational'].includes(value);
}

/**
 * Truncates a string to the specified maximum length.
 */
function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

/**
 * Parses a regulation reference from raw JSON data.
 */
function parseRegulationReference(raw: unknown): RegulationReference | null {
  if (!raw || typeof raw !== 'object') return null;
  const ref = raw as Record<string, unknown>;

  const title = typeof ref['title'] === 'string' ? ref['title'] : '';
  const section = typeof ref['section'] === 'string' ? ref['section'] : '';

  if (!title || !section) return null;

  const result: RegulationReference = { title, section };
  if (typeof ref['url'] === 'string' && ref['url'].length > 0) {
    result.url = ref['url'];
  }

  return result;
}

/**
 * Parses the LLM response into structured ComplianceFinding array.
 * Enforces max 50 findings limit and validates each finding's structure.
 *
 * Requirements: 4.1, 4.2, 4.3 (structured findings with severity, description,
 * section, correction, and regulation references)
 */
export function parseValidationResponse(responseText: string): {
  findings: ComplianceFinding[];
  summary: string;
} {
  // Try to extract JSON from the response (handle markdown code blocks)
  let jsonText = responseText.trim();

  // Strip markdown code fences if present
  const jsonBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    jsonText = jsonBlockMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // If JSON parsing fails, try to find JSON object in the text
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        logger.warn('Failed to parse validation response as JSON', {
          response_length: responseText.length,
        });
        return {
          findings: [],
          summary: truncate(responseText, MAX_SUMMARY_LENGTH),
        };
      }
    } else {
      return {
        findings: [],
        summary: truncate(responseText, MAX_SUMMARY_LENGTH),
      };
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { findings: [], summary: '' };
  }

  const data = parsed as Record<string, unknown>;

  // Parse summary
  const summary = typeof data['summary'] === 'string'
    ? truncate(data['summary'], MAX_SUMMARY_LENGTH)
    : '';

  // Parse findings
  const rawFindings = Array.isArray(data['findings']) ? data['findings'] : [];
  const findings: ComplianceFinding[] = [];

  // Enforce max 50 findings (Requirement 4.1)
  const limitedFindings = rawFindings.slice(0, MAX_FINDINGS);

  for (const raw of limitedFindings) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;

    // Validate severity (Requirement 4.2)
    const severity = typeof item['severity'] === 'string' ? item['severity'] : '';
    if (!isValidSeverity(severity)) continue;

    // Validate required fields (Requirement 4.3)
    const description = typeof item['description'] === 'string' ? item['description'] : '';
    const reportSection = typeof item['report_section'] === 'string' ? item['report_section'] : '';
    const suggestedCorrection = typeof item['suggested_correction'] === 'string'
      ? item['suggested_correction']
      : '';

    if (!description || !reportSection || !suggestedCorrection) continue;

    // Parse regulation references
    const rawRefs = Array.isArray(item['regulation_references'])
      ? item['regulation_references']
      : [];
    const regulationReferences: RegulationReference[] = rawRefs
      .map(parseRegulationReference)
      .filter((ref): ref is RegulationReference => ref !== null);

    // Requirement 4.3: each finding must have at least one regulation reference
    if (regulationReferences.length === 0) continue;

    findings.push({
      finding_id: uuidv4(),
      severity,
      description: truncate(description, MAX_FINDING_DESCRIPTION_LENGTH),
      report_section: reportSection,
      suggested_correction: truncate(suggestedCorrection, MAX_SUGGESTED_CORRECTION_LENGTH),
      regulation_references: regulationReferences,
    });
  }

  return { findings, summary };
}

// ---------------------------------------------------------------------------
// DynamoDB Operations
// ---------------------------------------------------------------------------

/**
 * Stores the validation result record in DynamoDB.
 *
 * Requirement 4.4: associate Validation_Result with the report record.
 */
async function storeValidationResult(record: ValidationResultRecord): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: getTableName(VALIDATION_RESULTS_TABLE),
      Item: record,
    })
  );
}

/**
 * Updates the report status in DynamoDB.
 * Records the status transition in the status_history array.
 *
 * Requirement 4.4: change Report_Status to "validated" on success.
 * Requirement 3.5, 3.6, 3.8: revert to "draft" on failure/timeout.
 */
async function updateReportStatus(
  tenantId: string,
  reportId: string,
  fromStatus: string,
  toStatus: string,
  triggeredBy: string
): Promise<void> {
  const now = new Date().toISOString();

  await docClient.send(
    new UpdateCommand({
      TableName: getTableName(REPORTS_TABLE),
      Key: {
        tenant_id: tenantId,
        report_id: reportId,
      },
      UpdateExpression:
        'SET #status = :newStatus, updated_at = :now, status_history = list_append(if_not_exists(status_history, :emptyList), :transition)',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':newStatus': toStatus,
        ':now': now,
        ':emptyList': [],
        ':transition': [
          {
            from_status: fromStatus,
            to_status: toStatus,
            triggered_by: triggeredBy,
            timestamp: now,
          },
        ],
      },
    })
  );
}

// ---------------------------------------------------------------------------
// Timeout Handling
// ---------------------------------------------------------------------------

/**
 * Creates a timeout promise that rejects after VALIDATION_TIMEOUT_MS (5 minutes).
 *
 * Requirement 3.8: if validation has not completed within 5 minutes,
 * mark as timed out and revert status to "draft".
 */
function createTimeoutPromise(): { promise: Promise<never>; clear: () => void } {
  let timeoutId: ReturnType<typeof setTimeout>;

  const promise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ValidationTimeoutError());
    }, VALIDATION_TIMEOUT_MS);
  });

  const clear = () => clearTimeout(timeoutId);

  return { promise, clear };
}

/**
 * Custom error class for validation timeout.
 */
class ValidationTimeoutError extends Error {
  constructor() {
    super('Validation timed out after 5 minutes');
    this.name = 'ValidationTimeoutError';
  }
}

// ---------------------------------------------------------------------------
// Main Validation Pipeline
// ---------------------------------------------------------------------------

/**
 * Executes the full validation pipeline:
 * 1. Construct compliance analysis prompt with extracted text
 * 2. Query Knowledge Base via RetrieveAndGenerate
 * 3. Parse Claude 3.5 Haiku response into structured findings
 * 4. Calculate deterministic compliance score
 * 5. Store ValidationResultRecord in DynamoDB
 * 6. Update report status to "validated"
 *
 * On failure or timeout:
 * - Reverts report status to "draft"
 * - Records error in validation result
 *
 * Requirements: 3.2, 3.4, 3.5, 3.6, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 *
 * @param input - Validation engine input with report_id, version, extracted_text, tenant_id
 * @param requestedBy - User ID who requested the validation
 * @returns Validation output on success, or throws on unrecoverable error
 */
export async function runValidation(
  input: ValidationEngineInput,
  requestedBy: string
): Promise<ValidationEngineOutput> {
  const { report_id, version, extracted_text, tenant_id } = input;
  const validationId = uuidv4();
  const requestedAt = new Date().toISOString();

  logger.info('Starting validation pipeline', {
    report_id,
    version,
    validation_id: validationId,
    text_length: extracted_text.length,
  });

  // Create initial processing record
  const processingRecord: ValidationResultRecord = {
    report_id,
    version,
    validation_id: validationId,
    status: 'processing',
    findings: [],
    requested_at: requestedAt,
    requested_by: requestedBy,
  };

  await storeValidationResult(processingRecord);

  // Set up timeout (Requirement 3.8)
  const timeout = createTimeoutPromise();

  try {
    // Run the RAG pipeline with timeout
    const result = await Promise.race([
      executeRagPipeline(extracted_text),
      timeout.promise,
    ]);

    timeout.clear();

    // Calculate deterministic compliance score (Requirement 4.5, 4.6)
    const score = calculateComplianceScore(result.findings);
    const completedAt = new Date().toISOString();

    // Generate summary (Requirement 4.1: max 2000 characters)
    const summary = result.summary || generateDefaultSummary(result.findings, score);

    // Store completed validation result in DynamoDB
    const completedRecord: ValidationResultRecord = {
      report_id,
      version,
      validation_id: validationId,
      status: 'completed',
      score,
      summary: truncate(summary, MAX_SUMMARY_LENGTH),
      findings: result.findings,
      requested_at: requestedAt,
      completed_at: completedAt,
      requested_by: requestedBy,
    };

    await storeValidationResult(completedRecord);

    // Update report status to "validated" (Requirement 4.4)
    await updateReportStatus(tenant_id, report_id, 'validating', 'validated', 'system');

    logger.info('Validation completed successfully', {
      report_id,
      version,
      validation_id: validationId,
      score,
      findings_count: result.findings.length,
    });

    return {
      findings: result.findings,
      summary: truncate(summary, MAX_SUMMARY_LENGTH),
      score,
      completed_at: completedAt,
    };
  } catch (error) {
    timeout.clear();

    const isTimeout = error instanceof ValidationTimeoutError;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const failureStatus = isTimeout ? 'timed_out' : 'failed';

    logger.error('Validation pipeline failed', {
      report_id,
      version,
      validation_id: validationId,
      is_timeout: isTimeout,
      error: errorMessage,
    });

    // Store failed validation result with error (Requirement 3.6, 3.8)
    const failedRecord: ValidationResultRecord = {
      report_id,
      version,
      validation_id: validationId,
      status: failureStatus,
      findings: [],
      requested_at: requestedAt,
      completed_at: new Date().toISOString(),
      requested_by: requestedBy,
      error_message: errorMessage,
    };

    await storeValidationResult(failedRecord);

    // Revert report status to "draft" (Requirement 3.5, 3.6, 3.8)
    await updateReportStatus(tenant_id, report_id, 'validating', 'draft', 'system');

    throw error;
  }
}

/**
 * Executes the RAG pipeline: prompt construction → Knowledge Base query → response parsing.
 */
async function executeRagPipeline(
  extractedText: string
): Promise<{ findings: ComplianceFinding[]; summary: string }> {
  // Step 1: Construct compliance analysis prompt
  const prompt = buildComplianceAnalysisPrompt(extractedText);

  // Step 2: Retrieve regulatory context + generate the analysis (Requirement 3.4)
  const responseText = await generateComplianceAnalysis(prompt);

  // Step 3: Parse response into structured findings (Requirements 4.1, 4.2, 4.3)
  const { findings, summary } = parseValidationResponse(responseText);

  return { findings, summary };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates a default summary when the LLM doesn't provide one.
 *
 * Requirement 4.6: if zero findings, indicate no compliance issues identified.
 */
function generateDefaultSummary(findings: ComplianceFinding[], score: number): string {
  if (findings.length === 0) {
    return 'No compliance issues identified. The report meets all reviewed regulatory requirements for British Columbia construction laws.';
  }

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const majorCount = findings.filter((f) => f.severity === 'major').length;
  const minorCount = findings.filter((f) => f.severity === 'minor').length;
  const infoCount = findings.filter((f) => f.severity === 'informational').length;

  const parts: string[] = [
    `Compliance analysis identified ${findings.length} finding(s) with an overall score of ${score}/100.`,
  ];

  if (criticalCount > 0) parts.push(`${criticalCount} critical issue(s) require immediate attention.`);
  if (majorCount > 0) parts.push(`${majorCount} major issue(s) should be addressed before submission.`);
  if (minorCount > 0) parts.push(`${minorCount} minor improvement(s) recommended.`);
  if (infoCount > 0) parts.push(`${infoCount} informational suggestion(s) for best practices.`);

  return parts.join(' ');
}
