import { useApiQuery } from '@/hooks/useApi';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { BarChart } from '@/components/charts/BarChart';
import { Award, CheckCircle, Clock, AlertTriangle } from 'lucide-react';

interface CertStats {
  totalActive: number;
  pendingValidation: number;
  expiringSoon: number;
  expired: number;
  byType: { type: string; count: number }[];
}

export default function CertOverview() {
  const { data, isLoading } = useApiQuery<CertStats>(
    ['certifications', 'stats'],
    '/certifications/stats'
  );

  const statCards = [
    { label: 'Active Certs', value: data?.totalActive ?? 0, icon: Award, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Pending Validation', value: data?.pendingValidation ?? 0, icon: Clock, color: 'text-yellow-600', bg: 'bg-yellow-50' },
    { label: 'Expiring Soon', value: data?.expiringSoon ?? 0, icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50' },
    { label: 'Expired', value: data?.expired ?? 0, icon: CheckCircle, color: 'text-red-600', bg: 'bg-red-50' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Certifications Overview</h1>
        <p className="mt-1 text-sm text-gray-500">
          Certification management and validation status
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="flex items-center gap-3 py-4">
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon size={20} className={stat.color} />
              </div>
              <div>
                {isLoading ? (
                  <div className="h-6 w-12 bg-gray-100 rounded animate-pulse" />
                ) : (
                  <p className="text-xl font-bold text-gray-900">{stat.value}</p>
                )}
                <p className="text-xs text-gray-500">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {data?.byType && data.byType.length > 0 && (
        <Card>
          <CardContent>
            <BarChart
              data={data.byType}
              dataKey="count"
              xAxisKey="type"
              color="#8b5cf6"
              height={280}
              label="Certifications by Type"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
