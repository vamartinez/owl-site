import { CertificationStatus } from '../types';

export type ActionButton = 'validate' | 'reject' | 're-upload';

/**
 * Determines which action buttons should be visible for a certification
 * based on its validation status and the user's RBAC permissions.
 *
 * Rules:
 * - 'pending' → "Validate" and "Reject" (only if user has certifications.validate permission)
 * - 'rejected' → "Re-upload"
 * - 'validated' or 'expired' → no action buttons
 */
export function getVisibleActions(
  status: CertificationStatus,
  hasValidatePermission: boolean
): ActionButton[] {
  switch (status) {
    case CertificationStatus.PENDING:
      return hasValidatePermission ? ['validate', 'reject'] : [];
    case CertificationStatus.REJECTED:
      return ['re-upload'];
    case CertificationStatus.VALIDATED:
    case CertificationStatus.EXPIRED:
      return [];
    default:
      return [];
  }
}
