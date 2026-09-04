/**
 * Shared enums and types used across all backend services.
 */

export enum DecisionResult {
  ALLOWED = 'allowed',
  CONDITIONAL = 'conditional',
  DENIED = 'denied',
  MANUAL_REVIEW_REQUIRED = 'manual_review_required',
}

export enum DecisionType {
  SITE_ACCESS = 'site_access',
  CERTIFICATION_COMPLIANCE = 'certification_compliance',
  AI_FINDING = 'ai_finding',
  CORRECTIVE_ACTION = 'corrective_action',
}

export enum CertificationType {
  WHMIS_2015 = 'whmis_2015',
  FALL_PROTECTION = 'fall_protection',
  SITE_READY_BC = 'site_ready_bc',
  FIRST_AID = 'first_aid',
}

export enum CertificationStatus {
  PENDING = 'pending',
  VALIDATED = 'validated',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

export enum Severity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export enum FindingStatus {
  GENERATED = 'generated',
  PENDING_REVIEW = 'pending_review',
  CONFIRMED = 'confirmed',
  DISMISSED = 'dismissed',
  CORRECTED = 'corrected',
}

export enum EnforcementActionType {
  DENY_ENTRY = 'deny_entry',
  NOTIFY_SUPERVISOR = 'notify_supervisor',
  REQUEST_UPDATED_CERTIFICATION = 'request_updated_certification',
  REQUIRE_MANUAL_REVIEW_AT_GATE = 'require_manual_review_at_gate',
  TRIGGER_OVERRIDE_WORKFLOW = 'trigger_override_workflow',
  CREATE_CORRECTIVE_ACTION_TASK = 'create_corrective_action_task',
  REQUIRE_RESCAN = 'require_rescan',
  ESCALATE_TO_CSO = 'escalate_to_cso',
}

export enum TokenType {
  QR_SESSION = 'qr_session',
  SMS_MAGIC_LINK = 'sms_magic_link',
  GATE_PASS = 'gate_pass',
}

export enum SceneType {
  WORK_AT_HEIGHT = 'work_at_height',
  ROOFING = 'roofing',
  EXCAVATION = 'excavation',
  FRAMING = 'framing',
  LADDER_ACCESS = 'ladder_access',
  MATERIAL_HANDLING_NEAR_EQUIPMENT = 'material_handling_near_equipment',
  UNCLASSIFIED = 'unclassified',
}

export enum LanguagePreference {
  ENGLISH = 'en',
  SPANISH = 'es',
  PUNJABI = 'pa',
}

export enum Role {
  PLATFORM_ADMIN = 'platform_admin',
  TENANT_ADMIN = 'tenant_admin',
  SITE_ADMIN = 'site_admin',
  SUPERVISOR = 'supervisor',
  CSO = 'cso',
  GATE_OPERATOR = 'gate_operator',
  WORKER = 'worker',
}

export enum DetectionCategory {
  HELMET = 'helmet',
  VEST = 'vest',
  HARNESS = 'harness',
  LADDER = 'ladder',
  SCAFFOLD = 'scaffold',
  TRENCH_EXCAVATION_EDGE = 'trench_excavation_edge',
  ROOF_EDGE = 'roof_edge',
  MACHINERY_PROXIMITY = 'machinery_proximity',
  BLOCKED_EXIT_CLUTTER = 'blocked_exit_clutter',
}

export enum OverrideStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum NotificationChannel {
  EMAIL = 'email',
  SMS = 'sms',
  PUSH = 'push',
}
