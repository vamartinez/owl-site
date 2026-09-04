import { useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, FileText } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import type { ComplianceFinding, FindingSeverity } from './types';

interface FindingCardProps {
  finding: ComplianceFinding;
  className?: string;
}

const severityConfig: Record<
  FindingSeverity,
  { label: string; variant: 'danger' | 'warning' | 'info' | 'default' }
> = {
  critical: { label: 'Critical', variant: 'danger' },
  major: { label: 'Major', variant: 'warning' },
  minor: { label: 'Minor', variant: 'info' },
  informational: { label: 'Info', variant: 'default' },
};

export function FindingCard({ finding, className = '' }: FindingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = severityConfig[finding.severity];

  return (
    <Card className={className}>
      <button
        type="button"
        className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={`finding-detail-${finding.finding_id}`}
      >
        <span className="mt-0.5 text-gray-400 flex-shrink-0">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={config.variant}>{config.label}</Badge>
            <span className="text-xs text-gray-500 flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {finding.report_section}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-700 line-clamp-2">{finding.description}</p>
        </div>
      </button>

      {expanded && (
        <div
          id={`finding-detail-${finding.finding_id}`}
          className="px-4 pb-4 pl-11 border-t border-gray-100"
        >
          <div className="pt-3 space-y-3">
            <div>
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Description
              </h4>
              <p className="mt-1 text-sm text-gray-700">{finding.description}</p>
            </div>

            <div>
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Suggested Correction
              </h4>
              <p className="mt-1 text-sm text-gray-700">{finding.suggested_correction}</p>
            </div>

            {finding.regulation_references.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Regulation References
                </h4>
                <ul className="mt-1 space-y-1">
                  {finding.regulation_references.map((ref, index) => (
                    <li key={index} className="text-sm">
                      {ref.url ? (
                        <a
                          href={ref.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {ref.title} — {ref.section}
                          <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        </a>
                      ) : (
                        <span className="text-gray-700">
                          {ref.title} — {ref.section}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
