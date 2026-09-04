import { useApiQuery } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Clock } from 'lucide-react';

interface ExpiringCert {
  id: string;
  workerName: string;
  certType: string;
  expiryDate: string;
  daysRemaining: number;
}

interface ExpiringCertsResponse {
  certifications: ExpiringCert[];
  total: number;
}

export function ExpiringCerts() {
  const { data, isLoading } = useApiQuery<ExpiringCertsResponse>(
    ['dashboard', 'expiring-certs'],
    '/dashboard/expiring-certs',
    undefined,
    { refetchInterval: 5 * 60 * 1000 }
  );

  function getUrgencyVariant(days: number) {
    if (days <= 7) return 'danger' as const;
    if (days <= 14) return 'warning' as const;
    return 'info' as const;
  }

  return (
    <Card>
      <CardHeader
        title="Expiring Certifications"
        description="Within 30 days"
        action={<Clock size={20} className="text-yellow-500" />}
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
            {data?.certifications.slice(0, 5).map((cert) => (
              <li key={cert.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-gray-900">{cert.workerName}</p>
                  <p className="text-gray-500">{cert.certType}</p>
                </div>
                <Badge variant={getUrgencyVariant(cert.daysRemaining)}>
                  {cert.daysRemaining}d
                </Badge>
              </li>
            ))}
            {(!data?.certifications || data.certifications.length === 0) && (
              <li className="text-sm text-gray-500 text-center py-4">
                No certifications expiring soon
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
