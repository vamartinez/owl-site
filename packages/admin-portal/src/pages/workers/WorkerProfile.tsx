import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Phone, Mail, Award, Building2, Globe } from 'lucide-react';
import { CertificationList } from '@/features/certifications/CertificationList';
import { CertificationForm } from '@/features/certifications/CertificationForm';
import type { Certification } from '@/features/certifications/types';
import {
  type ApiGetWorkerResponse,
  normalizeWorkerDetail,
} from '@/types/api-contracts';

const statusVariants = {
  active: 'success' as const,
  inactive: 'danger' as const,
};

const langLabels: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  pa: 'Punjabi',
};

export default function WorkerProfile() {
  const { id } = useParams<{ id: string }>();

  const [certFormOpen, setCertFormOpen] = useState(false);
  const [reuploadCertification, setReuploadCertification] = useState<Certification | undefined>(
    undefined
  );

  const { data: rawData, isLoading } = useApiQuery<ApiGetWorkerResponse>(
    ['workers', id!],
    `/workers/${id}`
  );

  const worker = rawData?.worker ? normalizeWorkerDetail(rawData.worker) : null;

  const handleAddCertification = () => {
    setReuploadCertification(undefined);
    setCertFormOpen(true);
  };

  const handleReupload = (certification: Certification) => {
    setReuploadCertification(certification);
    setCertFormOpen(true);
  };

  const handleFormClose = () => {
    setCertFormOpen(false);
    setReuploadCertification(undefined);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-gray-100 rounded animate-pulse" />
        <div className="h-64 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  if (!worker) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Worker not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{worker.legalName}</h1>
          {worker.preferredName && (
            <p className="mt-1 text-sm text-gray-500">"{worker.preferredName}"</p>
          )}
        </div>
        <Badge variant={statusVariants[worker.status]}>
          {worker.status}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="p-2 rounded-lg bg-blue-50">
              <Phone size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{worker.phone}</p>
              <p className="text-xs text-gray-500">Phone</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="p-2 rounded-lg bg-green-50">
              <Mail size={20} className="text-green-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                {worker.email || 'No email'}
              </p>
              <p className="text-xs text-gray-500">Email</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="p-2 rounded-lg bg-purple-50">
              <Globe size={20} className="text-purple-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                {langLabels[worker.languagePreference] || worker.languagePreference}
              </p>
              <p className="text-xs text-gray-500">Language</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Certifications Management"
          action={
            <Button variant="primary" size="sm" onClick={handleAddCertification}>
              Add Certification
            </Button>
          }
        />
        <CardContent>
          <CertificationList workerId={id!} onReupload={handleReupload} />
        </CardContent>
      </Card>

      <CertificationForm
        workerId={id!}
        open={certFormOpen}
        onClose={handleFormClose}
        existingCertification={reuploadCertification}
      />
    </div>
  );
}
