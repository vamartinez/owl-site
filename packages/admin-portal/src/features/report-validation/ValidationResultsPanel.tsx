import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle, Info, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ComplianceScoreBadge } from './ComplianceScoreBadge';
import { groupFindingsBySeverity } from './utils';
import type { ValidationResult, FindingSeverity } from './types';

const AI_DISCLAIMER_TEXT =
  'This AI-generated compliance analysis is provided as advisory support only. It does not constitute legal advice or guarantee regulatory compliance. Always consult with qualified professionals for final compliance determinations.';

const LOADING_TIMEOUT_MS = 10_000;

interface ValidationResultsPanelProps {
  validationResult: ValidationResult | undefined;
  isLoading?: boolean;
  onRetry?: () => void;
}

const severityConfig: Record<FindingSeverity, { label: string; variant: 'danger' | 'warning' | 'info' | 'default' }> = {
  critical: { label: 'Critical', variant: 'danger' },
  major: { label: 'Major', variant: 'warning' },
  minor: { label: 'Minor', variant: 'info' },
  informational: { label: 'Informational', variant: 'default' },
};

export function ValidationResultsPanel({
  validationResult,
  isLoading = false,
  onRetry,
}: ValidationResultsPanelProps) {
  const [hasTimedOut, setHasTimedOut] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setHasTimedOut(false);
      return;
    }

    const timer = setTimeout(() => {
      setHasTimedOut(true);
    }, LOADING_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [isLoading]);

  const handleRetry = useCallback(() => {
    setHasTimedOut(false);
    onRetry?.();
  }, [onRetry]);

  if (isLoading && hasTimedOut) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4">
            <AlertTriangle className="text-red-500" size={24} />
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Results could not be loaded. Please try again.
          </p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={handleRetry}>
              <RefreshCw size={14} />
              Retry
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 text-primary-500 animate-spin mb-4" />
          <p className="text-sm text-gray-500">Loading validation results...</p>
        </CardContent>
      </Card>
    );
  }

  if (!validationResult) {
    return null;
  }

  const { findings, score, summary } = validationResult;
  const hasFindings = findings.length > 0;
  const groupedFindings = groupFindingsBySeverity(findings);

  // Zero findings state
  if (!hasFindings) {
    return (
      <Card>
        <CardHeader title="Validation Results" />
        <CardContent>
          <div className="flex flex-col items-center py-8">
            <div className="flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
              <CheckCircle className="text-green-600" size={24} />
            </div>
            <ComplianceScoreBadge score={100} className="mb-3" />
            <p className="text-sm text-gray-600 text-center">
              No compliance issues were identified. Your report meets all checked requirements.
            </p>
          </div>

          <Disclaimer />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Validation Results"
        action={<ComplianceScoreBadge score={score} />}
      />
      <CardContent>
        {/* Assessment summary */}
        {summary && (
          <div className="mb-6">
            <p className="text-sm text-gray-700 leading-relaxed">
              {summary.slice(0, 1000)}
            </p>
          </div>
        )}

        {/* Severity counts summary */}
        <div className="flex flex-wrap gap-2 mb-6">
          {groupedFindings.map(({ severity, findings: severityFindings }) => {
            const config = severityConfig[severity];
            return (
              <Badge key={severity} variant={config.variant}>
                {config.label}: {severityFindings.length}
              </Badge>
            );
          })}
        </div>

        {/* Findings grouped by severity */}
        <div className="space-y-6">
          {groupedFindings.map(({ severity, findings: severityFindings }) => {
            const config = severityConfig[severity];
            return (
              <div key={severity}>
                <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
                  <SeverityIcon severity={severity} />
                  {config.label} ({severityFindings.length})
                </h4>
                <div className="space-y-2">
                  {severityFindings.map((finding) => (
                    <div
                      key={finding.finding_id}
                      className="p-3 rounded-md border border-gray-200 bg-gray-50"
                    >
                      <p className="text-sm text-gray-800">{finding.description}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Section: {finding.report_section}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <Disclaimer />
      </CardContent>
    </Card>
  );
}

function Disclaimer() {
  return (
    <div className="mt-6 pt-4 border-t border-gray-100">
      <div className="flex items-start gap-2">
        <Info className="text-gray-400 shrink-0 mt-0.5" size={14} />
        <p className="text-xs text-gray-500 leading-relaxed">
          {AI_DISCLAIMER_TEXT}
        </p>
      </div>
    </div>
  );
}

function SeverityIcon({ severity }: { severity: FindingSeverity }) {
  switch (severity) {
    case 'critical':
      return <AlertTriangle className="text-red-500" size={14} />;
    case 'major':
      return <AlertTriangle className="text-yellow-600" size={14} />;
    case 'minor':
      return <Info className="text-blue-500" size={14} />;
    case 'informational':
      return <Info className="text-gray-400" size={14} />;
  }
}
