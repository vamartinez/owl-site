import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { AnalysisProgress } from './AnalysisProgress';
import { ComplianceReportView } from './ComplianceReportView';
import { useSession } from './api';

/** Session detail: live progress until complete, then the report. */
export function AnalysisSessionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useSession(id);

  if (!id) return null;
  if (isLoading) return <p className="text-sm text-gray-500">Cargando sesión…</p>;

  const session = data?.session;
  return (
    <div className="space-y-4">
      <div>
        <button className="text-sm text-primary-600 hover:underline" onClick={() => navigate('/worksafebc')}>
          ← Volver a sesiones
        </button>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">{session?.document_name ?? 'Sesión'}</h1>
      </div>

      <Card>
        <CardHeader title="Progreso" />
        <CardContent>
          <AnalysisProgress sessionId={id} />
        </CardContent>
      </Card>

      {session?.report && (
        <ComplianceReportView
          sessionId={id}
          report={session.report}
          onReanalyzed={(newId) => navigate(`/worksafebc/${newId}`)}
        />
      )}
    </div>
  );
}
