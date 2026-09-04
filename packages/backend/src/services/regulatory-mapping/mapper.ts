/**
 * Regulatory Mapping Layer — Core mapping logic.
 * Maps scene understanding + detections to WorkSafeBC regulations and site policies.
 * Produces violation flags, regulatory basis, severity, and corrective actions.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */

import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { getOllamaClient } from '../../shared/ollama-client.js';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import { Severity, FindingStatus } from '../../shared/types/common.js';
import type {
  RegulatoryMappingInput,
  RegulatoryMappingOutput,
  RegulatoryMappingResult,
  BedrockRegulatoryResponse,
  FindingRecord,
} from './types.js';
import {
  REGULATORY_OLLAMA_MODEL_CONFIG,
  MAX_CORRECTIVE_ACTION_LENGTH,
  VIOLATION_CONFIDENCE_THRESHOLD,
  WORKSAFE_BC_JURISDICTION_ID,
  VALID_SEVERITY_LEVELS,
  RegulatoryMappingStatus,
} from './types.js';
import { getJurisdiction, resolveJurisdictionId } from './jurisdiction-registry.js';

const logger = createLogger('regulatory-mapping');

/**
 * Detection result structure from the DetectionResults table.
 */
interface StoredDetection {
  type: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface DetectionRecord {
  detection_id: string;
  inspection_id: string;
  media_asset_id: string;
  tenant_id: string;
  site_id: string;
  model_version: string;
  detections: StoredDetection[];
  detection_count: number;
}

/**
 * Scene interpretation record from the SceneInterpretations table.
 */
interface SceneInterpretationRecord {
  interpretation_id: string;
  inspection_id: string;
  tenant_id: string;
  site_id: string;
  scene_type: string;
  scene_description: string;
  activity_label: string;
  risk_context: {
    primary_hazard: string;
    exposed_personnel_count: number;
  } | null;
  confidence: number;
}

/**
 * Active policy version record.
 */
interface PolicyVersionRecord {
  policy_version_id: string;
  policy_id: string;
  tenant_id: string;
  site_id: string;
  version_number: number;
  effective_from: string;
  effective_to?: string;
  status: string;
}

/**
 * Error thrown when policy version or jurisdiction is unavailable.
 * Requirement 8.7: Reject with error when unavailable.
 */
export class RegulatoryMappingError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'RegulatoryMappingError';
    this.code = code;
  }
}

/**
 * Builds the regulatory mapping system prompt with jurisdiction context.
 * Resolves the ruleset via the jurisdiction registry so the pipeline is no
 * longer hard-wired to WorkSafeBC; an unknown/empty id falls back to the
 * default jurisdiction (currently WorkSafeBC), preserving prior behavior.
 * Requirement 8.5: WorkSafeBC as initial jurisdiction.
 */
export function buildRegulatoryMappingPrompt(
  sceneType: string,
  jurisdictionId?: string | null
): string {
  const jurisdiction = getJurisdiction(jurisdictionId);
  const regulatoryContext = jurisdiction.buildRegulatoryContext(sceneType);

  return `You are a construction safety regulatory compliance analyst specializing in ${jurisdiction.display_name}. Given detection results from a construction site image and the classified scene context, map each detection to applicable regulatory rules.

${regulatoryContext}

For each detection, determine:
1. Whether it represents a potential violation (violation_flag: true/false)
2. The specific regulatory clause reference (regulatory_basis) — use the exact clause format like "OHS Regulation 11.2"
3. The site policy basis if applicable (site_policy_basis) — null if only regulatory
4. Severity level based on potential for human harm:
   - "critical": imminent risk of fatality or permanent injury
   - "high": risk of serious injury or repeated exposure
   - "medium": risk of minor injury or regulatory non-compliance without immediate harm
   - "low": procedural deviation with no direct injury risk
5. A suggested corrective action (maximum 500 characters)

Rules for violation determination:
- A missing safety item (e.g., no helmet detected where required) IS a violation
- A present safety item properly used (e.g., helmet worn) is NOT a violation
- Proximity to hazards without protection IS a violation
- Blocked exits or poor housekeeping IS a violation
- If a detection cannot be matched to any regulation, set violation_flag to false and regulatory_basis to null

Respond ONLY with valid JSON in this exact format:
{
  "mappings": [
    {
      "detection_type": "helmet",
      "violation_flag": false,
      "regulatory_basis": null,
      "site_policy_basis": null,
      "severity": null,
      "suggested_corrective_action": null
    },
    {
      "detection_type": "roof_edge",
      "violation_flag": true,
      "regulatory_basis": "OHS Regulation 11.7",
      "site_policy_basis": null,
      "severity": "critical",
      "suggested_corrective_action": "Install temporary guardrails at roof edge. Stop work until edge protection is in place."
    }
  ]
}

Important:
- Include ALL detections in the response, even those with no violation
- suggested_corrective_action must not exceed 500 characters
- severity must be one of: critical, high, medium, low, or null (when no violation)
- regulatory_basis must reference specific WorkSafeBC OHS Regulation clauses
- Be conservative: flag violations only when there is clear evidence of non-compliance`;
}

/**
 * Builds the user message with scene context and detections for regulatory mapping.
 */
export function buildRegulatoryUserMessage(
  sceneType: string,
  sceneDescription: string,
  riskContext: { primary_hazard: string; exposed_personnel_count: number } | null,
  detections: StoredDetection[]
): string {
  const detectionSummary = detections
    .map(
      (d, i) =>
        `${i + 1}. ${d.type} (confidence: ${d.confidence.toFixed(2)})`
    )
    .join('\n');

  let message = `Scene Classification: ${sceneType}\nScene Description: ${sceneDescription}\n`;

  if (riskContext) {
    message += `Primary Hazard: ${riskContext.primary_hazard}\nExposed Personnel: ${riskContext.exposed_personnel_count}\n`;
  }

  message += `\nDetections found:\n${detectionSummary}\n\nMap each detection to applicable WorkSafeBC regulations and determine if violations exist.`;

  return message;
}

/**
 * Parses the Bedrock model response into a structured regulatory response.
 * Handles JSON extraction from potential markdown code blocks.
 */
export function parseBedrockRegulatoryResponse(responseBody: string): BedrockRegulatoryResponse {
  let jsonStr = responseBody.trim();

  // Handle markdown code block wrapping
  if (jsonStr.startsWith('```')) {
    const lines = jsonStr.split('\n');
    const startIdx = 1;
    const endIdx =
      lines[lines.length - 1]?.trim() === '```' ? lines.length - 1 : lines.length;
    jsonStr = lines.slice(startIdx, endIdx).join('\n').trim();
  }

  const parsed = JSON.parse(jsonStr);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid response format: not an object');
  }

  if (!Array.isArray(parsed.mappings)) {
    throw new Error('Invalid response format: missing or invalid mappings array');
  }

  return parsed as BedrockRegulatoryResponse;
}

/**
 * Validates and normalizes a single mapping result from the model response.
 * Requirement 8.3: Produce violation_flag, regulatory_basis, site_policy_basis, severity, suggested_corrective_action.
 * Requirement 8.4: Severity classification.
 * Requirement 8.6: No match → no violation flag.
 */
export function normalizeMappingResult(
  rawMapping: BedrockRegulatoryResponse['mappings'][0],
  detectionConfidence: number
): RegulatoryMappingResult {
  const violationFlag = Boolean(rawMapping.violation_flag);

  // Requirement 8.6: No match → no violation flag
  if (!violationFlag) {
    return {
      detection_type: String(rawMapping.detection_type ?? ''),
      detection_confidence: detectionConfidence,
      violation_flag: false,
      regulatory_basis: null,
      site_policy_basis: null,
      severity: null,
      suggested_corrective_action: null,
    };
  }

  // Validate severity (Requirement 8.4)
  const rawSeverity = rawMapping.severity?.toLowerCase() ?? null;
  const severity: Severity | null =
    rawSeverity && VALID_SEVERITY_LEVELS.includes(rawSeverity)
      ? (rawSeverity as Severity)
      : null;

  // Truncate corrective action to max 500 chars (Requirement 8.3)
  const correctiveAction = rawMapping.suggested_corrective_action
    ? String(rawMapping.suggested_corrective_action).slice(0, MAX_CORRECTIVE_ACTION_LENGTH)
    : null;

  return {
    detection_type: String(rawMapping.detection_type ?? ''),
    detection_confidence: detectionConfidence,
    violation_flag: true,
    regulatory_basis: rawMapping.regulatory_basis ? String(rawMapping.regulatory_basis) : null,
    site_policy_basis: rawMapping.site_policy_basis
      ? String(rawMapping.site_policy_basis)
      : null,
    severity,
    suggested_corrective_action: correctiveAction,
  };
}

/**
 * Normalizes all mapping results from the Bedrock response.
 * Matches model output to actual detections by type.
 */
export function normalizeAllMappings(
  response: BedrockRegulatoryResponse,
  detections: StoredDetection[]
): RegulatoryMappingResult[] {
  // Build a confidence lookup by detection type
  const confidenceByType = new Map<string, number>();
  for (const d of detections) {
    // Use the highest confidence if multiple detections of same type
    const existing = confidenceByType.get(d.type) ?? 0;
    if (d.confidence > existing) {
      confidenceByType.set(d.type, d.confidence);
    }
  }

  return response.mappings.map((rawMapping) => {
    const detectionConfidence =
      confidenceByType.get(rawMapping.detection_type) ?? 0;
    return normalizeMappingResult(rawMapping, detectionConfidence);
  });
}

/**
 * Fetches detection results from DynamoDB.
 */
export async function fetchDetectionResults(
  inspectionId: string,
  detectionId: string
): Promise<DetectionRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName('DetectionResults'),
      Key: {
        PK: `INSPECTION#${inspectionId}`,
        SK: `DETECTION#${detectionId}`,
      },
    })
  );

  if (!result.Item) return null;
  return result.Item as unknown as DetectionRecord;
}

/**
 * Fetches scene interpretation from DynamoDB.
 */
export async function fetchSceneInterpretation(
  inspectionId: string,
  interpretationId: string
): Promise<SceneInterpretationRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName('SceneInterpretations'),
      Key: {
        PK: `INSPECTION#${inspectionId}`,
        SK: `SCENE#${interpretationId}`,
      },
    })
  );

  if (!result.Item) return null;
  return result.Item as unknown as SceneInterpretationRecord;
}

/**
 * Fetches the active policy version for a site and jurisdiction.
 * Requirement 8.2: Include active PolicyVersion ID.
 * Requirement 8.7: Reject if unavailable.
 */
export async function fetchActivePolicyVersion(
  tenantId: string,
  siteId: string
): Promise<PolicyVersionRecord> {
  const now = new Date().toISOString();

  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName('PolicyVersions'),
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: '#status = :active AND effective_from <= :now',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}#SITE#${siteId}`,
        ':active': 'active',
        ':now': now,
      },
      ScanIndexForward: false, // Most recent first
      Limit: 1,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    throw new RegulatoryMappingError(
      `No active PolicyVersion available for site ${siteId} in jurisdiction ${WORKSAFE_BC_JURISDICTION_ID}`,
      'POLICY_VERSION_UNAVAILABLE'
    );
  }

  return result.Items[0] as unknown as PolicyVersionRecord;
}

/**
 * Reads the parent Policy's free-text `jurisdiction` label so the pipeline can
 * resolve which jurisdiction ruleset to apply. Returns null when the policy or
 * label is missing; callers fall back to the default jurisdiction.
 * Policies table key shape: PK=TENANT#<tenantId>, SK=POLICY#<policyId>.
 */
export async function fetchPolicyJurisdiction(
  tenantId: string,
  policyId: string
): Promise<string | null> {
  if (!policyId) return null;
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName('Policies'),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `POLICY#${policyId}`,
      },
    })
  );
  const label = result.Item?.['jurisdiction'];
  return typeof label === 'string' ? label : null;
}
export async function invokeBedrockMapping(
  sceneType: string,
  sceneDescription: string,
  riskContext: { primary_hazard: string; exposed_personnel_count: number } | null,
  detections: StoredDetection[],
  jurisdictionId?: string | null
): Promise<{ response: BedrockRegulatoryResponse; modelVersion: string }> {
  const systemPrompt = buildRegulatoryMappingPrompt(sceneType, jurisdictionId);
  const userMessage = buildRegulatoryUserMessage(
    sceneType,
    sceneDescription,
    riskContext,
    detections
  );

  const client = await getOllamaClient();
  const response = await client.chat({
    model: REGULATORY_OLLAMA_MODEL_CONFIG.modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    stream: false,
    options: {
      temperature: REGULATORY_OLLAMA_MODEL_CONFIG.temperature,
      num_predict: REGULATORY_OLLAMA_MODEL_CONFIG.maxTokens,
    },
  });

  const textContent = response.message?.content;

  if (!textContent) {
    throw new Error('No text content in Ollama response');
  }

  const parsed = parseBedrockRegulatoryResponse(textContent);
  const modelVersion = response.model ?? REGULATORY_OLLAMA_MODEL_CONFIG.modelId;

  return { response: parsed, modelVersion };
}

/**
 * Determines the initial finding status based on severity.
 * Requirement 9.2: high/critical → pending_review
 * Requirement 9.3: low/medium → generated
 */
export function determineInitialFindingStatus(severity: Severity): FindingStatus {
  if (severity === Severity.CRITICAL || severity === Severity.HIGH) {
    return FindingStatus.PENDING_REVIEW;
  }
  return FindingStatus.GENERATED;
}

/**
 * Stores a Finding record in the Findings DynamoDB table.
 */
export async function storeFinding(finding: FindingRecord): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: getTableName('Findings'),
      Item: {
        PK: `TENANT#${finding.tenant_id}`,
        SK: `FINDING#${finding.finding_id}`,
        GSI1PK: `SITE#${finding.site_id}`,
        GSI1SK: `FINDING#${finding.created_at}`,
        GSI2PK: `INSPECTION#${finding.inspection_id}`,
        GSI2SK: `FINDING#${finding.finding_id}`,
        ...finding,
      },
    })
  );
}

/**
 * Stores the regulatory mapping output in DynamoDB.
 */
export async function storeRegulatoryMapping(
  output: RegulatoryMappingOutput
): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: getTableName('Findings'),
      Item: {
        PK: `TENANT#${output.tenant_id}`,
        SK: `MAPPING#${output.mapping_id}`,
        GSI1PK: `INSPECTION#${output.inspection_id}`,
        GSI1SK: `MAPPING#${output.processed_at}`,
        ...output,
      },
    })
  );
}

/**
 * Main regulatory mapping pipeline.
 * Fetches context, invokes Bedrock, normalizes results, generates findings.
 *
 * Requirement 8.1: Map within 2 seconds.
 * Requirement 8.2: Include PolicyVersion ID and jurisdiction ID.
 * Requirement 8.7: Reject if policy/jurisdiction unavailable.
 */
export async function mapToRegulations(
  params: RegulatoryMappingInput
): Promise<RegulatoryMappingOutput> {
  const {
    inspectionId,
    interpretationId,
    detectionId,
    mediaAssetId,
    tenantId,
    siteId,
    sceneType,
  } = params;

  const startTime = Date.now();
  const mappingId = uuidv4();

  const log = logger.child({
    correlation_id: inspectionId,
    tenant_id: tenantId,
  });

  try {
    // Requirement 8.7: Fetch active policy version — throws if unavailable
    const policyVersion = await fetchActivePolicyVersion(tenantId, siteId);

    // Resolve the site's jurisdiction from its policy (free-text label ->
    // registry id). Falls back to the default jurisdiction (WorkSafeBC) when
    // the policy has no jurisdiction set, preserving prior behavior.
    const jurisdictionLabel = await fetchPolicyJurisdiction(
      tenantId,
      policyVersion.policy_id
    );
    const jurisdictionId = resolveJurisdictionId(jurisdictionLabel);

    // Fetch detection results
    const detectionRecord = await fetchDetectionResults(inspectionId, detectionId);
    if (!detectionRecord) {
      throw new Error(`Detection results not found: ${detectionId}`);
    }

    // Fetch scene interpretation
    const sceneRecord = await fetchSceneInterpretation(inspectionId, interpretationId);
    if (!sceneRecord) {
      throw new Error(`Scene interpretation not found: ${interpretationId}`);
    }

    const detections = detectionRecord.detections ?? [];

    // Filter detections above confidence threshold
    const qualifiedDetections = detections.filter(
      (d) => d.confidence >= VIOLATION_CONFIDENCE_THRESHOLD
    );

    log.info('Starting regulatory mapping', {
      inspectionId,
      detectionCount: qualifiedDetections.length,
      sceneType,
      policyVersionId: policyVersion.policy_version_id,
    });

    // Invoke Bedrock for regulatory mapping
    const { response, modelVersion } = await invokeBedrockMapping(
      sceneType,
      sceneRecord.scene_description,
      sceneRecord.risk_context,
      qualifiedDetections,
      jurisdictionId
    );

    // Normalize results
    const mappings = normalizeAllMappings(response, qualifiedDetections);

    const processingDuration = Date.now() - startTime;
    const hasViolations = mappings.some((m) => m.violation_flag);

    log.info('Regulatory mapping completed', {
      mappingId,
      totalMappings: mappings.length,
      violations: mappings.filter((m) => m.violation_flag).length,
      modelVersion,
      durationMs: processingDuration,
    });

    // Build output
    const output: RegulatoryMappingOutput = {
      mapping_id: mappingId,
      inspection_id: inspectionId,
      interpretation_id: interpretationId,
      detection_id: detectionId,
      media_asset_id: mediaAssetId,
      tenant_id: tenantId,
      site_id: siteId,
      policy_version_id: policyVersion.policy_version_id,
      jurisdiction_id: jurisdictionId,
      mappings,
      model_version: modelVersion,
      processed_at: new Date().toISOString(),
      processing_duration_ms: processingDuration,
      status: hasViolations
        ? RegulatoryMappingStatus.COMPLETED
        : RegulatoryMappingStatus.NO_VIOLATIONS,
    };

    // Store the mapping output
    await storeRegulatoryMapping(output);

    // Generate findings for violations
    const findings: FindingRecord[] = [];
    for (const mapping of mappings) {
      if (mapping.violation_flag && mapping.severity && mapping.regulatory_basis) {
        const finding = await generateFinding({
          mapping,
          mappingId,
          inspectionId,
          interpretationId,
          detectionId,
          mediaAssetId,
          tenantId,
          siteId,
          policyVersionId: policyVersion.policy_version_id,
          sceneType,
          sceneDescription: sceneRecord.scene_description,
          modelVersion,
        });
        findings.push(finding);
      }
    }

    log.info('Findings generated', {
      findingCount: findings.length,
      inspectionId,
    });

    return output;
  } catch (error) {
    const processingDuration = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown mapping error';

    log.error('Regulatory mapping failed', {
      error: errorMessage,
      durationMs: processingDuration,
    });

    // If it's a policy/jurisdiction error, re-throw directly (Requirement 8.7)
    if (error instanceof RegulatoryMappingError) {
      throw error;
    }

    // Store failed mapping record
    const failedOutput: RegulatoryMappingOutput = {
      mapping_id: mappingId,
      inspection_id: inspectionId,
      interpretation_id: interpretationId,
      detection_id: detectionId,
      media_asset_id: mediaAssetId,
      tenant_id: tenantId,
      site_id: siteId,
      policy_version_id: '',
      jurisdiction_id: WORKSAFE_BC_JURISDICTION_ID,
      mappings: [],
      model_version: REGULATORY_OLLAMA_MODEL_CONFIG.modelId,
      processed_at: new Date().toISOString(),
      processing_duration_ms: processingDuration,
      status: RegulatoryMappingStatus.FAILED,
      error_message: errorMessage,
    };

    await storeRegulatoryMapping(failedOutput);
    throw error;
  }
}

/**
 * Generates a Finding record from a violation mapping result.
 */
async function generateFinding(params: {
  mapping: RegulatoryMappingResult;
  mappingId: string;
  inspectionId: string;
  interpretationId: string;
  detectionId: string;
  mediaAssetId: string;
  tenantId: string;
  siteId: string;
  policyVersionId: string;
  sceneType: string;
  sceneDescription: string;
  modelVersion: string;
}): Promise<FindingRecord> {
  const {
    mapping,
    inspectionId,
    interpretationId,
    detectionId,
    mediaAssetId,
    tenantId,
    siteId,
    policyVersionId,
    sceneType,
    sceneDescription,
    modelVersion,
  } = params;

  const findingId = uuidv4();
  const now = new Date().toISOString();
  const initialStatus = determineInitialFindingStatus(mapping.severity!);

  const finding: FindingRecord = {
    finding_id: findingId,
    inspection_id: inspectionId,
    interpretation_id: interpretationId,
    detection_id: detectionId,
    media_asset_id: mediaAssetId,
    tenant_id: tenantId,
    site_id: siteId,
    policy_version_id: policyVersionId,
    jurisdiction_id: WORKSAFE_BC_JURISDICTION_ID,
    severity: mapping.severity!,
    status: initialStatus,
    violation_flag: true,
    regulatory_basis: mapping.regulatory_basis!,
    site_policy_basis: mapping.site_policy_basis ?? null,
    suggested_corrective_action: mapping.suggested_corrective_action ?? '',
    scene_type: sceneType,
    scene_description: sceneDescription,
    detection_type: mapping.detection_type,
    detection_confidence: mapping.detection_confidence,
    model_version: modelVersion,
    created_at: now,
    updated_at: now,
  };

  await storeFinding(finding);

  return finding;
}
