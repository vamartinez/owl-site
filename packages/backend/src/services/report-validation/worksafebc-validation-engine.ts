/**
 * WorkSafeBC Validation Engine.
 *
 * New domain logic for the PDF compliance agent (design.md). Extends
 * report-validation by reusing its RAG retrieval + Ollama chat pattern, but
 * adds:
 *  - selectApplicableParts: category -> OHSR parts (task 8.1)
 *  - classifySeverity: deterministic map of raw LLM output -> closed set (8.2)
 *  - assignComplianceLevel: pure function of findings (8.2)
 *  - analyzeCompliance: RAG analysis producing findings + level + recs (8.5)
 *
 * Requirements: 3.1-3.10, 4.9
 *
 * ASSUMPTION (flagged): the 3.6-vs-4.9 discrepancy is resolved in favor of
 * Requirement 4.9 (design.md's recommendation). assignComplianceLevel below
 * implements the reconciled 4.9 rule. Confirm with product owner.
 */

import { v4 as uuidv4 } from 'uuid';
import { getOllamaClient } from '../../shared/ollama-client.js';
import { createLogger } from '../../shared/logger.js';
import { retrieveTopK } from './retrieval.js';
import {
  MAX_FINDINGS,
  MAX_RECOMMENDATIONS,
  MAX_FINDING_DESCRIPTION_CHARS,
  MAX_RECOMMENDATION_CHARS,
  FINDING_SEVERITIES,
  type DocumentCategory,
  type FindingSeverity,
  type FindingType,
  type ComplianceLevel,
  type HallazgoCumplimiento,
} from './worksafebc-types.js';

const logger = createLogger('worksafebc-validation-engine');

/** Ollama text model config (mirrors validation-engine's pattern). */
export const WORKSAFEBC_OLLAMA_MODEL_CONFIG = {
  modelId: 'gpt-oss:120b-cloud',
  maxTokens: 4096,
  temperature: 0.1,
} as const;

export interface AnalyzeInput {
  session_id: string;
  tenant_id: string;
  extracted_text: string;
  category: DocumentCategory;
  regulatory_version_id: string;
}

export interface AnalyzeResult {
  findings: HallazgoCumplimiento[];
  compliance_level: ComplianceLevel;
  recommendations: string[];
  ai_model_version: string;
}

// ---------------------------------------------------------------------------
// 8.1 — Category -> applicable OHSR parts (static mapping)
// ---------------------------------------------------------------------------

/**
 * Maps a document category to the OHSR parts to query. Superset-leaning so no
 * relevant regulation is missed; refine with a domain expert (task 8.1 note).
 * Parts: 4 General, 8 PPE, 11 Fall Protection, 13 Ladders/Scaffolds,
 * 18 Traffic Control, 20 Construction/Excavation, 21 Blasting.
 */
const CATEGORY_TO_PARTS: Record<DocumentCategory, string[]> = {
  plan_seguridad: ['Part 4', 'Part 8', 'Part 11', 'Part 20'],
  procedimiento_trabajo_seguro: ['Part 4', 'Part 8', 'Part 11', 'Part 13', 'Part 20'],
  evaluacion_riesgo: ['Part 4', 'Part 11', 'Part 18', 'Part 20', 'Part 21'],
  formulario_contratista: ['Part 4', 'Part 8'],
  otro: ['Part 4'],
};

export function selectApplicableParts(category: DocumentCategory): string[] {
  return CATEGORY_TO_PARTS[category] ?? ['Part 4'];
}

// ---------------------------------------------------------------------------
// 8.2 — Deterministic severity classification (total function)
// ---------------------------------------------------------------------------

/**
 * Map a raw LLM severity string into the closed set {critica,alta,media,baja}.
 * TOTAL: any input (including unknown/garbage) returns exactly one value.
 * English synonyms are mapped so the model's output is normalized regardless
 * of language. Unknown -> 'media' (conservative middle) rather than dropped.
 * Requirement 3.5.
 */
export function classifySeverity(raw: string | null | undefined): FindingSeverity {
  const s = (raw ?? '').trim().toLowerCase();
  if (['critica', 'crítica', 'critical'].includes(s)) return 'critica';
  if (['alta', 'high', 'major'].includes(s)) return 'alta';
  if (['media', 'medium', 'moderate', 'minor'].includes(s)) return 'media';
  if (['baja', 'low', 'informational', 'info'].includes(s)) return 'baja';
  return 'media';
}

// ---------------------------------------------------------------------------
// 8.2 — Compliance-level assignment (pure function of findings)
// ---------------------------------------------------------------------------

/**
 * Reconciled Requirement 4.9 rule (authoritative over 3.6 per design.md):
 *   - any 'brecha' with severity in {critica, alta}      => no_conforme
 *   - else any 'brecha' with severity in {media, baja}    => parcialmente_conforme
 *   - else no evaluable content                           => no_evaluable
 *   - else                                                => conforme
 * `hasEvaluableContent` is false only when the document had nothing to assess
 * for its category (Requirement 3.10).
 * PURE + total: same findings + flag always yields the same level.
 */
export function assignComplianceLevel(
  findings: HallazgoCumplimiento[],
  hasEvaluableContent = true
): ComplianceLevel {
  const brechas = findings.filter((f) => f.type === 'brecha');
  if (brechas.some((f) => f.severity === 'critica' || f.severity === 'alta')) {
    return 'no_conforme';
  }
  if (brechas.some((f) => f.severity === 'media' || f.severity === 'baja')) {
    return 'parcialmente_conforme';
  }
  if (!hasEvaluableContent && brechas.length === 0) {
    return 'no_evaluable';
  }
  return 'conforme';
}

// ---------------------------------------------------------------------------
// Prompt + parsing helpers
// ---------------------------------------------------------------------------

export function buildWorkSafeBCPrompt(parts: string[]): string {
  return `You are a WorkSafeBC construction compliance analyst. Analyze the document against the WorkSafeBC OHS Regulation, focusing on: ${parts.join(', ')}.

For each issue, produce a finding:
- type: "brecha" (a compliance gap) or "conforme" (a satisfied requirement)
- severity: for "brecha" only, one of "critica" | "alta" | "media" | "baja"; null for "conforme"
- description: max ${MAX_FINDING_DESCRIPTION_CHARS} characters
- regulatory_basis: the specific OHSR clause, e.g. "OHSR 11.2"
- regulation_part: the OHSR part, e.g. "Part 11"
- evidence_excerpt: supporting text from the document, or null

Respond ONLY with valid JSON:
{"findings":[{"type":"brecha","severity":"alta","description":"...","regulatory_basis":"OHSR 11.2","regulation_part":"Part 11","evidence_excerpt":"..."}],"has_evaluable_content":true}

If the document has no content relevant to these parts, return {"findings":[],"has_evaluable_content":false}.`;
}

interface RawFinding {
  type?: string;
  severity?: string | null;
  description?: string;
  regulatory_basis?: string;
  regulation_part?: string;
  evidence_excerpt?: string | null;
}

/** Parse + normalize the model output into typed, capped findings. */
export function normalizeFindings(raw: RawFinding[]): HallazgoCumplimiento[] {
  const findings: HallazgoCumplimiento[] = raw.map((r) => {
    const type: FindingType = r.type === 'conforme' ? 'conforme' : 'brecha';
    return {
      finding_id: uuidv4(),
      type,
      severity: type === 'brecha' ? classifySeverity(r.severity) : null,
      description: (r.description ?? '').slice(0, MAX_FINDING_DESCRIPTION_CHARS),
      regulatory_basis: r.regulatory_basis ?? '',
      regulation_part: r.regulation_part ?? '',
      evidence_excerpt: r.evidence_excerpt ?? null,
    };
  });

  // Sort by severity descending (critica > alta > media > baja > conforme).
  const rank = (f: HallazgoCumplimiento): number =>
    f.severity ? FINDING_SEVERITIES.indexOf(f.severity) : FINDING_SEVERITIES.length;
  findings.sort((a, b) => rank(a) - rank(b));

  // Cap at MAX_FINDINGS, dropping lowest-severity first (already sorted).
  return findings.slice(0, MAX_FINDINGS);
}

/** Generate 1-3 recommendations per critical/alta 'brecha', capped total. */
export function buildRecommendations(findings: HallazgoCumplimiento[]): string[] {
  const recs: string[] = [];
  for (const f of findings) {
    if (f.type === 'brecha' && (f.severity === 'critica' || f.severity === 'alta')) {
      const rec = `Address ${f.regulatory_basis || f.regulation_part}: ${f.description}`.slice(
        0,
        MAX_RECOMMENDATION_CHARS
      );
      recs.push(rec);
      if (recs.length >= MAX_RECOMMENDATIONS) break;
    }
  }
  return recs.slice(0, MAX_RECOMMENDATIONS);
}

// ---------------------------------------------------------------------------
// 8.5 — analyzeCompliance (RAG analysis)
// ---------------------------------------------------------------------------

export async function analyzeCompliance(input: AnalyzeInput): Promise<AnalyzeResult> {
  const parts = selectApplicableParts(input.category);

  // Retrieve regulatory grounding (reuse report-validation's retrieval).
  const clauses = await retrieveTopK(input.extracted_text.slice(0, 4000), { k: 8 });
  const systemPrompt =
    buildWorkSafeBCPrompt(parts) +
    '\n\nRegulatory reference clauses:\n' +
    clauses.map((c) => `- ${c.clause_id} ${c.title}: ${c.text}`).join('\n');

  const client = await getOllamaClient();
  const response = await client.chat({
    model: WORKSAFEBC_OLLAMA_MODEL_CONFIG.modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input.extracted_text.slice(0, 12000) },
    ],
    stream: false,
    options: {
      temperature: WORKSAFEBC_OLLAMA_MODEL_CONFIG.temperature,
      num_predict: WORKSAFEBC_OLLAMA_MODEL_CONFIG.maxTokens,
    },
  });

  const text = response.message?.content;
  if (!text) throw new Error('No content in Ollama response');

  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as {
    findings?: RawFinding[];
    has_evaluable_content?: boolean;
  };

  const findings = normalizeFindings(parsed.findings ?? []);
  const hasEvaluable = parsed.has_evaluable_content !== false;
  const compliance_level = assignComplianceLevel(findings, hasEvaluable);
  const recommendations = buildRecommendations(findings);

  logger.info('WorkSafeBC analysis complete', {
    session_id: input.session_id,
    findings: findings.length,
    compliance_level,
  });

  return {
    findings,
    compliance_level,
    recommendations,
    ai_model_version: response.model ?? WORKSAFEBC_OLLAMA_MODEL_CONFIG.modelId,
  };
}
