import { useApiQuery } from '@/hooks/useApi';
import { Card, CardContent } from '@/components/ui/Card';
import { TrendLine } from '@/components/charts/TrendLine';
import { RisksSummary } from './RisksSummary';
import { BlockedAccess } from './BlockedAccess';
import { ExpiringCerts } from './ExpiringCerts';
import { RecentActivity } from './RecentActivity';
import { Users, ShieldCheck, AlertCircle, Gavel, Award } from 'lucide-react';

interface DashboardKPIs {
  totalActiveWorkers: number;
  siteCompliancePercent: number;
  pendingFindings: number;
  unresolvedEnforcements: number;
  certsExpiringIn30Days: number;
  complianceTrend: { date: string; value: number }[];
}

export default function DashboardPage() {
  const { data, isLoading } = useApiQuery<DashboardKPIs>(
    ['dashboard', 'kpis'],
    '/dashboard/kpis',
    undefined,
    { refetchInterval: 5 * 60 * 1000 }
  );

  const kpiCards = [
    {
      label: 'Active Workers',
      value: data?.totalActiveWorkers ?? 0,
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Site Compliance',
      value: `${data?.siteCompliancePercent ?? 0}%`,
      icon: ShieldCheck,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      label: 'Pending Findings',
      value: data?.pendingFindings ?? 0,
      icon: AlertCircle,
      color: 'text-yellow-600',
      bg: 'bg-yellow-50',
    },
    {
      label: 'Unresolved Actions',
      value: data?.unresolvedEnforcements ?? 0,
      icon: Gavel,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
    {
      label: 'Certs Expiring (30d)',
      value: data?.certsExpiringIn30Days ?? 0,
      icon: Award,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard Ejecutivo</h1>
        <p className="mt-1 text-sm text-gray-500">
          Executive compliance overview — auto-refreshes every 5 minutes
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {kpiCards.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="flex items-center gap-3 py-4">
              <div className={`p-2 rounded-lg ${kpi.bg}`}>
                <kpi.icon size={20} className={kpi.color} />
              </div>
              <div>
                {isLoading ? (
                  <div className="h-6 w-12 bg-gray-100 rounded animate-pulse" />
                ) : (
                  <p className="text-xl font-bold text-gray-900">{kpi.value}</p>
                )}
                <p className="text-xs text-gray-500">{kpi.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Compliance Trend */}
      {data?.complianceTrend && data.complianceTrend.length > 0 && (
        <Card>
          <CardContent>
            <TrendLine
              data={data.complianceTrend}
              dataKey="value"
              xAxisKey="date"
              color="#10b981"
              height={200}
              label="Compliance Trend (7 days)"
            />
          </CardContent>
        </Card>
      )}

      {/* Widgets Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RisksSummary />
        <BlockedAccess />
        <ExpiringCerts />
        <RecentActivity />
      </div>
    </div>
  );
}
