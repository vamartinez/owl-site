import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { UploadProgressBar } from './UploadProgressBar';
import { useCreateCertification } from './hooks/useCreateCertification';
import { useUpdateCertification } from './hooks/useUpdateCertification';
import {
  certificationFormSchema,
  type CertificationFormData,
} from './schemas';
import {
  CertificationType,
  CertificationStatus,
  type Certification,
} from './types';

interface CertificationFormProps {
  workerId: string;
  open: boolean;
  onClose: () => void;
  existingCertification?: Certification;
}

const CERTIFICATION_TYPE_OPTIONS = [
  { value: CertificationType.WHMIS_2015, label: 'WHMIS 2015' },
  { value: CertificationType.FALL_PROTECTION, label: 'Fall Protection' },
  { value: CertificationType.SITE_READY_BC, label: 'SiteReadyBC' },
  { value: CertificationType.FIRST_AID, label: 'First Aid' },
];

const ACCEPTED_FILE_EXTENSIONS = '.pdf,.jpg,.jpeg,.png';

export function CertificationForm({
  workerId,
  open,
  onClose,
  existingCertification,
}: CertificationFormProps) {
  const isReuploadMode = !!existingCertification;

  const {
    createCertification,
    isLoading: isCreating,
    error: createError,
    uploadProgress: createUploadProgress,
    isUploading: isCreateUploading,
    reset: resetCreate,
  } = useCreateCertification({ workerId });

  const updateMutation = useUpdateCertification(workerId);

  const isUploading = isCreateUploading;
  const uploadProgress = createUploadProgress;

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<CertificationFormData>({
    resolver: zodResolver(certificationFormSchema),
    defaultValues: existingCertification
      ? {
          certification_type: existingCertification.certification_type,
          issuer: existingCertification.issuer,
          issue_date: existingCertification.issue_date,
          expiry_date: existingCertification.expiry_date,
        }
      : {
          certification_type: undefined,
          issuer: '',
          issue_date: '',
          expiry_date: '',
        },
  });

  // Reset form when modal opens/closes or existingCertification changes
  useEffect(() => {
    if (open) {
      resetCreate();
      if (existingCertification) {
        reset({
          certification_type: existingCertification.certification_type,
          issuer: existingCertification.issuer,
          issue_date: existingCertification.issue_date,
          expiry_date: existingCertification.expiry_date,
        });
      } else {
        reset({
          certification_type: undefined,
          issuer: '',
          issue_date: '',
          expiry_date: '',
        });
      }
    }
  }, [open, existingCertification, reset, resetCreate]);

  const [apiError, setApiError] = useState<string | null>(null);

  const onSubmit = async (data: CertificationFormData) => {
    setApiError(null);

    try {
      if (isReuploadMode && existingCertification) {
        // Re-upload mode: PATCH status to pending, then create new with same metadata for signed URL
        await updateMutation.mutateAsync({
          certId: existingCertification.certification_id,
          validation_status: CertificationStatus.PENDING,
        });

        // Create new certification entry to get a fresh signed URL and upload
        await createCertification({
          metadata: {
            certification_type: existingCertification.certification_type,
            issuer: existingCertification.issuer,
            issue_date: existingCertification.issue_date,
            expiry_date: existingCertification.expiry_date,
            document_content_type: data.document.type,
            document_size: data.document.size,
            document_filename: data.document.name,
          },
          file: data.document,
        });
      } else {
        // Create mode: POST metadata + upload file
        await createCertification({
          metadata: {
            certification_type: data.certification_type,
            issuer: data.issuer,
            issue_date: data.issue_date,
            expiry_date: data.expiry_date,
            document_content_type: data.document.type,
            document_size: data.document.size,
            document_filename: data.document.name,
          },
          file: data.document,
        });
      }

      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred';
      setApiError(message);
    }
  };

  const formError = apiError || createError;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isReuploadMode ? 'Re-upload Certification' : 'Add Certification'}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {formError && (
          <div className="rounded-md bg-red-50 p-3" role="alert">
            <p className="text-sm text-red-700">{formError}</p>
          </div>
        )}

        <Controller
          name="certification_type"
          control={control}
          render={({ field }) => (
            <Select
              label="Certification Type"
              options={CERTIFICATION_TYPE_OPTIONS}
              placeholder="Select certification type"
              disabled={isReuploadMode}
              error={errors.certification_type?.message}
              {...field}
            />
          )}
        />

        <Input
          label="Issuer"
          placeholder="Enter issuer name"
          disabled={isReuploadMode}
          error={errors.issuer?.message}
          {...register('issuer')}
        />

        <Input
          label="Issue Date"
          type="date"
          disabled={isReuploadMode}
          error={errors.issue_date?.message}
          {...register('issue_date')}
        />

        <Input
          label="Expiry Date"
          type="date"
          disabled={isReuploadMode}
          error={errors.expiry_date?.message}
          {...register('expiry_date')}
        />

        <Controller
          name="document"
          control={control}
          render={({ field: { onChange, onBlur, name, ref } }) => (
            <div className="space-y-1">
              <label
                htmlFor="document-file"
                className="block text-sm font-medium text-gray-700"
              >
                Document File
              </label>
              <input
                id="document-file"
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
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
              />
              {errors.document?.message && (
                <p className="text-xs text-red-600" role="alert">
                  {errors.document.message}
                </p>
              )}
            </div>
          )}
        />

        {isUploading && <UploadProgressBar progress={uploadProgress} />}

        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isUploading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isUploading || isCreating}
          >
            {isUploading ? 'Uploading...' : isReuploadMode ? 'Re-upload' : 'Submit'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
