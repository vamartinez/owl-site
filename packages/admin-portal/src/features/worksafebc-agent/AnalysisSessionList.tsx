import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { UploadDocumentModal } from './UploadDocumentModal';
import { useSessions } from './api';
import { DOCUMENT_CATEGORY_LABELS, type SessionStatus } from './types';

const STATUS_LABEL: Partial<Record<SessionStatus, string>> = {
  recibido: 'Recibido',
  categorizado: 'Categorizado',
  texto_extraido: 'Texto extraído',
  analizando: 'Analizando',
  analisis_completado: 'Completado',
  extraccion_fallida: 'Extracción fallida',
  analisis_fallido: 'Análisis fallido',
  timeout: 'Timeout',
};

/**
 * Task 14.3 — Session history: filters (site/category/level), upload entry,
 * row navigation to detail. Empty state keeps filters active.
 */
export function AnalysisSessionList({ siteId = '' }: { siteId?: string }) {
  const navigate = useNavigate();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState('');

  const filters: Record<string, string> = {};
  if (category) filters['category'] = category;
  if (level) filters['compliance_level'] = level;
  if (siteId) filters['site'] = siteId;

  const { data, isLoading } = useSessions(filters);
  const sessions = data?.sessions ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Análisis WorkSafeBC</h1>
        <Button onClick={() => setUploadOpen(true)} disabled={!siteId}>Analizar documento</Button>
      </div>

      <Card>
        <CardHeader title="Sesiones" />
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Select
              label="Categoría"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={[{ value: '', label: 'Todas' }, ...Object.entries(DOCUMENT_CATEGORY_LABELS).map(([v, l]) => ({ value: v, label: l }))]}
            />
            <Select
              label="Nivel de cumplimiento"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              options={[
                { value: '', label: 'Todos' },
                { value: 'conforme', label: 'Conforme' },
                { value: 'parcialmente_conforme', label: 'Parcialmente conforme' },
                { value: 'no_conforme', label: 'No conforme' },
                { value: 'no_evaluable', label: 'No evaluable' },
              ]}
            />
          </div>

          {isLoading ? (
            <p className="text-sm text-gray-500">Cargando…</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-gray-500">No hay sesiones con los filtros seleccionados.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="py-2 pr-4">Documento</th>
                  <th className="py-2 pr-4">Categoría</th>
                  <th className="py-2 pr-4">Estado</th>
                  <th className="py-2 pr-4">Nivel</th>
                  <th className="py-2">Iniciado</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.session_id}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/worksafebc/${s.session_id}`)}
                  >
                    <td className="py-2 pr-4 text-gray-900">{s.document_name}</td>
                    <td className="py-2 pr-4 text-gray-600">{s.category ? DOCUMENT_CATEGORY_LABELS[s.category] : '—'}</td>
                    <td className="py-2 pr-4 text-gray-600">{STATUS_LABEL[s.status] ?? s.status}</td>
                    <td className="py-2 pr-4 text-gray-600">{s.report?.compliance_level ?? '—'}</td>
                    <td className="py-2 text-gray-500">{new Date(s.started_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <UploadDocumentModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        siteId={siteId}
        onCreated={(id) => navigate(`/worksafebc/${id}`)}
      />
    </div>
  );
}
