import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

// Lazy-loaded page components
// Dashboard
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));

// Workers
const WorkerDirectory = lazy(() => import('@/pages/workers/WorkerDirectory'));
const WorkerProfile = lazy(() => import('@/pages/workers/WorkerProfile'));
const WorkerOnboarding = lazy(() => import('@/pages/workers/WorkerOnboarding'));
const BulkImport = lazy(() => import('@/pages/workers/BulkImport'));

// Certifications
const CertOverview = lazy(() => import('@/pages/certifications/CertOverview'));
const CertCatalog = lazy(() => import('@/pages/certifications/CertCatalog'));
const PendingValidations = lazy(() => import('@/pages/certifications/PendingValidations'));
const ExpiringSoon = lazy(() => import('@/pages/certifications/ExpiringSoon'));

// Sites
const SiteList = lazy(() => import('@/pages/sites/SiteList'));
const SiteProfile = lazy(() => import('@/pages/sites/SiteProfile'));
const SiteConfig = lazy(() => import('@/pages/sites/SiteConfig'));

// Site Access
const CheckIn = lazy(() => import('@/pages/site-access/CheckIn'));
const LiveAccess = lazy(() => import('@/pages/site-access/LiveAccess'));
const Rejections = lazy(() => import('@/pages/site-access/Rejections'));
const AccessRules = lazy(() => import('@/pages/site-access/AccessRules'));
const VisitLog = lazy(() => import('@/pages/site-access/VisitLog'));

// Contractors
const ContractorList = lazy(() => import('@/pages/contractors/ContractorList'));
const ContractorProfile = lazy(() => import('@/pages/contractors/ContractorProfile'));
const ComplianceRisks = lazy(() => import('@/pages/contractors/ComplianceRisks'));

// Safety AI
const Findings = lazy(() => import('@/pages/safety-ai/Findings'));
const UploadEvidence = lazy(() => import('@/pages/safety-ai/UploadEvidence'));
const PendingReview = lazy(() => import('@/pages/safety-ai/PendingReview'));
const ViolationsByRule = lazy(() => import('@/pages/safety-ai/ViolationsByRule'));
const CorrectiveActions = lazy(() => import('@/pages/safety-ai/CorrectiveActions'));
const PdfReports = lazy(() => import('@/pages/safety-ai/PdfReports'));

// Reports
const ComplianceSummary = lazy(() => import('@/pages/reports/ComplianceSummary'));
const WorkerStatus = lazy(() => import('@/pages/reports/WorkerStatus'));
const SiteAccessLogs = lazy(() => import('@/pages/reports/SiteAccessLogs'));
const SafetyFindings = lazy(() => import('@/pages/reports/SafetyFindings'));
const AuditExport = lazy(() => import('@/pages/reports/AuditExport'));

// Report Validation
const ReportListPage = lazy(() => import('@/features/report-validation/ReportListPage'));
const ReportDetailPage = lazy(() => import('@/features/report-validation/ReportDetailPage'));
const KnowledgeBaseManager = lazy(() => import('@/features/report-validation/KnowledgeBaseManager'));

// Documents
const DocumentExplorerPage = lazy(() => import('@/pages/documents/DocumentExplorerPage'));

// Forms
const FormListPage = lazy(() => import('@/pages/forms/FormListPage'));
const FormNewPage = lazy(() => import('@/pages/forms/FormNewPage'));
const FormDetailPage = lazy(() => import('@/pages/forms/FormDetailPage'));
const FormEditPage = lazy(() => import('@/pages/forms/FormEditPage'));
const FormResponsesPage = lazy(() => import('@/pages/forms/FormResponsesPage'));
const FormResponseDetailPage = lazy(() => import('@/pages/forms/FormResponseDetailPage'));

// Incidents
const IncidentListPage = lazy(() => import('@/pages/incidents/IncidentListPage'));
const IncidentCreatePage = lazy(() => import('@/pages/incidents/IncidentCreatePage'));
const IncidentDetailPage = lazy(() => import('@/pages/incidents/IncidentDetailPage'));

// Admin
const UsersRoles = lazy(() => import('@/pages/admin/UsersRoles'));
const RuleCatalog = lazy(() => import('@/pages/admin/RuleCatalog'));
const SiteRequirements = lazy(() => import('@/pages/admin/SiteRequirements'));
const Integrations = lazy(() => import('@/pages/admin/Integrations'));
const TenantConfig = lazy(() => import('@/pages/admin/TenantConfig'));

// Auth
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'));

// Public forms (no auth required)
const PublicFormPage = lazy(() => import('@/features/public-form/PublicFormPage'));

// Public self check-in (no auth required)
const PublicCheckinPage = lazy(() => import('@/features/self-checkin/PublicCheckinPage'));
// WorkSafeBC PDF Compliance Agent (task 14)
const WsbSessionList = lazy(() =>
  import('@/features/worksafebc-agent').then((m) => ({ default: m.AnalysisSessionList }))
);
const WsbSessionDetail = lazy(() =>
  import('@/features/worksafebc-agent').then((m) => ({ default: m.AnalysisSessionDetail }))
);
const WsbRegulatoryKBAdmin = lazy(() =>
  import('@/features/worksafebc-agent').then((m) => ({ default: m.RegulatoryKBAdmin }))
);

// Layout
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuthStore } from '@/store/auth-store';
import { useRBAC } from '@/hooks/useRBAC';

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const location = useLocation();

  if (isLoading) {
    return <PageLoader />;
  }

  if (!isAuthenticated) {
    sessionStorage.setItem('intendedDestination', location.pathname);
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function RoleGuard({ children, permission }: { children: React.ReactNode; permission: string }) {
  const { hasPermission } = useRBAC();

  if (!hasPermission(permission)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export function AppRouter() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Auth routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        {/* Public form route (no auth, no AppLayout) */}
        <Route path="/public/forms/:token" element={<PublicFormPage />} />

        {/* Public self check-in route (no auth, no AppLayout) */}
        <Route path="/check-in/:token" element={<PublicCheckinPage />} />

        {/* Protected routes */}
        <Route element={<ProtectedRoute><ErrorBoundary><AppLayout /></ErrorBoundary></ProtectedRoute>}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />

          {/* Workers */}
          <Route path="/workers" element={<WorkerDirectory />} />
          <Route path="/workers/onboarding" element={<WorkerOnboarding />} />
          <Route path="/workers/bulk-import" element={<BulkImport />} />
          <Route path="/workers/:id" element={<WorkerProfile />} />

          {/* Certifications */}
          <Route path="/certifications" element={<CertOverview />} />
          <Route path="/certifications/catalog" element={<CertCatalog />} />
          <Route path="/certifications/pending" element={<PendingValidations />} />
          <Route path="/certifications/expiring" element={<ExpiringSoon />} />

          {/* Sites */}
          <Route path="/sites" element={<SiteList />} />
          <Route path="/sites/:id" element={<SiteProfile />} />
          <Route path="/sites/:id/config" element={<SiteConfig />} />

          {/* Site Access */}
          <Route path="/site-access" element={<CheckIn />} />
          <Route path="/site-access/live" element={<LiveAccess />} />
          <Route path="/site-access/rejections" element={<Rejections />} />
          <Route path="/site-access/rules" element={<AccessRules />} />
          <Route path="/site-access/visits" element={<VisitLog />} />

          {/* Contractors */}
          <Route path="/contractors" element={<ContractorList />} />
          <Route path="/contractors/compliance-risks" element={<ComplianceRisks />} />
          <Route path="/contractors/:id" element={<ContractorProfile />} />

          {/* Safety AI */}
          <Route path="/safety-ai" element={<Findings />} />
          <Route path="/safety-ai/upload" element={<UploadEvidence />} />
          <Route path="/safety-ai/pending-review" element={<PendingReview />} />
          <Route path="/safety-ai/violations" element={<ViolationsByRule />} />
          <Route path="/safety-ai/corrective-actions" element={<CorrectiveActions />} />
          <Route path="/safety-ai/reports" element={<PdfReports />} />

          {/* Reports (Report Validation) */}
          <Route path="/reports" element={<RoleGuard permission="report_validation.view"><ReportListPage /></RoleGuard>} />
          <Route path="/reports/compliance-summary" element={<ComplianceSummary />} />
          <Route path="/reports/worker-status" element={<WorkerStatus />} />
          <Route path="/reports/access-logs" element={<SiteAccessLogs />} />
          <Route path="/reports/safety-findings" element={<SafetyFindings />} />
          <Route path="/reports/audit-export" element={<AuditExport />} />
          <Route path="/reports/:id" element={<RoleGuard permission="report_validation.view"><ReportDetailPage /></RoleGuard>} />

          {/* Knowledge Base */}
          <Route path="/knowledge-base" element={<RoleGuard permission="kb.manage"><KnowledgeBaseManager /></RoleGuard>} />

          {/* WorkSafeBC PDF Compliance Agent */}
          <Route path="/worksafebc" element={<WsbSessionList />} />
          <Route path="/worksafebc/regulatory-kb" element={<RoleGuard permission="kb.manage"><WsbRegulatoryKBAdmin /></RoleGuard>} />
          <Route path="/worksafebc/:id" element={<WsbSessionDetail />} />

          {/* Documents */}
          <Route path="/documents" element={<RoleGuard permission="documents.view"><DocumentExplorerPage /></RoleGuard>} />

          {/* Forms */}
          <Route path="/forms" element={<FormListPage />} />
          <Route path="/forms/new" element={<FormNewPage />} />
          <Route path="/forms/:id" element={<FormDetailPage />} />
          <Route path="/forms/:id/edit" element={<FormEditPage />} />
          <Route path="/forms/:id/responses" element={<FormResponsesPage />} />
          <Route path="/forms/:id/responses/:responseId" element={<FormResponseDetailPage />} />

          {/* Incidents */}
          <Route path="/incidents" element={<IncidentListPage />} />
          <Route path="/incidents/new" element={<IncidentCreatePage />} />
          <Route path="/incidents/:id" element={<IncidentDetailPage />} />

          {/* Admin */}
          <Route path="/admin" element={<UsersRoles />} />
          <Route path="/admin/rules" element={<RuleCatalog />} />
          <Route path="/admin/site-requirements" element={<SiteRequirements />} />
          <Route path="/admin/integrations" element={<Integrations />} />
          <Route path="/admin/tenant-config" element={<TenantConfig />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
