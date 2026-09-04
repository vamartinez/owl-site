import { useApiQuery } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ShieldX } from 'lucide-react';

interface BlockedEvent {
  id: string;
  workerName: string;
  site: string;
  reason: string;
  timestamp: string;
}

interface BlockedAccessResponse {
  events: BlockedEvent[];
  total: number;
}

export function BlockedAccess() {
  const { data, isLoading } = useApiQuery<BlockedAccessResponse>(
    ['dashboard', 'blocked-access'],
    '/dashboard/blocked-access',
    undefined,
    { refetchInterval: 5 * 60 * 1000 }
  );

  return (
    <Card>
      <CardHeader
        title="Blocked Access"
        description={`${data?.total ?? 0} events today`}
        action={<ShieldX size={20} className="text-red-500" />}
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
            {data?.events.slice(0, 5).map((event) => (
              <li key={event.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-gray-900">{event.workerName}</p>
                  <p className="text-gray-500">{event.site}</p>
                </div>
                <Badge variant="danger">{event.reason}</Badge>
              </li>
            ))}
            {(!data?.events || data.events.length === 0) && (
              <li className="text-sm text-gray-500 text-center py-4">
                No blocked access events
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
