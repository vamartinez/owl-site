import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useRBAC } from '@/hooks/useRBAC';
import { useUpdateCertification } from './hooks/useUpdateCertification';
import { rejectionReasonSchema } from './schemas';
import { CertificationStatus, type Certification } from './types';

interface ValidationPanelProps {
  certification: Certification;
  workerId: string;
}

export function ValidationPanel({ certification, workerId }: ValidationPanelProps) {
  const { hasPermission } = useRBAC();
  const updateCertification = useUpdateCertification(workerId);

  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionError, setRejectionError] = useState<string | null>(null);

  // If user lacks permission, render nothing
  if (!hasPermission('certifications.validate')) {
    return null;
  }

  // Only show buttons when certification is pending
  if (certification.validation_status !== CertificationStatus.PENDING) {
    return null;
  }

  const handleValidate = () => {
    updateCertification.mutate({
      certId: certification.certification_id,
      validation_status: CertificationStatus.VALIDATED,
    });
  };

  const handleRejectClick = () => {
    setShowRejectInput(true);
    setRejectionError(null);
  };

  const handleRejectSubmit = () => {
    const result = rejectionReasonSchema.safeParse({ rejection_reason: rejectionReason });

    if (!result.success) {
      const fieldError = result.error.errors[0]?.message ?? 'Invalid rejection reason';
      setRejectionError(fieldError);
      return;
    }

    setRejectionError(null);
    updateCertification.mutate({
      certId: certification.certification_id,
      validation_status: CertificationStatus.REJECTED,
      rejection_reason: rejectionReason,
    });
    setShowRejectInput(false);
    setRejectionReason('');
  };

  const handleCancelReject = () => {
    setShowRejectInput(false);
    setRejectionReason('');
    setRejectionError(null);
  };

  return (
    <div className="flex items-start gap-2">
      {!showRejectInput ? (
        <>
          <Button
            variant="primary"
            size="sm"
            onClick={handleValidate}
            disabled={updateCertification.isPending}
          >
            Validate
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleRejectClick}
            disabled={updateCertification.isPending}
          >
            Reject
          </Button>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <Input
            label="Rejection Reason"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            error={rejectionError ?? undefined}
            placeholder="Enter reason for rejection (min 10 characters)"
          />
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={handleRejectSubmit}
              disabled={updateCertification.isPending}
            >
              Submit Rejection
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelReject}
              disabled={updateCertification.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
