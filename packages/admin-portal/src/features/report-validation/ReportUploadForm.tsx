import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Upload } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useCreateReport } from './hooks/useCreateReport';
import { useUploadVersion } from './hooks/useUploadVersion';
import { reportUploadSchema, type ReportUploadData } from './schemas';

const ACCEPTED_FILE_EXTENSIONS = '.pdf,.docx,.doc';

export type ReportUploadMode = 'create' | 'new-version';

interface ReportUploadFormProps {
  open: boolean;
  onClose: () => void;
  mode: ReportUploadMode;
  /** Required when mode is 'new-version' */
  reportId?: string;
  onSuccess?: () => void;
}

/**
 * Modal form for uploading a report document.
 * Supports two modes:
 * - "create": Initial report upload (calls useCreateReport)
 * - "new-version": Upload a new version of an existing validated report (calls useUploadVersion)
 *
 * Validates: Requirements 1.1, 1.2, 1.5, 1.7, 6.1
 */
export function ReportUploadForm({
  open,
  onClose,
  mode,
  reportId,
  onSuccess,
}: ReportUploadFormProps) {
  const isNewVersion = mode === 'new-version';

  const {
    createReport,
    isLoading: isCreateLoading,
    error: createError,
    uploadProgress: createProgress,
    isUploading: isCreateUploading,
    reset: resetCreate,
  } = useCreateReport();

  const {
    uploadVersion,
    isLoading: isVersionLoading,
    error: versionError,
    uploadProgress: versionProgress,
    isUploading: isVersionUploading,
    reset: resetVersion,
  } = useUploadVersion(reportId ?? '');

  const isLoading = isNewVersion ? isVersionLoading : isCreateLoading;
  const isUploading = isNewVersion ? isVersionUploading : isCreateUploading;
  const uploadProgress = isNewVersion ? versionProgress : createProgress;
  const hookError = isNewVersion ? versionError : createError;

  const [apiError, setApiError] = useState<string | null>(null);

  const {
    handleSubmit,
    control,
    reset: resetForm,
    formState: { errors },
  } = useForm<ReportUploadData>({
    resolver: zodResolver(reportUploadSchema),
  });

  // Reset form state when modal opens/closes
  useEffect(() => {
    if (open) {
      resetForm();
      resetCreate();
      resetVersion();
      setApiError(null);
    }
  }, [open, resetForm, resetCreate, resetVersion]);

  const onSubmit = async (data: ReportUploadData) => {
    setApiError(null);

    try {
      if (isNewVersion && reportId) {
        await uploadVersion({
          metadata: {
            file_name: data.document.name,
            file_size: data.document.size,
            mime_type: data.document.type,
          },
          file: data.document,
        });
      } else {
        await createReport({
          metadata: {
            file_name: data.document.name,
            file_size: data.document.size,
            mime_type: data.document.type,
          },
          file: data.document,
        });
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      // Error is already captured by the hook, but we also set a local error
      // to keep the modal open with the file attached for retry
      const message =
        err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setApiError(message);
    }
  };

  const formError = apiError || hookError;
  const title = isNewVersion ? 'Upload New Version' : 'Upload Report';
  const submitLabel = isUploading
    ? 'Uploading...'
    : isNewVersion
      ? 'Upload Version'
      : 'Upload Report';

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {formError && (
          <div className="rounded-md bg-red-50 p-3" role="alert">
            <p className="text-sm text-red-700">{formError}</p>
          </div>
        )}

        <Controller
          name="document"
          control={control}
          render={({ field: { onChange, onBlur, name, ref } }) => (
            <div className="space-y-1">
              <label
                htmlFor="report-document-file"
                className="block text-sm font-medium text-gray-700"
              >
                Document File
              </label>
              <div className="flex items-center gap-3">
                <label
                  htmlFor="report-document-file"
                  className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Upload size={16} />
                  Choose File
                </label>
                <input
                  id="report-document-file"
                  ref={ref}
                  name={name}
                  type="file"
                  accept={ACCEPTED_FILE_EXTENSIONS}
                  onBlur={onBlur}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      onChange(file);
                    }
                  }}
                  className="sr-only"
                  aria-describedby={
                    errors.document?.message
                      ? 'report-document-error'
                      : 'report-document-helper'
                  }
                />
              </div>
              <p id="report-document-helper" className="text-xs text-gray-500">
                Accepted formats: PDF, .docx, .doc (1 KB – 25 MB)
              </p>
              {errors.document?.message && (
                <p
                  id="report-document-error"
                  className="text-xs text-red-600"
                  role="alert"
                >
                  {errors.document.message}
                </p>
              )}
            </div>
          )}
        />

        {isUploading && (
          <div className="w-full space-y-1">
            <div
              role="progressbar"
              aria-valuenow={uploadProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
              className="w-full h-2 bg-gray-200 rounded-full overflow-hidden"
            >
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-200"
                style={{ width: `${Math.min(100, Math.max(0, uploadProgress))}%` }}
              />
            </div>
            <p className="text-xs text-gray-600 text-right">
              {Math.min(100, Math.max(0, uploadProgress))}%
            </p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isUploading}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isUploading || isLoading}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
