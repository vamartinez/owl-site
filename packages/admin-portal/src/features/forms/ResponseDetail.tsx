import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Hash, User, Globe } from 'lucide-react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { useFormResponseDetail } from './hooks/useFormResponseDetail';
import { FieldType, type FieldConfig } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const originTypeLabels: Record<string, string> = {
  qr: 'QR code',
  url: 'Direct URL',
};

function getOriginLabel(originType: string): string {
  return originTypeLabels[originType] ?? originType;
}

// ─── Field Value Renderer ─────────────────────────────────────────────────────

interface FieldValueProps {
  field: FieldConfig;
  value: unknown;
}

function FieldValue({ field, value }: FieldValueProps) {
  if (value === undefined || value === null || value === '') {
    return <span className="text-gray-400 italic">No answer</span>;
  }

  switch (field.type) {
    case FieldType.CHECKBOX_ACEPTACION:
      return (
        <Badge variant={value ? 'success' : 'default'}>
          {value ? 'Accepted' : 'Not accepted'}
        </Badge>
      );

    case FieldType.SELECCION_MULTIPLE:
      if (Array.isArray(value)) {
        return (
          <div className="flex flex-wrap gap-1">
            {value.map((v, i) => {
              const option = field.options?.find((o) => o.option_id === v);
              return (
                <Badge key={i} variant="info">
                  {option?.label ?? String(v)}
                </Badge>
              );
            })}
          </div>
        );
      }
      return <span>{String(value)}</span>;

    case FieldType.SELECCION_SIMPLE: {
      const option = field.options?.find((o) => o.option_id === value);
      return <span>{option?.label ?? String(value)}</span>;
    }

    case FieldType.FECHA:
      return <span>{formatDate(String(value))}</span>;

    case FieldType.NUMERO:
      return <span className="font-mono">{String(value)}</span>;

    case FieldType.CARGA_ARCHIVO:
      return (
        <span className="text-primary-600 text-sm">
          Attached file
        </span>
      );

    case FieldType.TEXTO_LARGO:
      return (
        <p className="whitespace-pre-wrap text-gray-700">{String(value)}</p>
      );

    case FieldType.TEXTO_CORTO:
    default:
      return <span>{String(value)}</span>;
  }
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function ResponseDetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-48" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 bg-gray-200 rounded-lg" />
        ))}
      </div>
      <div className="h-64 bg-gray-200 rounded-lg" />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ResponseDetail() {
  const { id: formId, responseId } = useParams<{ id: string; responseId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, error, refetch } = useFormResponseDetail(formId, responseId);

  if (isLoading) {
    return <ResponseDetailSkeleton />;
  }

  if (error) {
    return (
      <ErrorDisplay
        error={error}
        title="Could not load the response detail"
        onRetry={() => refetch()}
      />
    );
  }

  if (!data) {
    return (
      <ErrorDisplay
        error="The requested response was not found"
        title="Response not found"
      />
    );
  }

  const { response, version } = data;
  const fields = version.fields_snapshot.sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/forms/${formId}/responses`)}
          aria-label="Back to responses"
        >
          <ArrowLeft size={16} />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            Response Detail
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Folio: {response.folio} · Version {version.version_number}
          </p>
        </div>
      </div>

      {/* Metadata Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center h-9 w-9 rounded-full bg-blue-100">
                <Calendar size={16} className="text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Submitted</p>
                <p className="text-sm font-medium text-gray-900">
                  {formatDate(response.submitted_at)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center h-9 w-9 rounded-full bg-purple-100">
                <Hash size={16} className="text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Folio</p>
                <p className="text-sm font-medium font-mono text-gray-900">
                  {response.folio}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center h-9 w-9 rounded-full bg-green-100">
                <User size={16} className="text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Contractor</p>
                <p className="text-sm font-medium text-gray-900">
                  {response.metadata.ip_address}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center h-9 w-9 rounded-full bg-yellow-100">
                <Globe size={16} className="text-yellow-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Origin</p>
                <p className="text-sm font-medium text-gray-900">
                  {getOriginLabel(response.metadata.origin_type)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Field Values */}
      <Card>
        <CardHeader
          title="Form responses"
          description={`${fields.length} field${fields.length !== 1 ? 's' : ''} · Version ${version.version_number}`}
        />
        <CardContent>
          <dl className="divide-y divide-gray-100">
            {fields.map((field) => (
              <div
                key={field.field_id}
                className="py-4 first:pt-0 last:pb-0 sm:grid sm:grid-cols-3 sm:gap-4"
              >
                <dt className="text-sm font-medium text-gray-900">
                  {field.label}
                  {field.required && (
                    <span className="ml-1 text-red-500" aria-label="required field">*</span>
                  )}
                  <span className="block text-xs font-normal text-gray-400 mt-0.5">
                    {field.type.replace('_', ' ')}
                  </span>
                </dt>
                <dd className="mt-1 text-sm text-gray-700 sm:col-span-2 sm:mt-0">
                  <FieldValue field={field} value={response.answers[field.field_id]} />
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

export default ResponseDetail;
