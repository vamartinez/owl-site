/**
 * WorkSafeBC PDF Compliance Agent — shared domain types.
 *
 * This module EXTENDS the report-validation service (per design.md's "Key
 * Design Decision") with the WorkSafeBC-specific data model: analysis
 * sessions, the versioned regulatory clause knowledge base, compliance
 * findings, and the Reporte_Cumplimiento. Types match design.md's data model
 * exactly, including every length/count cap.
 *
 * Requirements: 3.3, 3.4, 4.2, 4.3, 7.7
 */

// ---------------------------------------------------------------------------
// Caps (single source of truth — imported by the schema/parser in task 12.1)
// ---------------------------------------------------------------------------

/** Requirement 4.2: at most 200 findings per report. */
export const MAX_FINDINGS = 200;
/** Requirement 4.2: at most 50 recommendations per report. */
export const MAX_RECOMMENDATIONS = 50;
/** Requirement 4.3 / 8.1: executive summary max length. */
export const MAX_EXECUTIVE_SUMMARY_CHARS = 1000;
/** Requirement 4.3: finding description max length. */
export const MAX_FINDING_DESCRIPTION_CHARS = 500;
/** Requirement 4.3: recommendation max length. */
export const MAX_RECOMMENDATION_CHARS = 500;
/** Requirement 7.7: regulation clause text max length. */
export const MAX_REGULATION_TEXT_CHARS = 10000;
/** Requirement 7.7: change summary max length. */
export const MAX_CHANGE_SUMMARY_CHARS = 1000;
/** Requirement 7.7: applicability categories max count per clause. */
export const MAX_APPLICABILITY_CATEGORIES = 20;
/** Requirements 3.9 / 8.4: max serialized report size for the parser. */
export const MAX_REPORT_JSON_BYTES = 10 * 1024 * 1024; // 10MB
/** Requirement 5.4: regulatory retention window. */
export const RETENTION_YEARS = 7;

// ---------------------------------------------------------------------------
// Type unions
// ---------------------------------------------------------------------------

/** Document category the uploader assigns (Requisito 1.5, 3.2). */
export type DocumentCategory =
  | 'plan_seguridad'
  | 'procedimiento_trabajo_seguro'
  | 'evaluacion_riesgo'
  | 'formulario_contratista'
  | 'otro';

/** The five allowed category values, for runtime validation. */
export const DOCUMENT_CATEGORIES: readonly DocumentCategory[] = [
  'plan_seguridad',
  'procedimiento_trabajo_seguro',
  'evaluacion_riesgo',
  'formulario_contratista',
  'otro',
] as const;

/**
 * Analysis session lifecycle (Sesion_Analisis). Terminal states are
 * analisis_completado, extraccion_fallida, analisis_fallido, timeout.
 * Requirements: 1.6, 2.x, 3.x, 6.5
 */
export type SessionStatus =
  | 'recibido'
  | 'categorizado'
  | 'texto_extraido'
  | 'analizando'
  | 'analisis_completado'
  | 'extraccion_fallida'
  | 'analisis_fallido'
  | 'timeout';

/** Terminal session states (no further transition). */
export const TERMINAL_SESSION_STATUSES: readonly SessionStatus[] = [
  'analisis_completado',
  'extraccion_fallida',
  'analisis_fallido',
  'timeout',
] as const;

/**
 * Severity for a 'brecha' (gap) finding. Deterministic closed set — the LLM's
 * raw output is mapped into this set by classifySeverity (task 8.2), never
 * assigned freely by the model. Requirement 3.5.
 */
export type FindingSeverity = 'critica' | 'alta' | 'media' | 'baja';

export const FINDING_SEVERITIES: readonly FindingSeverity[] = [
  'critica',
  'alta',
  'media',
  'baja',
] as const;

/** Finding type: a compliance gap or a conforming observation. */
export type FindingType = 'brecha' | 'conforme';

/**
 * Overall compliance level (Nivel_Cumplimiento). `no_evaluable` covers the
 * case where the document has no evaluable content for its category
 * (Requirement 3.10). Requirements: 3.6, 4.9.
 */
export type ComplianceLevel =
  | 'conforme'
  | 'parcialmente_conforme'
  | 'no_conforme'
  | 'no_evaluable';

// ---------------------------------------------------------------------------
// Findings & report (Reporte_Cumplimiento)
// ---------------------------------------------------------------------------

/**
 * A single compliance finding (Hallazgo_Cumplimiento).
 * `regulatory_basis` cites the OHSR clause the finding maps to. `severity` is
 * null for 'conforme' findings (only 'brecha' findings carry a severity).
 * Requirements: 3.3, 3.4, 4.3.
 */
export interface HallazgoCumplimiento {
  finding_id: string;
  type: FindingType;
  severity: FindingSeverity | null; // null for 'conforme'
  description: string; // max MAX_FINDING_DESCRIPTION_CHARS
  regulatory_basis: string; // OHSR clause reference, e.g. 'OHSR 11.2'
  regulation_part: string; // e.g. 'Part 11'
  evidence_excerpt: string | null; // supporting text from the document, if any
}

/**
 * The compliance report embedded in the session (Reporte_Cumplimiento).
 * Requirements: 4.2, 4.3, 4.4, 8.1.
 */
export interface ReporteCumplimiento {
  compliance_level: ComplianceLevel;
  executive_summary: string; // max MAX_EXECUTIVE_SUMMARY_CHARS
  findings: HallazgoCumplimiento[]; // max MAX_FINDINGS, sorted by severity desc
  recommendations: string[]; // max MAX_RECOMMENDATIONS, each max MAX_RECOMMENDATION_CHARS
  // Metadata (Requirement 4.4)
  category: DocumentCategory;
  ai_model_version: string;
  regulatory_kb_version_id: string;
  generated_at: string; // ISO 8601 UTC
}

// ---------------------------------------------------------------------------
// Analysis session (Sesion_Analisis)
// ---------------------------------------------------------------------------

/** Extraction metrics recorded after text extraction (Requirement 2.6). */
export interface ExtractionMetrics {
  pages_processed: number;
  pages_ocr_applied: number;
  avg_confidence: number;
}

/**
 * An analysis session record stored in the AnalysisSessions table.
 * Key shape (design.md):
 *   PK: TENANT#{tenant_id}
 *   SK: SESSION#{session_id}
 *   GSI1PK: TENANT#{tenant_id}#SITE#{site_id}      GSI1SK: SESSION#{started_at}
 *   GSI2PK: TENANT#{tenant_id}#DOCUMENT#{document_group_id}  GSI2SK: SESSION#{started_at}
 * Requirements: 1.6, 5.1, 5.4, 5.5.
 */
export interface AnalysisSession {
  session_id: string;
  tenant_id: string;
  site_id: string;
  document_group_id: string; // links re-analyses of the same source document
  document_key: string; // S3 object key
  document_name: string;
  document_size_bytes: number;
  document_page_count: number;
  category: DocumentCategory | null; // null until categorizado
  status: SessionStatus;
  started_by: string; // Cognito user id
  started_at: string; // ISO 8601 UTC
  completed_at: string | null;
  extraction_metrics: ExtractionMetrics | null;
  ai_model_version: string | null;
  regulatory_kb_version_id: string | null;
  report: ReporteCumplimiento | null; // embedded on completion
  previous_session_id: string | null; // for re-analysis chains
  failure_reason: string | null;
  notification_delivered: boolean;
  retention_expires_at: string; // started_at + RETENTION_YEARS
}

// ---------------------------------------------------------------------------
// Versioned regulatory knowledge base
// ---------------------------------------------------------------------------

/**
 * A single OHSR clause in the RegulatoryClauses table.
 * Key shape (design.md):
 *   PK: PART#{part_number}
 *   SK: VERSION#{version_id}#SECTION#{section}#CLAUSE#{clause}
 *   GSI1PK: VERSION#{version_id}   GSI1SK: PART#{part}#SECTION#{section}#CLAUSE#{clause}
 * Requirements: 7.2, 7.3, 7.7.
 */
export interface RegulatoryClause {
  part_number: string; // e.g. '11'
  section: string; // e.g. '11.2'
  clause: string; // e.g. '(1)(a)'
  version_id: string; // zero-padded sequential, e.g. '000001'
  effective_date: string; // ISO 8601 date (YYYY-MM-DD)
  regulation_text: string; // max MAX_REGULATION_TEXT_CHARS
  applicability_categories: string[]; // max MAX_APPLICABILITY_CATEGORIES
  last_updated_at: string; // ISO 8601 UTC
  published_by: string;
  change_summary: string; // max MAX_CHANGE_SUMMARY_CHARS
}

/**
 * Version metadata, one item per published version (RegulatoryVersions table).
 * Key shape (design.md):
 *   PK: WORKSAFEBC_KB
 *   SK: VERSION#{version_id}  (zero-padded sequential for lexicographic order)
 * Requirements: 7.4, 7.5, 7.8.
 */
export interface RegulatoryVersion {
  version_id: string; // zero-padded sequential, e.g. '000001'
  effective_date: string; // ISO 8601 date (YYYY-MM-DD)
  published_by: string;
  published_at: string; // ISO 8601 UTC
  change_summary: string; // max MAX_CHANGE_SUMMARY_CHARS
  clause_count: number;
}

// ---------------------------------------------------------------------------
// SQS message envelopes for the async pipeline (task 6+)
// ---------------------------------------------------------------------------

/** Message enqueued on pdf-compliance-analysis-queue. */
export type PipelineMessageKind = 'extract' | 'analyze';

export interface PipelineMessage {
  kind: PipelineMessageKind;
  session_id: string;
  tenant_id: string;
}

// ---------------------------------------------------------------------------
// DynamoDB logical table names (resolved via getTableName).
// ---------------------------------------------------------------------------

export const ANALYSIS_SESSIONS_TABLE = 'AnalysisSessions';
export const REGULATORY_CLAUSES_TABLE = 'RegulatoryClauses';
export const REGULATORY_VERSIONS_TABLE = 'RegulatoryVersions';

/** Single partition key for the RegulatoryVersions table. */
export const REGULATORY_VERSIONS_PK = 'WORKSAFEBC_KB';
