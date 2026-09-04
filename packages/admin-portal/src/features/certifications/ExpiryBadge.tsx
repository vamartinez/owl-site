import { Badge } from '@/components/ui/Badge';
import { classifyExpiry } from './utils/classifyExpiry';
import type { ExpiryStatus } from './types';

interface ExpiryBadgeProps {
  expiryDate: string;
}

const statusConfig: Record<ExpiryStatus, { variant: 'success' | 'warning' | 'danger'; label: string }> = {
  valid: { variant: 'success', label: 'Valid' },
  expiring: { variant: 'warning', label: 'Expiring' },
  expired: { variant: 'danger', label: 'Expired' },
};

export function ExpiryBadge({ expiryDate }: ExpiryBadgeProps) {
  const status = classifyExpiry(expiryDate);
  const { variant, label } = statusConfig[status];

  return <Badge variant={variant}>{label}</Badge>;
}
