/**
 * Role-based access control enforcement with permission matrix.
 * Defines what each role can do and provides enforcement helpers.
 */

import { Role } from './types/common.js';
import { forbidden } from './error-handler.js';
import type { ApiGatewayResponse } from './error-handler.js';
import type { AuthenticatedUser } from './auth-middleware.js';

export type Permission =
  | 'workers:create'
  | 'workers:read'
  | 'workers:update'
  | 'workers:delete'
  | 'workers:read_own'
  | 'certifications:upload'
  | 'certifications:validate'
  | 'certifications:read'
  | 'sites:create'
  | 'sites:read'
  | 'sites:update'
  | 'sites:delete'
  | 'policies:create'
  | 'policies:read'
  | 'policies:update'
  | 'policies:publish'
  | 'access:request'
  | 'access:scan'
  | 'access:override'
  | 'access:read_decisions'
  | 'access:manage_checkin_token'
  | 'access:send_checkin_link'
  | 'inspections:create'
  | 'inspections:read'
  | 'inspections:upload_media'
  | 'findings:read'
  | 'findings:review'
  | 'enforcement:read'
  | 'enforcement:manage'
  | 'reports:read'
  | 'reports:generate'
  | 'reports:export'
  | 'reports:upload'
  | 'contractors:create'
  | 'contractors:read'
  | 'contractors:update'
  | 'contractors:delete'
  | 'forms:create'
  | 'forms:read'
  | 'forms:update'
  | 'forms:publish'
  | 'forms:read_responses'
  | 'forms:export'
  | 'users:manage'
  | 'tenant:configure'
  | 'kb:manage'
  | 'worksafebc:upload'
  | 'audit:read';

/**
 * Permission matrix defining which roles have which permissions.
 */
const PERMISSION_MATRIX: Record<Role, Permission[]> = {
  [Role.PLATFORM_ADMIN]: [
    'workers:create', 'workers:read', 'workers:update', 'workers:delete',
    'certifications:upload', 'certifications:validate', 'certifications:read',
    'sites:create', 'sites:read', 'sites:update', 'sites:delete',
    'policies:create', 'policies:read', 'policies:update', 'policies:publish',
    'access:request', 'access:scan', 'access:override', 'access:read_decisions',
    'access:manage_checkin_token', 'access:send_checkin_link',
    'inspections:create', 'inspections:read', 'inspections:upload_media',
    'findings:read', 'findings:review',
    'enforcement:read', 'enforcement:manage',
    'reports:read', 'reports:generate', 'reports:export', 'reports:upload',
    'contractors:create', 'contractors:read', 'contractors:update', 'contractors:delete',
    'forms:create', 'forms:read', 'forms:update', 'forms:publish', 'forms:read_responses', 'forms:export',
    'users:manage', 'tenant:configure', 'kb:manage', 'worksafebc:upload', 'audit:read',
  ],
  [Role.TENANT_ADMIN]: [
    'workers:create', 'workers:read', 'workers:update', 'workers:delete',
    'certifications:upload', 'certifications:validate', 'certifications:read',
    'sites:create', 'sites:read', 'sites:update', 'sites:delete',
    'policies:create', 'policies:read', 'policies:update', 'policies:publish',
    'access:read_decisions', 'access:override',
    'access:manage_checkin_token', 'access:send_checkin_link',
    'inspections:create', 'inspections:read', 'inspections:upload_media',
    'findings:read', 'findings:review',
    'enforcement:read', 'enforcement:manage',
    'reports:read', 'reports:generate', 'reports:export', 'reports:upload',
    'contractors:create', 'contractors:read', 'contractors:update', 'contractors:delete',
    'forms:create', 'forms:read', 'forms:update', 'forms:publish', 'forms:read_responses', 'forms:export',
    'users:manage', 'tenant:configure', 'kb:manage', 'worksafebc:upload', 'audit:read',
  ],
  [Role.SITE_ADMIN]: [
    'workers:create', 'workers:read', 'workers:update',
    'certifications:upload', 'certifications:validate', 'certifications:read',
    'sites:read', 'sites:update',
    'policies:read', 'policies:update', 'policies:publish',
    'access:read_decisions', 'access:override',
    'access:manage_checkin_token', 'access:send_checkin_link',
    'inspections:create', 'inspections:read', 'inspections:upload_media',
    'findings:read', 'findings:review',
    'enforcement:read', 'enforcement:manage',
    'reports:read', 'reports:generate', 'reports:export', 'reports:upload',
    'contractors:read', 'contractors:update',
    'forms:create', 'forms:read', 'forms:update', 'forms:publish', 'forms:read_responses', 'forms:export',
    'worksafebc:upload',
    'audit:read',
  ],
  [Role.SUPERVISOR]: [
    'workers:read',
    'certifications:read',
    'sites:read',
    'policies:read',
    'access:read_decisions',
    'inspections:create', 'inspections:read', 'inspections:upload_media',
    'findings:read', 'findings:review',
    'enforcement:read',
    'reports:read', 'reports:upload',
    'contractors:read',
    'forms:read', 'forms:read_responses',
    'worksafebc:upload',
  ],
  [Role.CSO]: [
    'workers:read',
    'certifications:read',
    'sites:read',
    'policies:read',
    'access:read_decisions', 'access:override',
    'inspections:create', 'inspections:read', 'inspections:upload_media',
    'findings:read', 'findings:review',
    'enforcement:read', 'enforcement:manage',
    'reports:read', 'reports:generate', 'reports:export', 'reports:upload',
    'contractors:read',
    'forms:read', 'forms:read_responses',
    'worksafebc:upload',
    'audit:read',
  ],
  [Role.GATE_OPERATOR]: [
    'workers:read',
    'certifications:read',
    'sites:read',
    'access:request', 'access:scan', 'access:read_decisions',
    'enforcement:read',
  ],
  [Role.WORKER]: [
    'workers:read_own',
    'certifications:upload', 'certifications:read',
    'access:request',
  ],
};

/**
 * Checks if a role has a specific permission.
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = PERMISSION_MATRIX[role];
  return permissions.includes(permission);
}

/**
 * Checks if a role has all of the specified permissions.
 */
export function hasAllPermissions(role: Role, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

/**
 * Checks if a role has any of the specified permissions.
 */
export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

/**
 * Enforces that the authenticated user has the required permission.
 * Returns null if authorized, or an error response if not.
 */
export function enforcePermission(
  user: AuthenticatedUser,
  permission: Permission
): ApiGatewayResponse | null {
  if (!hasPermission(user.role, permission)) {
    return forbidden('You do not have permission to perform this action');
  }
  return null;
}

/**
 * Enforces that the authenticated user has all required permissions.
 * Returns null if authorized, or an error response if not.
 */
export function enforceAllPermissions(
  user: AuthenticatedUser,
  permissions: Permission[]
): ApiGatewayResponse | null {
  if (!hasAllPermissions(user.role, permissions)) {
    return forbidden('You do not have permission to perform this action');
  }
  return null;
}

/**
 * Enforces tenant isolation — ensures the user belongs to the requested tenant.
 * Returns null if the tenant matches, or a 403 response if not.
 * Does not reveal the existence of the other tenant's resource.
 */
export function enforceTenantIsolation(
  user: AuthenticatedUser,
  resourceTenantId: string
): ApiGatewayResponse | null {
  // Platform admins can access any tenant
  if (user.role === Role.PLATFORM_ADMIN) {
    return null;
  }
  if (user.tenant_id !== resourceTenantId) {
    return forbidden('Access denied');
  }
  return null;
}

/**
 * Returns all permissions for a given role.
 */
export function getPermissionsForRole(role: Role): Permission[] {
  return [...PERMISSION_MATRIX[role]];
}

/**
 * Checks if a role has permission to upload reports and request validation.
 * Allowed roles: tenant_admin, site_admin, supervisor, cso.
 */
export function canUploadReports(role: Role): boolean {
  return hasPermission(role, 'reports:upload');
}

/**
 * Checks if a role has permission to manage Knowledge Base context documents.
 * Allowed roles: tenant_admin only.
 */
export function canManageKB(role: Role): boolean {
  return hasPermission(role, 'kb:manage');
}

/**
 * Checks if the requesting user is the owner of the report.
 * Used for submission authorization — only the report owner can submit.
 */
export function isReportOwner(userId: string, reportOwnerId: string): boolean {
  return userId === reportOwnerId;
}
