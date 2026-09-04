import { useParams } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Briefcase, Users, ShieldCheck, Phone, Mail } from 'lucide-react';

interface ContractorDetail {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  status: 'active' | 'suspended' | 'pending';
  workerCount: number;
  compliancePercent: number;
  activeSites: string[];
  workers: { id: string; name: string; complianceStatus: string }[];
}

const statusVariants = {
  active: 'success' as const,
  suspended: 'danger' as const,
  pending: 'warning' as const,
};

export default function ContractorProfile() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useApiQuery<ContractorDetail>(
    ['contractors', id!],
    `/contractors/${id}`
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-gray-100 rounded animate-pulse" />
        <div className="h-64 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Contractor not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{data.name}</h1>
          <p className="mt-1 text-sm text-gray-500">Contractor Profile</p>
        </div>
        <Badge variant={statusVariants[data.status]}>{data.status}</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="p-2 rounded-lg bg-blue-50">
              <Users size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{data.workerCount}</p>
              <p className="text-xs text-gray-500">Workers</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="p-2 rounded-lg bg-green-50">
              <ShieldCheck size={20} className="text-green-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{data.compliancePercent}%</p>
              <p className="text-xs text-gray-500">Compliance</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="p-2 rounded-lg bg-purple-50">
              <Briefcase size={20} className="text-purple-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{data.activeSites.length}</p>
              <p className="text-xs text-gray-500">Active Sites</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Contact Information" />
          <CardContent>
            <dl className="space-y-3">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-gray-400" />
                <dt className="text-sm text-gray-500 w-24">Contact:</dt>
                <dd className="text-sm font-medium text-gray-900">{data.contactPerson}</dd>
              </div>
              <div className="flex items-center gap-2">
                <Phone size={16} className="text-gray-400" />
                <dt className="text-sm text-gray-500 w-24">Phone:</dt>
                <dd className="text-sm font-medium text-gray-900">{data.phone}</dd>
              </div>
              <div className="flex items-center gap-2">
                <Mail size={16} className="text-gray-400" />
                <dt className="text-sm text-gray-500 w-24">Email:</dt>
                <dd className="text-sm font-medium text-gray-900">{data.email}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Active Sites" />
          <CardContent>
            {data.activeSites.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {data.activeSites.map((site) => (
                  <Badge key={site} variant="info">{site}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No active site assignments</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Workers"
          description={`${data.workers.length} workers assigned`}
        />
        <CardContent>
          <ul className="space-y-2">
            {data.workers.slice(0, 10).map((worker) => (
              <li key={worker.id} className="flex items-center justify-between text-sm py-1">
                <span className="font-medium text-gray-900">{worker.name}</span>
                <Badge
                  variant={worker.complianceStatus === 'compliant' ? 'success' : 'warning'}
                >
                  {worker.complianceStatus}
                </Badge>
              </li>
            ))}
            {data.workers.length === 0 && (
              <li className="text-sm text-gray-500 text-center py-4">No workers assigned</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
