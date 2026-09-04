/**
 * Shared response interfaces for API endpoints.
 * These define the JSON response shapes returned by handlers across
 * the Identity, Access, and Reporting services.
 */

// ─── Certification Endpoints (Identity Service) ───────────────────────────

export interface CertificationStatsResponse {
  totalActive: number;
  pendingValidation: number;
  expiringSoon: number;
  expired: number;
  byType: Array<{ type: string; count: number }>;
}

export interface CertificationCatalogResponse {
  certTypes: Array<{
    id: string;
    name: string;
    category: string;
    issuingAuthority: string;
    validityMonths: number;
    isRequired: boolean;
    activeCount: number;
  }>;
  total: number;
}

export interface ExpiringCertificationsResponse {
  certifications: Array<{
    id: string;
    workerName: string;
    workerId: string;
    certType: string;
    expiryDate: string;
    daysRemaining: number;
    site: string;
  }>;
  total: number;
}

export interface PendingCertificationsResponse {
  certifications: Array<{
    id: string;
    workerName: string;
    certType: string;
    uploadedAt: string;
    documentUrl: string;
    expiryDate: string;
  }>;
  total: number;
}

// ─── Site Access Endpoints (Access Service) ───────────────────────────────

export interface LiveAccessResponse {
  workers: Array<{
    id: string;
    workerName: string;
    site: string;
    checkInTime: string;
    contractor: string;
    complianceStatus: string;
  }>;
  totalOnSite: number;
}

export interface CheckInResponse {
  decision: 'allowed' | 'conditional' | 'denied';
  workerName: string;
  reasons: string[];
  missingCerts: string[];
}

export interface RecentCheckInsResponse {
  checkIns: Array<{
    id: string;
    workerName: string;
    decision: string;
    timestamp: string;
    site: string;
  }>;
}

export interface AccessRulesResponse {
  rules: Array<{
    id: string;
    name: string;
    site: string;
    requiredCerts: string[];
    enforcementLevel: string;
    isActive: boolean;
    createdAt: string;
  }>;
  total: number;
}

export interface RejectionsResponse {
  rejections: Array<{
    id: string;
    workerName: string;
    site: string;
    reason: string;
    timestamp: string;
    missingRequirements: string[];
  }>;
  total: number;
}

export interface VisitsResponse {
  visits: Array<{
    id: string;
    workerName: string;
    site: string;
    checkInTime: string;
    checkOutTime: string | null;
    duration: string | null;
    decision: string;
  }>;
  total: number;
}

// ─── Dashboard Endpoints (Reporting Service) ──────────────────────────────

export interface DashboardKpisResponse {
  totalActiveWorkers: number;
  siteCompliancePercent: number;
  pendingFindings: number;
  unresolvedEnforcements: number;
  certsExpiringIn30Days: number;
  complianceTrend: Array<{ date: string; value: number }>;
}

export interface DashboardRisksResponse {
  risks: Array<{
    id: string;
    title: string;
    severity: string;
    site: string;
    createdAt: string;
  }>;
  total: number;
}

export interface DashboardBlockedAccessResponse {
  events: Array<{
    id: string;
    workerName: string;
    site: string;
    reason: string;
    timestamp: string;
  }>;
  total: number;
}

export interface DashboardExpiringCertsResponse {
  certifications: Array<{
    id: string;
    workerName: string;
    certType: string;
    expiryDate: string;
    daysRemaining: number;
  }>;
  total: number;
}

// ─── Report Endpoints (Reporting Service) ─────────────────────────────────

export interface ComplianceSummaryResponse {
  overallPercent: number;
  totalSites: number;
  compliantSites: number;
  nonCompliantWorkers: number;
  trend: Array<{ date: string; value: number }>;
  bySite: Array<{ site: string; percent: number }>;
}

export interface SiteAccessLogsResponse {
  logs: Array<{
    id: string;
    workerName: string;
    site: string;
    decision: string;
    timestamp: string;
    method: string;
    operator: string;
  }>;
  total: number;
}
