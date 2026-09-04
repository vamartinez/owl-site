/**
 * Incident Reporting constants for frontend use.
 * Allowed evidence types, size limits, and display labels.
 *
 * Requirements: 2.1, 3.1, 5.1, 12.1
 */

import {
  IncidentType,
  IncidentStatus,
  OperationalSeverity,
  RegulatoryFlag,
  ExternalReportStatus,
  InvolvementType,
  OshaRecordability,
} from './types';

// ─── Evidence Upload Constraints ─────────────────────────────────────────────

/**
 * Allowed MIME types for evidence attachments.
 * Requirement 12.1: Accepted file types.
 */
export const ALLOWED_EVIDENCE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'video/mp4',
  'video/quicktime',
  'application/pdf',
] as const;

/**
 * Maximum file size in bytes (50 MB).
 * Requirement 12.2: Size limit.
 */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Maximum video duration in seconds (60 seconds).
 * Requirement 12.3: Duration limit.
 */
export const MAX_VIDEO_DURATION_SECONDS = 60;

/**
 * Video MIME types (subset of ALLOWED_EVIDENCE_TYPES).
 */
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime'] as const;

// ─── State Transition Labels ─────────────────────────────────────────────────

/**
 * Human-readable labels for state transitions.
 * Used in StateTransitionButton and status displays.
 * Requirement 5.1: Supported incident states.
 */
export const STATUS_LABELS: Record<IncidentStatus, string> = {
  [IncidentStatus.OPEN]: 'Open',
  [IncidentStatus.UNDER_REVIEW]: 'Under Review',
  [IncidentStatus.REGULATORY_REVIEW]: 'Regulatory Review',
  [IncidentStatus.ACTION_REQUIRED]: 'Action Required',
  [IncidentStatus.RESOLVED]: 'Resolved',
  [IncidentStatus.CLOSED]: 'Closed',
};

/**
 * Valid state transitions map (mirrors backend state-machine).
 * Requirement 5.2: Allowed state transitions.
 */
export const VALID_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  [IncidentStatus.OPEN]: [IncidentStatus.UNDER_REVIEW, IncidentStatus.REGULATORY_REVIEW],
  [IncidentStatus.UNDER_REVIEW]: [IncidentStatus.ACTION_REQUIRED, IncidentStatus.RESOLVED],
  [IncidentStatus.REGULATORY_REVIEW]: [IncidentStatus.ACTION_REQUIRED, IncidentStatus.RESOLVED],
  [IncidentStatus.ACTION_REQUIRED]: [IncidentStatus.RESOLVED],
  [IncidentStatus.RESOLVED]: [IncidentStatus.CLOSED],
  [IncidentStatus.CLOSED]: [IncidentStatus.OPEN],
};

/**
 * Labels for transition actions (button text).
 */
export const TRANSITION_ACTION_LABELS: Record<IncidentStatus, string> = {
  [IncidentStatus.OPEN]: 'Reopen',
  [IncidentStatus.UNDER_REVIEW]: 'Start Review',
  [IncidentStatus.REGULATORY_REVIEW]: 'Start Regulatory Review',
  [IncidentStatus.ACTION_REQUIRED]: 'Require Action',
  [IncidentStatus.RESOLVED]: 'Mark Resolved',
  [IncidentStatus.CLOSED]: 'Close Incident',
};

// ─── Incident Type Labels ────────────────────────────────────────────────────

/**
 * Human-readable labels for incident types.
 * Requirement 2.1: Supported incident types.
 */
export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  [IncidentType.INJURY]: 'Injury',
  [IncidentType.ILLNESS]: 'Illness',
  [IncidentType.NEAR_MISS]: 'Near Miss',
  [IncidentType.UNSAFE_CONDITION]: 'Unsafe Condition',
  [IncidentType.PROPERTY_DAMAGE]: 'Property Damage',
  [IncidentType.ENVIRONMENTAL]: 'Environmental Incident',
  [IncidentType.FIRE_EXPLOSION]: 'Fire/Explosion',
  [IncidentType.STRUCTURAL_FAILURE]: 'Structural Failure/Collapse',
  [IncidentType.HAZARDOUS_SUBSTANCE]: 'Hazardous Substance Release',
  [IncidentType.REGULATORY_NON_COMPLIANCE]: 'Regulatory Non-Compliance',
  [IncidentType.OTHER]: 'Other',
};

// ─── Severity Labels ─────────────────────────────────────────────────────────

/**
 * Human-readable labels for operational severity levels.
 */
export const SEVERITY_LABELS: Record<OperationalSeverity, string> = {
  [OperationalSeverity.LOW]: 'Low',
  [OperationalSeverity.MEDIUM]: 'Medium',
  [OperationalSeverity.HIGH]: 'High',
  [OperationalSeverity.CRITICAL]: 'Critical',
};

// ─── Regulatory Flag Labels ──────────────────────────────────────────────────

/**
 * Human-readable labels for regulatory flag values.
 */
export const REGULATORY_FLAG_LABELS: Record<RegulatoryFlag, string> = {
  [RegulatoryFlag.INTERNAL_ONLY]: 'Internal Only',
  [RegulatoryFlag.POTENTIALLY_REPORTABLE]: 'Potentially Reportable',
  [RegulatoryFlag.IMMEDIATELY_REPORTABLE]: 'Immediately Reportable',
};

// ─── External Report Status Labels ───────────────────────────────────────────

/**
 * Human-readable labels for external report status values.
 */
export const EXTERNAL_REPORT_STATUS_LABELS: Record<ExternalReportStatus, string> = {
  [ExternalReportStatus.NOT_REPORTABLE]: 'Not Reportable',
  [ExternalReportStatus.POTENTIALLY_REPORTABLE]: 'Potentially Reportable',
  [ExternalReportStatus.REPORTED_WORKSAFEBC]: 'Reported to WorkSafeBC',
  [ExternalReportStatus.REPORTED_OSHA]: 'Reported to OSHA',
  [ExternalReportStatus.EXTERNAL_REPORT_PENDING]: 'External Report Pending',
  [ExternalReportStatus.EXTERNAL_REPORT_NOT_APPLICABLE]: 'Not Applicable',
};

// ─── Involvement Type Labels ─────────────────────────────────────────────────

/**
 * Human-readable labels for involvement types.
 */
export const INVOLVEMENT_TYPE_LABELS: Record<InvolvementType, string> = {
  [InvolvementType.INJURED_WORKER]: 'Injured/Affected Worker',
  [InvolvementType.WITNESS]: 'Witness',
  [InvolvementType.SUPERVISOR_PRESENT]: 'Supervisor Present',
  [InvolvementType.ASSOCIATED_CONTRACTOR]: 'Associated Contractor',
};

// ─── OSHA Recordability Labels ───────────────────────────────────────────────

/**
 * Human-readable labels for OSHA recordability classifications.
 */
export const OSHA_RECORDABILITY_LABELS: Record<OshaRecordability, string> = {
  [OshaRecordability.FIRST_AID_ONLY]: 'First Aid Only (Not Recordable)',
  [OshaRecordability.MEDICAL_TREATMENT]: 'Medical Treatment',
  [OshaRecordability.DAYS_AWAY]: 'Days Away from Work',
  [OshaRecordability.RESTRICTED_WORK]: 'Restricted Work',
  [OshaRecordability.JOB_TRANSFER]: 'Job Transfer',
  [OshaRecordability.FATALITY]: 'Fatality',
};

// ─── Regulatory Indicator Labels ─────────────────────────────────────────────

/**
 * Human-readable labels for regulatory indicator checkboxes.
 */
export const REGULATORY_INDICATOR_LABELS: Record<string, string> = {
  medical_treatment_beyond_first_aid: 'Medical treatment beyond first aid',
  lost_time: 'Lost time',
  hospitalization: 'Hospitalization',
  fatality: 'Fatality',
  amputation: 'Amputation',
  loss_of_eye: 'Loss of eye',
  structural_collapse: 'Structural collapse',
  hazardous_substance_release: 'Hazardous substance release',
  fire_or_explosion: 'Fire or explosion',
};

// ─── File Type Display Labels ────────────────────────────────────────────────

/**
 * Human-readable labels for allowed evidence file types.
 */
export const FILE_TYPE_LABELS: Record<string, string> = {
  'image/jpeg': 'JPEG Image',
  'image/png': 'PNG Image',
  'image/heic': 'HEIC Image',
  'video/mp4': 'MP4 Video',
  'video/quicktime': 'MOV Video',
  'application/pdf': 'PDF Document',
};
