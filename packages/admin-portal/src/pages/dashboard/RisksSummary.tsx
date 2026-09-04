import { useApiQuery } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { StatusBadge } from '@/components/charts/StatusBadge';
import { AlertTriangle } from 'lucide-react';

interface Risk {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  site: string;
  createdAt: string;
}

interface RisksResponse {
  risks: Risk[];
  total: number;
}

export function RisksSummary() {
  const { data, isLoading } = useApiQuery<RisksResponse>(
    ['dashboard', 'risks'],
    '/dashboard/risks',
    undefined,
    { refetchInterval: 5 * 60 * 1000 }
  );

  return (
    <Card>
      <CardHeader
        title="Open Risks"
        description={`${data?.total ?? 0} unresolved`}
        action={<AlertTriangle size={20} className="text-orange-500" />}
      />
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <ul className="space-y-3">
            {data?.risks.slice(0, 5).map((risk) => (
              <li key={risk.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-gray-900">{risk.title}</p>
                  <p className="text-gray-500">{risk.site}</p>
                </div>
                <StatusBadge status={risk.severity} />
              </li>
            ))}
            {(!data?.risks || data.risks.length === 0) && (
              <li className="text-sm text-gray-500 text-center py-4">
                No open risks
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
