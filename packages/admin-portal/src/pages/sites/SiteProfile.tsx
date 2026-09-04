import { useParams } from 'react-router-dom';
import { useApiQuery } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Building2, Users, ShieldCheck, MapPin, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Activity {
  id: string;
  description: string;
  timestamp: string;
}

interface SiteDetail {
  id: string;
  name: string;
  address: string;
  city: string;
  status: 'active' | 'inactive' | 'setup';
  contractor?: string;
  activeWorkers?: number;
  compliancePercent?: number;
  requiredCerts?: string[];
  recentActivity?: Activity[];
}

const statusVariants = {
  active: 'success' as const,
  inactive: 'default' as const,
  setup: 'warning' as const,
};

export default function SiteProfile() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useApiQuery<SiteDetail>(
    ['sites', id!],
    `/sites/${id}`
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
        <p className="text-gray-500">Site not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{data.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <MapPin size={14} className="text-gray-400" />
            <p className="text-sm text-gray-500">{data.address}, {data.city}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariants[data.status]}>{data.status}</Badge>
          <Link to={`/sites/${id}/config`}>
            <Button variant="outline" size="sm">
              <Settings size={16} />
              Configure
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="p-2 rounded-lg bg-blue-50">
              <Users size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{data.activeWorkers ?? 'N/A'}</p>
              <p className="text-xs text-gray-500">Active Workers</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="p-2 rounded-lg bg-green-50">
              <ShieldCheck size={20} className="text-green-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{data.compliancePercent != null ? `${data.compliancePercent}%` : 'N/A'}</p>
              <p className="text-xs text-gray-500">Compliance</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="p-2 rounded-lg bg-purple-50">
              <Building2 size={20} className="text-purple-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{data.contractor || 'N/A'}</p>
              <p className="text-xs text-gray-500">Contractor</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Required Certifications" />
          <CardContent>
            {(data.requiredCerts ?? []).length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {(data.requiredCerts ?? []).map((cert) => (
                  <Badge key={cert} variant="info">{cert}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No certifications required</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Recent Activity" />
          <CardContent>
            <ul className="space-y-3">
              {(data.recentActivity ?? []).slice(0, 5).map((activity) => (
                <li key={activity.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">{activity.description}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(activity.timestamp).toLocaleDateString()}
                  </span>
                </li>
              ))}
              {(data.recentActivity ?? []).length === 0 && (
                <li className="text-sm text-gray-500 text-center py-4">No recent activity</li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
