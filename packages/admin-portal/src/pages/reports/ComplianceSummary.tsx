import { useApiQuery } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { BarChart } from '@/components/charts/BarChart';
import { TrendLine } from '@/components/charts/TrendLine';
import { Button } from '@/components/ui/Button';
import { Download, ShieldCheck, AlertTriangle, Users, Building2 } from 'lucide-react';

interface ComplianceStats {
  overallPercent: number;
  totalSites: number;
  compliantSites: number;
  nonCompliantWorkers: number;
  trend: { date: string; value: number }[];
  bySite: { site: string; percent: number }[];
}

export default function ComplianceSummary() {
  const { data, isLoading } = useApiQuery<ComplianceStats>(
    ['reports', 'compliance-summary'],
    '/reports/compliance-summary'
  );

  const statCards = [
    { label: 'Overall Compliance', value: `${data?.overallPercent ?? 0}%`, icon: ShieldCheck, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Total Sites', value: data?.totalSites ?? 0, icon: Building2, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Compliant Sites', value: data?.compliantSites ?? 0, icon: ShieldCheck, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Non-Compliant Workers', value: data?.nonCompliantWorkers ?? 0, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Compliance Summary</h1>
          <p className="mt-1 text-sm text-gray-500">
            Platform-wide compliance overview
          </p>
        </div>
        <Button variant="outline" size="sm">
          <Download size={16} />
          Export PDF
        </Button>
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

      {data?.trend && data.trend.length > 0 && (
        <Card>
          <CardContent>
            <TrendLine
              data={data.trend}
              dataKey="value"
              xAxisKey="date"
              color="#10b981"
              height={220}
              label="Compliance Trend (30 days)"
            />
          </CardContent>
        </Card>
      )}

      {data?.bySite && data.bySite.length > 0 && (
        <Card>
          <CardContent>
            <BarChart
              data={data.bySite}
              dataKey="percent"
              xAxisKey="site"
              color="#3b82f6"
              height={280}
              label="Compliance by Site"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
