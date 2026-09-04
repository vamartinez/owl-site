/**
 * Incident Reporting Service domain types.
 * Defines all enums and interfaces for the incident reporting module.
 *
 * Requirements: 2.1, 3.1, 3.3, 4.1, 4.2, 5.1, 6.1, 11.1, 11.2, 13.1, 15.1, 16.1
 */

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
 * Requirement 16.1: External report status values.
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
 * Requirement 13.1: Involvement types.
 */
export enum InvolvementType {
  INJURED_WORKER = 'injured_worker',
  WITNESS = 'witness',
  SUPERVISOR_PRESENT = 'supervisor_present',
  ASSOCIATED_CONTRACTOR = 'associated_contractor',
}

/**
 * OSHA recordability classifications.
 * Requirement 11.1: Recordability distinction.
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
 * Requirement 11.2: Case outcome types.
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
 * Requirement 15.1: Timeline event types.
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
  DOCUMENT_LINKED = 'document_linked',
  DOCUMENT_UNLINKED = 'document_unlinked',
}

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
 * Core incident record stored in DynamoDB.
 * Requirement 3.1: Mandatory and optional fields for an incident report.
 */
export interface IncidentRecord {
  incident_id: string;
  tenant_id: string;
  site_id: string;
  title: string;
  description: string;
  incident_type: IncidentType;
  other_type_description?: string;
  incident_datetime: string; // ISO 8601
  report_datetime: string;   // ISO 8601
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
 * Requirement 13.1: Persons involved data structure.
 */
export interface InvolvedPerson {
  person_id: string;
  incident_id: string;
  tenant_id: string;
  full_name: string;
  involvement_type: InvolvementType;
  organization: string;
  worker_id?: string; // Optional link to ClearSite worker
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
 * Requirement 13.1: Comment data structure.
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
 * Requirement 15.1: Timeline event structure.
 */
export interface TimelineEvent {
  event_id: string;
  incident_id: string;
  tenant_id: string;
  event_type: TimelineEventType;
  actor_id: string;
  actor_name: string;
  data: Record<string, unknown>; // Change-specific data (previous/new values)
  timestamp: string; // ISO 8601 UTC
}

/**
 * WorkSafeBC employer injury/illness report data.
 * Requirement 6.1: WorkSafeBC regulatory data.
 */
export interface WorkSafeBCEmployerReport {
  employer_name: string;
  employer_address: string;
  employer_phone: string;
  worksafebc_account_number: string;
  worker_name: string;
  worker_address: string;
  worker_date_of_birth: string;
  worker_occupation: string;
  worker_hire_date: string;
  incident_description: string;
  body_part_affected: string;
  nature_of_injury: string;
  days_shifts_lost: number;
  modified_work_proposal?: string;
  worker_earnings_data?: string;
  is_complete: boolean;
  last_updated: string;
}

/**
 * OSHA Form 300/301 recording data.
 * Requirement 11.1, 11.2: OSHA recording fields.
 */
export interface OshaRecordingData {
  case_identifier: string;
  worker_name: string;
  job_title: string;
  incident_date: string;
  location_within_site: string;
  injury_illness_description: string;
  case_outcome: OshaCaseOutcome;
  days_away_from_work: number;
  days_restricted_work: number;
  is_complete: boolean;
  last_updated: string;
}

/**
 * Input for the regulatory evaluation engine.
 * Requirement 6.1: Regulatory evaluation input.
 */
export interface RegulatoryEvaluationInput {
  indicators: RegulatoryIndicators;
  jurisdiction: string;
  incident_datetime: string;
}

/**
 * Result from the regulatory evaluation engine.
 * Requirement 6.1: Regulatory evaluation output.
 */
export interface RegulatoryEvaluationResult {
  regulatory_flag: RegulatoryFlag;
  suggestions: RegulatorySuggestion[];
  deadlines: RegulatoryDeadline[];
  applied_rules: string[];
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
  absolute_deadline: string; // ISO 8601 computed datetime
  description: string;
}


// ─── Linked Documents Types ───────────────────────────────────────────────────

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
 * Input payload for creating a linked document record.
 * Requirement 1.2: Fields required to establish a link between an incident and a form response.
 */
export interface LinkedDocumentInput {
  incident_id: string;
  tenant_id: string;
  response_id: string;
  form_id: string;
  document_category: DocumentCategory;
  custom_category_description?: string;
  context_note?: string;
  linked_by: string;
  linked_by_name: string;
}

/**
 * Full linked document record stored in DynamoDB (IncidentLinkedDocuments table).
 * Extends input with system-generated fields and denormalized form response data.
 * Requirements: 1.2, 5.2, 5.3, 5.4
 */
export interface LinkedDocumentRecord extends LinkedDocumentInput {
  link_id: string;
  linked_at: string;                // ISO 8601 UTC
  unlinked_at?: string;             // ISO 8601 UTC (soft delete)
  unlinked_by?: string;
  unlinked_by_name?: string;
  unlink_justification?: string;
  // Denormalized fields from form response for display without join
  form_name: string;
  folio: string;
  response_submitted_at: string;
  response_submitted_by: string;
}

/**
 * A form response available to be linked to an incident.
 * Requirement 6.1, 6.3: Search result item for linkable responses.
 */
export interface LinkableResponseResult {
  response_id: string;
  form_id: string;
  form_name: string;
  folio: string;
  submitted_at: string;
  submitted_by_name: string;
}

/**
 * Response for GET /incidents/{id}/linked-documents endpoint.
 * Requirements: 3.1, 4.4
 */
export interface LinkedDocumentsResponse {
  linked_documents: LinkedDocumentRecord[];
  total_count: number;
}

/**
 * Response for GET /incidents/{id}/linkable-responses endpoint.
 * Requirements: 6.1, 6.4
 */
export interface LinkableResponsesResponse {
  responses: LinkableResponseResult[];
  total_count: number;
  page: number;
  page_size: number;
}
