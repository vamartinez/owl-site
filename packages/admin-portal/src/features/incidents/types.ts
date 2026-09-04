/**
 * Incident Reporting frontend types.
 * Mirrors backend enums/interfaces optimized for frontend use.
 *
 * Requirements: 2.1, 3.1, 5.1, 12.1
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

/**
 * Classification of incident by type.
 * Requirement 2.1: Supported incident types.
 */
export enum IncidentType {
  INJURY = 'injury',
  ILLNESS = 'illness',
  NEAR_MISS = 'near_miss',
  UNSAFE_CONDITION = 'unsafe_condition',
  PROPERTY_DAMAGE = 'property_damage',
  ENVIRONMENTAL = 'environmental',
  FIRE_EXPLOSION = 'fire_explosion',
  STRUCTURAL_FAILURE = 'structural_failure',
  HAZARDOUS_SUBSTANCE = 'hazardous_substance',
  REGULATORY_NON_COMPLIANCE = 'regulatory_non_compliance',
  OTHER = 'other',
}

/**
 * Internal classification of incident impact.
 * Requirement 4.1: Operational severity levels.
 */
export enum OperationalSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Regulatory character indicator independent of operational severity.
 * Requirement 4.2: Regulatory flag values.
 */
export enum RegulatoryFlag {
  INTERNAL_ONLY = 'internal_only',
  POTENTIALLY_REPORTABLE = 'potentially_reportable',
  IMMEDIATELY_REPORTABLE = 'immediately_reportable',
}

/**
 * Incident lifecycle states.
 * Requirement 5.1: Supported incident states.
 */
export enum IncidentStatus {
  OPEN = 'open',
  UNDER_REVIEW = 'under_review',
  REGULATORY_REVIEW = 'regulatory_review',
  ACTION_REQUIRED = 'action_required',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

/**
 * External regulatory compliance status.
 */
export enum ExternalReportStatus {
  NOT_REPORTABLE = 'not_reportable',
  POTENTIALLY_REPORTABLE = 'potentially_reportable',
  REPORTED_WORKSAFEBC = 'reported_worksafebc',
  REPORTED_OSHA = 'reported_osha',
  EXTERNAL_REPORT_PENDING = 'external_report_pending',
  EXTERNAL_REPORT_NOT_APPLICABLE = 'external_report_not_applicable',
}

/**
 * Role of a person involved in an incident.
 */
export enum InvolvementType {
  INJURED_WORKER = 'injured_worker',
  WITNESS = 'witness',
  SUPERVISOR_PRESENT = 'supervisor_present',
  ASSOCIATED_CONTRACTOR = 'associated_contractor',
}

/**
 * OSHA recordability classifications.
 */
export enum OshaRecordability {
  FIRST_AID_ONLY = 'first_aid_only',
  MEDICAL_TREATMENT = 'medical_treatment',
  DAYS_AWAY = 'days_away',
  RESTRICTED_WORK = 'restricted_work',
  JOB_TRANSFER = 'job_transfer',
  FATALITY = 'fatality',
}

/**
 * OSHA case outcome categories for Form 300/300A.
 */
export enum OshaCaseOutcome {
  DEATH = 'death',
  DAYS_AWAY_FROM_WORK = 'days_away_from_work',
  RESTRICTED_WORK = 'restricted_work',
  JOB_TRANSFER = 'job_transfer',
  OTHER_RECORDABLE = 'other_recordable',
}

/**
 * Types of events recorded in the immutable incident timeline.
 */
export enum TimelineEventType {
  CREATION = 'creation',
  SEVERITY_CHANGE = 'severity_change',
  STATE_CHANGE = 'state_change',
  REGULATORY_EVALUATION = 'regulatory_evaluation',
  REGULATORY_REVIEW_CONFIRMATION = 'regulatory_review_confirmation',
  EXTERNAL_STATUS_CHANGE = 'external_status_change',
  ATTACHMENT_ADDED = 'attachment_added',
  COMMENT_ADDED = 'comment_added',
  PERSON_ADDED = 'person_added',
  PERSON_REMOVED = 'person_removed',
  CLOSURE = 'closure',
  REOPENING = 'reopening',
  NOTIFICATION_SENT = 'notification_sent',
  FIELD_UPDATED = 'field_updated',
  REGULATORY_FLAG_CHANGE = 'regulatory_flag_change',
  RECORDABILITY_CHANGE = 'recordability_change',
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

/**
 * Boolean regulatory indicators captured during incident creation.
 * Requirement 3.3: Regulatory indicators with default value of false.
 */
export interface RegulatoryIndicators {
  medical_treatment_beyond_first_aid: boolean;
  lost_time: boolean;
  hospitalization: boolean;
  fatality: boolean;
  amputation: boolean;
  loss_of_eye: boolean;
  structural_collapse: boolean;
  hazardous_substance_release: boolean;
  fire_or_explosion: boolean;
}

/**
 * Core incident record as returned by the API.
 * Requirement 3.1: Mandatory and optional fields for an incident report.
 */
export interface Incident {
  incident_id: string;
  tenant_id: string;
  site_id: string;
  title: string;
  description: string;
  incident_type: IncidentType;
  other_type_description?: string;
  incident_datetime: string;
  report_datetime: string;
  location: string;
  persons_involved_count: number;
  reporting_user_id: string;
  reporting_user_name: string;
  severity: OperationalSeverity;
  regulatory_flag: RegulatoryFlag;
  status: IncidentStatus;
  external_report_status: ExternalReportStatus;
  regulatory_indicators: RegulatoryIndicators;
  jurisdiction: string;
  osha_recordability?: OshaRecordability;
  resolution_notes?: string;
  closure_date?: string;
  closed_by?: string;
  reopen_justification?: string;
  created_at: string;
  updated_at: string;
  linked_documents_count?: number;
}

/**
 * Person involved in an incident.
 */
export interface InvolvedPerson {
  person_id: string;
  incident_id: string;
  tenant_id: string;
  full_name: string;
  involvement_type: InvolvementType;
  organization: string;
  worker_id?: string;
}

/**
 * Evidence file attached to an incident.
 */
export interface IncidentAttachment {
  attachment_id: string;
  incident_id: string;
  tenant_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  s3_key: string;
  uploaded_by: string;
  confirmed: boolean;
  created_at: string;
}

/**
 * Internal comment or investigation note on an incident.
 */
export interface IncidentComment {
  comment_id: string;
  incident_id: string;
  tenant_id: string;
  author_id: string;
  author_name: string;
  content: string;
  created_at: string;
}

/**
 * Immutable timeline event for audit trail.
 */
export interface TimelineEvent {
  event_id: string;
  incident_id: string;
  tenant_id: string;
  event_type: TimelineEventType;
  actor_id: string;
  actor_name: string;
  data: Record<string, unknown>;
  timestamp: string;
}

/**
 * Regulatory suggestion from the evaluation engine.
 */
export interface RegulatorySuggestion {
  authority: 'OSHA' | 'WorkSafeBC';
  action: string;
  urgency: 'immediate' | 'within_deadline' | 'informational';
  deadline_hours?: number;
  rule_reference: string;
}

/**
 * Regulatory deadline computed by the evaluation engine.
 */
export interface RegulatoryDeadline {
  authority: 'OSHA' | 'WorkSafeBC';
  deadline_hours: number;
  deadline_from: 'incident_time' | 'employer_knowledge';
  absolute_deadline: string;
  description: string;
}

/**
 * Result from the regulatory evaluation engine (returned with incident creation).
 */
export interface RegulatoryEvaluationResult {
  regulatory_flag: RegulatoryFlag;
  suggestions: RegulatorySuggestion[];
  deadlines: RegulatoryDeadline[];
  applied_rules: string[];
}

// ─── API Request/Response Types ──────────────────────────────────────────────

export interface CreateIncidentRequest {
  title: string;
  description: string;
  incident_type: IncidentType;
  other_type_description?: string;
  incident_datetime: string;
  site_id: string;
  worker_id?: string;
  location: string;
  persons_involved_count: number;
  severity: OperationalSeverity;
  jurisdiction?: string;
  regulatory_indicators: RegulatoryIndicators;
}

export interface CreateIncidentResponse {
  incident: Incident;
  regulatory_result: RegulatoryEvaluationResult;
}

export interface UpdateIncidentRequest {
  title?: string;
  description?: string;
  incident_type?: IncidentType;
  other_type_description?: string;
  incident_datetime?: string;
  location?: string;
  persons_involved_count?: number;
  severity?: OperationalSeverity;
  regulatory_indicators?: RegulatoryIndicators;
}

export interface StateTransitionRequest {
  status: IncidentStatus;
}

export interface AddCommentRequest {
  content: string;
}

export interface CloseIncidentRequest {
  resolution_notes: string;
}

export interface ReopenIncidentRequest {
  justification: string;
}

export interface InitiateAttachmentRequest {
  file_name: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds?: number;
}

export interface InitiateAttachmentResponse {
  attachment_id: string;
  upload_url: string;
}

export interface AddPersonRequest {
  full_name: string;
  involvement_type: InvolvementType;
  organization: string;
  worker_id?: string;
}

export type ListIncidentsResponse = Incident[];
export type ListCommentsResponse = IncidentComment[];
export type ListTimelineResponse = TimelineEvent[];

// ─── Linked Documents Types ──────────────────────────────────────────────────
// Requirements: 2.1, 3.2

/**
 * Classification of a document linked to an incident.
 * Requirement 2.1: Supported document categories.
 */
export type DocumentCategory =
  | 'investigacion'
  | 'accion_correctiva'
  | 'inspeccion'
  | 'declaracion_testigo'
  | 'reporte_seguimiento'
  | 'otro';

/**
 * Record representing a linked document (form response) associated with an incident.
 */
export interface LinkedDocument {
  link_id: string;
  incident_id: string;
  response_id: string;
  form_id: string;
  document_category: DocumentCategory;
  custom_category_description?: string;
  context_note?: string;
  linked_by: string;
  linked_by_name: string;
  linked_at: string;
  form_name: string;
  folio: string;
  response_submitted_at: string;
  response_submitted_by: string;
}

/**
 * A form response available to be linked to an incident.
 */
export interface LinkableResponse {
  response_id: string;
  form_id: string;
  form_name: string;
  folio: string;
  submitted_at: string;
  submitted_by_name: string;
}

/**
 * Request payload for creating a link between an incident and a form response.
 */
export interface CreateLinkRequest {
  response_id: string;
  form_id: string;
  document_category: DocumentCategory;
  custom_category_description?: string;
  context_note?: string;
}

/**
 * Request payload for unlinking a document from an incident.
 */
export interface UnlinkRequest {
  justification: string;
}

/**
 * API response for fetching linked documents of an incident.
 */
export interface LinkedDocumentsResponse {
  linked_documents: LinkedDocument[];
  total_count: number;
}

/**
 * API response for searching linkable form responses.
 */
export interface LinkableResponsesResponse {
  responses: LinkableResponse[];
  total_count: number;
  page: number;
  page_size: number;
}

/**
 * Human-readable labels for each document category.
 */
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  investigacion: 'Investigación',
  accion_correctiva: 'Acción Correctiva',
  inspeccion: 'Inspección',
  declaracion_testigo: 'Declaración de Testigo',
  reporte_seguimiento: 'Reporte de Seguimiento',
  otro: 'Otro',
};

/**
 * Color tokens for rendering document category badges.
 */
export const DOCUMENT_CATEGORY_COLORS: Record<DocumentCategory, string> = {
  investigacion: 'purple',
  accion_correctiva: 'danger',
  inspeccion: 'info',
  declaracion_testigo: 'warning',
  reporte_seguimiento: 'success',
  otro: 'default',
};
