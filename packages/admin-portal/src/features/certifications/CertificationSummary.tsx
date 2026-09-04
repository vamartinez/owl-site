import { classifyExpiry } from './utils/classifyExpiry';
import type { Certification } from './types';

interface CertificationSummaryProps {
  certifications: Certification[];
}

export function CertificationSummary({ certifications }: CertificationSummaryProps) {
  const expiringCount = certifications.filter(
    (cert) => classifyExpiry(cert.expiry_date) === 'expiring'
  ).length;

  const expiredCount = certifications.filter(
    (cert) => classifyExpiry(cert.expiry_date) === 'expired'
  ).length;

  if (expiringCount === 0 && expiredCount === 0) {
    return (
      <div className="mb-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">
        All certifications valid
      </div>
    );
  }

  return (
    <div className="mb-4 flex items-center gap-3 rounded-md bg-gray-50 px-4 py-2 text-sm">
      {expiringCount > 0 && (
        <span className="font-medium text-amber-600">
          {expiringCount} expiring
        </span>
      )}
      {expiringCount > 0 && expiredCount > 0 && (
        <span className="text-gray-400">·</span>
      )}
      {expiredCount > 0 && (
        <span className="font-medium text-red-600">
          {expiredCount} expired
        </span>
      )}
    </div>
  );
}
