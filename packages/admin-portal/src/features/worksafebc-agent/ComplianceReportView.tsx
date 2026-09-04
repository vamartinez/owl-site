import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { useReanalyze } from './api';
import {
  type ComplianceLevel,
  type FindingSeverity,
  type FindingType,
  type ReporteCumplimiento,
} from './types';

interface Props {
  sessionId: string;
  report: ReporteCumplimiento;
  onReanalyzed?: (newSessionId: string) => void;
}

const LEVEL_LABEL: Record<ComplianceLevel, string> = {
  conforme: 'Conforme',
  parcialmente_conforme: 'Parcialmente conforme',
  no_conforme: 'No conforme',
  no_evaluable: 'No evaluable',
};
const LEVEL_COLOR: Record<ComplianceLevel, string> = {
  conforme: 'bg-green-100 text-green-800',
  parcialmente_conforme: 'bg-yellow-100 text-yellow-800',
  no_conforme: 'bg-red-100 text-red-800',
  no_evaluable: 'bg-gray-100 text-gray-700',
};
const SEV_RANK: Record<FindingSeverity, number> = { critica: 0, alta: 1, media: 2, baja: 3 };
const SEV_COLOR: Record<FindingSeverity, string> = {
  critica: 'bg-red-100 text-red-800',
  alta: 'bg-orange-100 text-orange-800',
  media: 'bg-yellow-100 text-yellow-800',
  baja: 'bg-blue-100 text-blue-800',
};

/**
 * Task 14.4 — Report view: findings with severity/type filter + sort,
 * executive summary, recommendations, and a re-analyze action.
 */
export function ComplianceReportView({ sessionId, report, onReanalyzed }: Props) {
  const [typeFilter, setTypeFilter] = useState<'all' | FindingType>('all');
  const [sevFilter, setSevFilter] = useState<'all' | FindingSeverity>('all');
  const reanalyze = useReanalyze();

  const findings = useMemo(() => {
    let f = report.findings;
    if (typeFilter !== 'all') f = f.filter((x) => x.type === typeFilter);
    if (sevFilter !== 'all') f = f.filter((x) => x.severity === sevFilter);
    return [...f].sort((a, b) => {
      const ra = a.severity ? SEV_RANK[a.severity] : 99;
      const rb = b.severity ? SEV_RANK[b.severity] : 99;
      return ra - rb;
    });
  }, [report.findings, typeFilter, sevFilter]);

  const handleReanalyze = async () => {
    const res = await reanalyze.mutateAsync({ sessionId });
    onReanalyzed?.(res.session_id);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Reporte de Cumplimiento"
          action={
            <Button variant="outline" size="sm" onClick={handleReanalyze} disabled={reanalyze.isPending}>
              {reanalyze.isPending ? 'Re-analizando…' : 'Re-analizar'}
            </Button>
          }
        />
        <CardContent className="space-y-3">
          <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${LEVEL_COLOR[report.compliance_level]}`}>
            {LEVEL_LABEL[report.compliance_level]}
          </span>
          <p className="text-sm text-gray-700">{report.executive_summary}</p>
          <p className="text-xs text-gray-400">
            Modelo: {report.ai_model_version} · KB: {report.regulatory_kb_version_id} · {new Date(report.generated_at).toLocaleString()}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title={`Hallazgos (${report.findings.length})`} />
        <CardContent className="space-y-3">
          <div className="flex gap-3">
            <Select
              label="Tipo"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'all' | FindingType)}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'brecha', label: 'Brechas' },
                { value: 'conforme', label: 'Conformes' },
              ]}
            />
            <Select
              label="Severidad"
              value={sevFilter}
              onChange={(e) => setSevFilter(e.target.value as 'all' | FindingSeverity)}
              options={[
                { value: 'all', label: 'Todas' },
                { value: 'critica', label: 'Crítica' },
                { value: 'alta', label: 'Alta' },
                { value: 'media', label: 'Media' },
                { value: 'baja', label: 'Baja' },
              ]}
            />
          </div>

          {findings.length === 0 ? (
            <p className="text-sm text-gray-500">No se identificaron brechas.</p>
          ) : (
            <ul className="space-y-2">
              {findings.map((f) => (
                <li key={f.finding_id} className="rounded-md border border-gray-100 p-3">
                  <div className="flex items-center gap-2">
                    {f.severity && (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${SEV_COLOR[f.severity]}`}>
                        {f.severity}
                      </span>
                    )}
                    <span className="text-xs text-gray-500">{f.regulatory_basis || f.regulation_part}</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-800">{f.description}</p>
                  {f.evidence_excerpt && (
                    <p className="mt-1 text-xs text-gray-500 italic">“{f.evidence_excerpt}”</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {report.recommendations.length > 0 && (
        <Card>
          <CardHeader title={`Recomendaciones (${report.recommendations.length})`} />
          <CardContent>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
              {report.recommendations.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
