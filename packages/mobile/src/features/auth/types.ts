/**
 * Auth domain types — mirror the admin-portal contract so the two clients
 * stay in lockstep. Roles come from `cognito:groups`; tenant + assigned sites
 * come from custom claims in the id token.
 */

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  /** Unix timestamp in ms. */
  expiresAt: number;
}

export type UserRole =
  | 'platform_admin'
  | 'tenant_admin'
  | 'site_admin'
  | 'supervisor'
  | 'cso'
  | 'gate_operator'
  | 'worker';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string;
  assignedSites: string[];
}
