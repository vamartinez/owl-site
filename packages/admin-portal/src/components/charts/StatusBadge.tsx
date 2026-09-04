type StatusType = 'allowed' | 'conditional' | 'denied' | 'review' | 'critical' | 'high' | 'medium' | 'low';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
}

const statusStyles: Record<StatusType, { bg: string; text: string; dot: string }> = {
  allowed: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  conditional: { bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  denied: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  review: { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
  critical: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-600' },
  high: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  medium: { bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  low: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
};

const defaultLabels: Record<StatusType, string> = {
  allowed: 'Allowed',
  conditional: 'Conditional',
  denied: 'Denied',
  review: 'Review Required',
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const styles = statusStyles[status];
  const displayLabel = label || defaultLabels[status];

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
        ${styles.bg} ${styles.text}
      `}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
      {displayLabel}
    </span>
  );
}
