import { getScoreColor, type ScoreColor } from './utils';

interface ComplianceScoreBadgeProps {
  score: number | undefined;
  className?: string;
}

const colorStyles: Record<ScoreColor, { bg: string; text: string; dot: string }> = {
  green: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  yellow: { bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  red: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
};

export function ComplianceScoreBadge({ score, className = '' }: ComplianceScoreBadgeProps) {
  if (score === undefined) {
    return (
      <span
        className={`
          inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
          bg-gray-50 text-gray-500
          ${className}
        `}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
        Not validated
      </span>
    );
  }

  const color = getScoreColor(score);
  const styles = colorStyles[color];

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
        ${styles.bg} ${styles.text}
        ${className}
      `}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
      {score}/100
    </span>
  );
}
