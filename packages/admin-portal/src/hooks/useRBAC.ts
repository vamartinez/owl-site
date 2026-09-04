import { useMemo } from 'react';
import { useAuthStore, type UserRole } from '@/store/auth-store';

/**
 * Permission matrix for role-based access control.
 * Maps each role to the set of permissions it has.
 */
const ROLE_PERMISSIONS: Record<UserRole, Set<string>> = {
  platform_admin: new Set([
    'dashboard.view',
    'workers.view', 'workers.create', 'workers.edit', 'workers.delete',
    'certifications.view', 'certifications.validate',
    'sites.view', 'sites.create', 'sites.edit', 'sites.delete',
    'site_access.view', 'site_access.manage',
    'contractors.view', 'contractors.create', 'contractors.edit',
    'safety_ai.view', 'safety_ai.review', 'safety_ai.upload',
    'reports.view', 'reports.export',
    'report_validation.view',
    'documents.view',
    'admin.view', 'admin.users', 'admin.roles', 'admin.config',
    'forms.view', 'forms.create', 'forms.edit', 'forms.publish', 'forms.responses', 'forms.export',
    'incidents.view', 'incidents.create', 'incidents.regulatory', 'incidents.export',
  ]),
  tenant_admin: new Set([
    'dashboard.view',
    'workers.view', 'workers.create', 'workers.edit',
    'certifications.view', 'certifications.validate',
    'sites.view', 'sites.create', 'sites.edit',
    'site_access.view', 'site_access.manage',
    'contractors.view', 'contractors.create', 'contractors.edit',
    'safety_ai.view', 'safety_ai.review', 'safety_ai.upload',
    'reports.view', 'reports.export',
    'report_validation.view', 'kb.manage',
    'documents.view',
    'admin.view', 'admin.users', 'admin.roles',
    'forms.view', 'forms.create', 'forms.edit', 'forms.publish', 'forms.responses', 'forms.export',
    'incidents.view', 'incidents.create', 'incidents.regulatory', 'incidents.export',
  ]),
  site_admin: new Set([
    'dashboard.view',
    'workers.view', 'workers.create', 'workers.edit',
    'certifications.view', 'certifications.validate',
    'sites.view', 'sites.edit',
    'site_access.view', 'site_access.manage',
    'contractors.view', 'contractors.edit',
    'safety_ai.view', 'safety_ai.review', 'safety_ai.upload',
    'reports.view', 'reports.export',
    'report_validation.view',
    'documents.view',
    'forms.view', 'forms.create', 'forms.edit', 'forms.publish', 'forms.responses', 'forms.export',
    'incidents.view', 'incidents.create',
  ]),
  supervisor: new Set([
    'dashboard.view',
    'workers.view',
    'certifications.view',
    'sites.view',
    'site_access.view',
    'contractors.view',
    'safety_ai.view', 'safety_ai.review', 'safety_ai.upload',
    'reports.view',
    'report_validation.view',
    'documents.view',
    'forms.view', 'forms.responses',
    'incidents.view', 'incidents.create', 'incidents.export',
  ]),
  cso: new Set([
    'dashboard.view',
    'workers.view',
    'certifications.view',
    'sites.view',
    'site_access.view',
    'safety_ai.view', 'safety_ai.review', 'safety_ai.upload',
    'reports.view', 'reports.export',
    'report_validation.view',
    'documents.view',
    'forms.view', 'forms.responses',
    'incidents.view', 'incidents.create', 'incidents.regulatory', 'incidents.export',
  ]),
  gate_operator: new Set([
    'dashboard.view',
    'workers.view',
    'site_access.view', 'site_access.manage',
  ]),
  worker: new Set([
    'dashboard.view',
  ]),
};

/**
 * Navigation items with required permissions for visibility.
 */
export interface NavItem {
  label: string;
  path: string;
  icon: string;
  permission: string;
  children?: NavItem[];
}

export const NAVIGATION_TREE: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: 'LayoutDashboard', permission: 'dashboard.view' },
  { label: 'Workers', path: '/workers', icon: 'Users', permission: 'workers.view' },
  { label: 'Certifications', path: '/certifications', icon: 'Award', permission: 'certifications.view' },
  { label: 'Sites', path: '/sites', icon: 'Building2', permission: 'sites.view' },
  { label: 'Site Access', path: '/site-access', icon: 'ScanLine', permission: 'site_access.view' },
  { label: 'Contractors', path: '/contractors', icon: 'Briefcase', permission: 'contractors.view' },
  { label: 'Forms', path: '/forms', icon: 'ClipboardList', permission: 'forms.view' },
  { label: 'Safety AI', path: '/safety-ai', icon: 'ShieldAlert', permission: 'safety_ai.view' },
  { label: 'Incidents', path: '/incidents', icon: 'AlertTriangle', permission: 'incidents.view' },
  { label: 'Documents', path: '/documents', icon: 'FolderOpen', permission: 'documents.view' },
  { label: 'Reports', path: '/reports', icon: 'FileBarChart', permission: 'report_validation.view' },
  { label: 'Knowledge Base', path: '/knowledge-base', icon: 'BookOpen', permission: 'kb.manage' },
  { label: 'Administration', path: '/admin', icon: 'Settings', permission: 'admin.view' },
];

/**
 * Role-based access control hook.
 * Provides permission checking and filtered navigation.
 */
export function useRBAC() {
  const role = useAuthStore((s) => s.role);

  const permissions = useMemo(() => {
    if (!role) return new Set<string>();
    return ROLE_PERMISSIONS[role] || new Set<string>();
  }, [role]);

  const hasPermission = (permission: string): boolean => {
    return permissions.has(permission);
  };

  const hasAnyPermission = (perms: string[]): boolean => {
    return perms.some((p) => permissions.has(p));
  };

  const hasAllPermissions = (perms: string[]): boolean => {
    return perms.every((p) => permissions.has(p));
  };

  const visibleNavItems = useMemo(() => {
    return NAVIGATION_TREE.filter((item) => hasPermission(item.permission));
  }, [permissions]);

  return {
    role,
    permissions,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    visibleNavItems,
  };
}
