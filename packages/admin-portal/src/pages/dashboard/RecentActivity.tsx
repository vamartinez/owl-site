import { useApiQuery } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Activity } from 'lucide-react';

type ActivityType = 'access_granted' | 'access_denied' | 'finding_generated' | 'cert_uploaded' | 'enforcement_created';

interface ActivityEvent {
  id: string;
  type: ActivityType;
  description: string;
  actor: string;
  timestamp: string;
}

interface RecentActivityResponse {
  activities: ActivityEvent[];
}

const activityVariants: Record<ActivityType, 'success' | 'danger' | 'warning' | 'info' | 'purple'> = {
  access_granted: 'success',
  access_denied: 'danger',
  finding_generated: 'warning',
  cert_uploaded: 'info',
  enforcement_created: 'purple',
};

const activityLabels: Record<ActivityType, string> = {
  access_granted: 'Access',
  access_denied: 'Denied',
  finding_generated: 'Finding',
  cert_uploaded: 'Cert',
  enforcement_created: 'Action',
};

export function RecentActivity() {
  const { data, isLoading } = useApiQuery<RecentActivityResponse>(
    ['dashboard', 'recent-activity'],
    '/dashboard/recent-activity',
    undefined,
    { refetchInterval: 5 * 60 * 1000 }
  );

  function formatTime(timestamp: string) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <Card>
      <CardHeader
        title="Recent Activity"
        action={<Activity size={20} className="text-blue-500" />}
      />
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <ul className="space-y-3">
            {data?.activities.slice(0, 8).map((activity) => (
              <li key={activity.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={activityVariants[activity.type]}>
                    {activityLabels[activity.type]}
                  </Badge>
                  <span className="text-gray-700">{activity.description}</span>
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap">
                  {formatTime(activity.timestamp)}
                </span>
              </li>
            ))}
            {(!data?.activities || data.activities.length === 0) && (
              <li className="text-sm text-gray-500 text-center py-4">
                No recent activity
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
