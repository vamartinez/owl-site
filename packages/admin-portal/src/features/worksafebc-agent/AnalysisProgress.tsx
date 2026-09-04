import { CheckCircle, Circle, Loader2, XCircle } from 'lucide-react';
import { useSession, useSessionPolling } from './api';
import { TERMINAL_STATUSES, type SessionStatus } from './types';

interface Props {
  sessionId: string;
}

const STAGES: { key: string; label: string; statuses: SessionStatus[] }[] = [
  { key: 'carga', label: 'Carga', statuses: ['recibido', 'categorizado'] },
  { key: 'extraccion', label: 'Extracción de texto', statuses: ['texto_extraido'] },
  { key: 'analisis', label: 'Análisis de cumplimiento', statuses: ['analizando'] },
  { key: 'reporte', label: 'Reporte', statuses: ['analisis_completado'] },
];

const STATUS_ORDER: SessionStatus[] = [
  'recibido',
  'categorizado',
  'texto_extraido',
  'analizando',
  'analisis_completado',
];

/**
 * Task 14.2 — Pipeline progress indicator. Polls the session while non-terminal;
 * reflects each backend state change within ~3s.
 */
export function AnalysisProgress({ sessionId }: Props) {
  const { data } = useSession(sessionId);
  const status = data?.session.status;
  useSessionPolling(sessionId, status);

  if (!status) return <p className="text-sm text-gray-500">Cargando estado…</p>;

  const failed =
    status === 'extraccion_fallida' || status === 'analisis_fallido' || status === 'timeout';
  const currentIdx = STATUS_ORDER.indexOf(status);

  return (
    <div className="space-y-3">
      {STAGES.map((stage) => {
        const stageMaxIdx = Math.max(...stage.statuses.map((s) => STATUS_ORDER.indexOf(s)));
        const done = currentIdx > stageMaxIdx;
        const active = stage.statuses.includes(status);
        return (
          <div key={stage.key} className="flex items-center gap-3">
            {failed && active ? (
              <XCircle size={18} className="text-red-500" />
            ) : done ? (
              <CheckCircle size={18} className="text-green-600" />
            ) : active ? (
              <Loader2 size={18} className="text-primary-600 animate-spin" />
            ) : (
              <Circle size={18} className="text-gray-300" />
            )}
            <span className={`text-sm ${active ? 'font-medium text-gray-900' : 'text-gray-600'}`}>
              {stage.label}
            </span>
          </div>
        );
      })}
      {failed && (
        <p className="text-sm text-red-600" role="alert">
          {data?.session.failure_reason ?? 'El análisis falló. Verifica el formato del documento o contacta soporte.'}
        </p>
      )}
      {TERMINAL_STATUSES.includes(status) && status === 'analisis_completado' && (
        <p className="text-sm text-green-700">Análisis completado.</p>
      )}
    </div>
  );
}
