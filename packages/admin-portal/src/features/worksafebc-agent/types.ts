/**
 * WorkSafeBC PDF Compliance Agent — frontend types.
 * Mirror of the backend worksafebc-types.ts shapes the API returns.
 */

export type DocumentCategory =
  | 'plan_seguridad'
  | 'procedimiento_trabajo_seguro'
  | 'evaluacion_riesgo'
  | 'formulario_contratista'
  | 'otro';

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  plan_seguridad: 'Plan de Seguridad',
  procedimiento_trabajo_seguro: 'Procedimiento de Trabajo Seguro',
  evaluacion_riesgo: 'Evaluación de Riesgo',
  formulario_contratista: 'Formulario de Contratista',
  otro: 'Otro',
};

export type SessionStatus =
  | 'recibido'
  | 'categorizado'
  | 'texto_extraido'
  | 'analizando'
  | 'analisis_completado'
  | 'extraccion_fallida'
  | 'analisis_fallido'
  | 'timeout';

export const TERMINAL_STATUSES: SessionStatus[] = [
  'analisis_completado',
  'extraccion_fallida',
  'analisis_fallido',
  'timeout',
];

export type FindingSeverity = 'critica' | 'alta' | 'media' | 'baja';
export type FindingType = 'brecha' | 'conforme';
export type ComplianceLevel =
  | 'conforme'
  | 'parcialmente_conforme'
  | 'no_conforme'
  | 'no_evaluable';

export interface HallazgoCumplimiento {
  finding_id: string;
  type: FindingType;
  severity: FindingSeverity | null;
  description: string;
  regulatory_basis: string;
  regulation_part: string;
  evidence_excerpt: string | null;
}

export interface ReporteCumplimiento {
  compliance_level: ComplianceLevel;
  executive_summary: string;
  findings: HallazgoCumplimiento[];
  recommendations: string[];
  category: DocumentCategory;
  ai_model_version: string;
  regulatory_kb_version_id: string;
  generated_at: string;
}

export interface AnalysisSession {
  session_id: string;
  tenant_id: string;
  site_id: string;
  document_group_id: string;
  document_name: string;
  document_page_count: number;
  category: DocumentCategory | null;
  status: SessionStatus;
  started_at: string;
  completed_at: string | null;
  report: ReporteCumplimiento | null;
  previous_session_id: string | null;
  failure_reason: string | null;
}

export interface CreateSessionResponse {
  session_id: string;
  upload_url: string;
  document_key: string;
  status: SessionStatus;
}

export interface RegulatoryVersion {
  version_id: string;
  effective_date: string;
  published_by: string;
  published_at: string;
  change_summary: string;
  clause_count: number;
}
