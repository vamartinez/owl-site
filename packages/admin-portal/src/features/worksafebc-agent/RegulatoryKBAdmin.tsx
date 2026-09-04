import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useRegulatoryVersions, usePublishRegulatoryVersion } from './api';

/**
 * Task 14.5 — Regulatory KB admin (platform_admin). Publish a new version
 * (effective date + clauses JSON) and list published versions.
 * Clauses are entered as JSON to keep v1 simple; a structured editor is a
 * later enhancement.
 */
export function RegulatoryKBAdmin() {
  const { data } = useRegulatoryVersions();
  const publish = usePublishRegulatoryVersion();
  const [effectiveDate, setEffectiveDate] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [clausesJson, setClausesJson] = useState('[]');
  const [message, setMessage] = useState<string | null>(null);

  const handlePublish = async () => {
    setMessage(null);
    let clauses: unknown[];
    try {
      clauses = JSON.parse(clausesJson);
      if (!Array.isArray(clauses)) throw new Error();
    } catch {
      setMessage('El campo de cláusulas debe ser un arreglo JSON válido.');
      return;
    }
    try {
      await publish.mutateAsync({ effective_date: effectiveDate, change_summary: changeSummary, clauses });
      setMessage('Versión publicada.');
      setClausesJson('[]');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'No se pudo publicar la versión.');
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-gray-900">Base Regulatoria WorkSafeBC</h1>

      <Card>
        <CardHeader title="Publicar nueva versión" />
        <CardContent className="space-y-3">
          <Input label="Fecha efectiva (YYYY-MM-DD)" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
          <Input label="Resumen de cambios" value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Cláusulas (JSON)</span>
            <textarea
              value={clausesJson}
              onChange={(e) => setClausesJson(e.target.value)}
              rows={8}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-xs font-mono"
              placeholder='[{"part_number":"11","section":"11.2","clause":"(1)","regulation_text":"...","applicability_categories":["plan_seguridad"]}]'
            />
          </label>
          <div className="flex justify-end">
            <Button onClick={handlePublish} disabled={publish.isPending}>
              {publish.isPending ? 'Publicando…' : 'Publicar versión'}
            </Button>
          </div>
          {message && <p className="text-sm text-gray-700" role="status">{message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Versiones publicadas" />
        <CardContent>
          {(data?.versions ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">No hay versiones publicadas.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-4">Versión</th>
                  <th className="py-2 pr-4">Fecha efectiva</th>
                  <th className="py-2 pr-4">Cláusulas</th>
                  <th className="py-2">Resumen</th>
                </tr>
              </thead>
              <tbody>
                {(data?.versions ?? []).map((v) => (
                  <tr key={v.version_id} className="border-b border-gray-50">
                    <td className="py-2 pr-4 text-gray-900">{v.version_id}</td>
                    <td className="py-2 pr-4 text-gray-600">{v.effective_date}</td>
                    <td className="py-2 pr-4 text-gray-600">{v.clause_count}</td>
                    <td className="py-2 text-gray-600">{v.change_summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
