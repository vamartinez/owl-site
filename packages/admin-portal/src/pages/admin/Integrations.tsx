import { useApiQuery, useApiMutation, useInvalidateQueries } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Plug, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

interface Integration {
  id: string;
  name: string;
  type: string;
  status: 'connected' | 'disconnected' | 'error';
  lastSync: string | null;
  description: string;
}

interface IntegrationsResponse {
  integrations: Integration[];
}

const statusConfig = {
  connected: { variant: 'success' as const, icon: CheckCircle, label: 'Connected' },
  disconnected: { variant: 'default' as const, icon: XCircle, label: 'Disconnected' },
  error: { variant: 'danger' as const, icon: XCircle, label: 'Error' },
};

export default function Integrations() {
  const invalidate = useInvalidateQueries();

  const { data, isLoading } = useApiQuery<IntegrationsResponse>(
    ['admin', 'integrations'],
    '/admin/integrations'
  );

  const { mutate: sync, isPending } = useApiMutation<void, { id: string }>(
    'post',
    (vars) => `/admin/integrations/${vars.id}/sync`,
    { onSuccess: () => invalidate([['admin', 'integrations']]) }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Integrations</h1>
          <p className="mt-1 text-sm text-gray-500">
            External system connections and sync status
          </p>
        </div>
        <Plug size={24} className="text-gray-400" />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {data?.integrations.map((integration) => {
            const config = statusConfig[integration.status];
            return (
              <Card key={integration.id}>
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-gray-100">
                      <Plug size={20} className="text-gray-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900">{integration.name}</p>
                        <Badge variant={config.variant}>{config.label}</Badge>
                      </div>
                      <p className="text-sm text-gray-500">{integration.description}</p>
                      {integration.lastSync && (
                        <p className="text-xs text-gray-400 mt-1">
                          Last sync: {new Date(integration.lastSync).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {integration.status === 'connected' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => sync({ id: integration.id })}
                        disabled={isPending}
                      >
                        <RefreshCw size={14} />
                        Sync
                      </Button>
                    )}
                    <Button
                      variant={integration.status === 'connected' ? 'ghost' : 'primary'}
                      size="sm"
                    >
                      {integration.status === 'connected' ? 'Configure' : 'Connect'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {(!data?.integrations || data.integrations.length === 0) && (
            <p className="text-sm text-gray-500 text-center py-8">No integrations configured</p>
          )}
        </div>
      )}
    </div>
  );
}
