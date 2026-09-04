import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Download, Eye, EyeOff, Edit, FileText } from 'lucide-react';
import { toDataURL as qrToDataURL } from 'qrcode';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { useFormQuery } from './hooks/useFormQuery';
import { usePublishForm } from './hooks/usePublishForm';
import { useUnpublishForm } from './hooks/useUnpublishForm';
import { logAuditEvent } from './api';
import { FormStatus } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const QR_SIZE = 300; // Minimum 300x300px as per requirement 8.3
const PUBLIC_DOMAIN = window.location.origin;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const statusLabels: Record<FormStatus, string> = {
  [FormStatus.BORRADOR]: 'Draft',
  [FormStatus.PUBLICADO]: 'Published',
  [FormStatus.DESPUBLICADO]: 'Unpublished',
};

const statusVariants: Record<FormStatus, 'default' | 'success' | 'warning'> = {
  [FormStatus.BORRADOR]: 'default',
  [FormStatus.PUBLICADO]: 'success',
  [FormStatus.DESPUBLICADO]: 'warning',
};

function formatDate(isoDate: string | undefined): string {
  if (!isoDate) return '—';
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FormDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: form, isLoading, error, refetch } = useFormQuery(id);
  const publishMutation = usePublishForm();
  const unpublishMutation = useUnpublishForm();

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Build the public URL for the form
  const publicUrl = form?.token_publico
    ? `${PUBLIC_DOMAIN}/public/forms/${form.token_publico}`
    : null;

  // Generate QR code when form has a token_publico
  const generateQr = useCallback(async (url: string) => {
    try {
      setQrError(null);
      const dataUrl = await qrToDataURL(url, {
        width: QR_SIZE,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
        errorCorrectionLevel: 'M',
      });
      setQrDataUrl(dataUrl);
    } catch {
      setQrError('Could not generate the QR code. Please try again.');
      setQrDataUrl(null);
    }
  }, []);

  useEffect(() => {
    if (publicUrl && form?.status !== FormStatus.BORRADOR) {
      generateQr(publicUrl);
    } else {
      setQrDataUrl(null);
    }
  }, [publicUrl, form?.status, generateQr]);

  // ─── Actions ──────────────────────────────────────────────────────────────────

  const handlePublish = () => {
    if (!id) return;
    publishMutation.mutate({ formId: id });
  };

  const handleUnpublish = () => {
    if (!id) return;
    unpublishMutation.mutate({ formId: id });
  };

  const handleDownloadQr = async () => {
    if (!qrDataUrl || !form || !id) return;

    setIsDownloading(true);
    try {
      // Create download link
      const link = document.createElement('a');
      link.download = `qr-${form.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.png`;
      link.href = qrDataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Log audit event "qr_descargado"
      await logAuditEvent(id, {
        action: 'qr_descargado',
        metadata: { form_name: form.name, token_publico: form.token_publico },
      });
    } catch {
      // Audit logging failure should not block the download
      console.warn('Failed to log QR download audit event');
    } finally {
      setIsDownloading(false);
    }
  };

  // ─── Loading & Error States ───────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorDisplay
        error={error}
        title="Failed to load form"
        onRetry={() => refetch()}
      />
    );
  }

  if (!form) {
    return (
      <ErrorDisplay
        error={{ message: 'Form not found' } as Error}
        title="Form not found"
      />
    );
  }

  const showQrSection = form.status !== FormStatus.BORRADOR && form.token_publico;

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/forms')}>
          <ArrowLeft size={16} />
          Back
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{form.name}</h1>
          {form.description && (
            <p className="mt-1 text-sm text-gray-500">{form.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariants[form.status]}>
            {statusLabels[form.status]}
          </Badge>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        {form.status === FormStatus.BORRADOR && (
          <>
            <Button
              variant="outline"
              onClick={() => navigate(`/forms/${id}/edit`)}
            >
              <Edit size={16} />
              Edit
            </Button>
            <Button
              onClick={handlePublish}
              disabled={publishMutation.isPending}
            >
              <Eye size={16} />
              {publishMutation.isPending ? 'Publishing...' : 'Publish'}
            </Button>
          </>
        )}
        {form.status === FormStatus.PUBLICADO && (
          <>
            <Button
              variant="outline"
              onClick={() => navigate(`/forms/${id}/edit`)}
            >
              <Edit size={16} />
              Edit
            </Button>
            <Button
              variant="danger"
              onClick={handleUnpublish}
              disabled={unpublishMutation.isPending}
            >
              <EyeOff size={16} />
              {unpublishMutation.isPending ? 'Unpublishing...' : 'Unpublish'}
            </Button>
          </>
        )}
        {form.status === FormStatus.DESPUBLICADO && (
          <Button
            onClick={handlePublish}
            disabled={publishMutation.isPending}
          >
            <Eye size={16} />
            {publishMutation.isPending ? 'Republishing...' : 'Republish'}
          </Button>
        )}
        <Link to={`/forms/${id}/responses`}>
          <Button variant="outline">
            <FileText size={16} />
            View Responses
          </Button>
        </Link>
      </div>

      {/* Error messages from mutations */}
      {publishMutation.isError && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">
            {publishMutation.error?.message || 'Failed to publish the form'}
          </p>
        </div>
      )}
      {unpublishMutation.isError && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">
            {unpublishMutation.error?.message || 'Failed to unpublish the form'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form Metadata Card */}
        <Card>
          <CardHeader title="Form Information" />
          <CardContent>
            <dl className="space-y-4">
              <div>
                <dt className="text-sm font-medium text-gray-500">ID</dt>
                <dd className="mt-1 text-sm text-gray-900 font-mono">{form.form_id}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Status</dt>
                <dd className="mt-1">
                  <Badge variant={statusVariants[form.status]}>
                    {statusLabels[form.status]}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Configured fields</dt>
                <dd className="mt-1 text-sm text-gray-900">{form.fields.length}</dd>
              </div>
              {form.current_version && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Current version</dt>
                  <dd className="mt-1 text-sm text-gray-900">v{form.current_version}</dd>
                </div>
              )}
              <div>
                <dt className="text-sm font-medium text-gray-500">Created</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatDate(form.created_at)}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Last modified</dt>
                <dd className="mt-1 text-sm text-gray-900">{formatDate(form.updated_at)}</dd>
              </div>
              {form.published_at && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Published</dt>
                  <dd className="mt-1 text-sm text-gray-900">{formatDate(form.published_at)}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* QR Code Card — Only shown for published/unpublished forms (Req 8.7) */}
        {showQrSection && (
          <Card>
            <CardHeader
              title="QR Code"
              description="Scan or share this code to access the form"
            />
            <CardContent>
              <div className="flex flex-col items-center space-y-4">
                {qrError ? (
                  <div className="text-center space-y-2">
                    <p className="text-sm text-red-600">{qrError}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => publicUrl && generateQr(publicUrl)}
                    >
                      Retry
                    </Button>
                  </div>
                ) : qrDataUrl ? (
                  <>
                    <img
                      src={qrDataUrl}
                      alt={`QR code for form ${form.name}`}
                      width={QR_SIZE}
                      height={QR_SIZE}
                      className="border border-gray-200 rounded-lg"
                    />
                    <Button
                      variant="outline"
                      onClick={handleDownloadQr}
                      disabled={isDownloading}
                    >
                      <Download size={16} />
                      {isDownloading ? 'Downloading...' : 'Download PNG'}
                    </Button>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-32">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
                  </div>
                )}

                {/* Public URL display */}
                {publicUrl && (
                  <div className="w-full mt-4 p-3 bg-gray-50 rounded-md">
                    <p className="text-xs font-medium text-gray-500 mb-1">Public URL</p>
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary-600 hover:text-primary-700 break-all"
                    >
                      {publicUrl}
                    </a>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default FormDetail;
