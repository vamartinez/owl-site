import { useState } from 'react';
import { useApiQuery, useApiMutation, useInvalidateQueries } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/charts/StatusBadge';
import { ScanLine, CheckCircle, XCircle } from 'lucide-react';

interface CheckInResult {
  decision: 'allowed' | 'conditional' | 'denied';
  workerName: string;
  reasons: string[];
  missingCerts: string[];
}

interface RecentCheckIn {
  id: string;
  workerName?: string;
  decision: 'allowed' | 'conditional' | 'denied';
  timestamp: string;
  site?: string;
  denialReason?: string;
}

export default function CheckIn() {
  const [workerId, setWorkerId] = useState('');
  const [result, setResult] = useState<CheckInResult | null>(null);
  const invalidate = useInvalidateQueries();

  const { data: recentData } = useApiQuery<{ checkIns: RecentCheckIn[] }>(
    ['site-access', 'recent-checkins'],
    '/site-access/recent-checkins',
    undefined,
    { refetchInterval: 30 * 1000 }
  );

  const { mutate, isPending } = useApiMutation<CheckInResult, { workerId: string }>(
    'post',
    '/site-access/check-in',
    {
      onSuccess: (data) => {
        setResult(data);
        invalidate([['site-access']]);
      },
    }
  );

  const handleCheckIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workerId.trim()) return;
    mutate({ workerId: workerId.trim() });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Site Check-In</h1>
        <p className="mt-1 text-sm text-gray-500">
          Verify worker compliance and grant site access
        </p>
      </div>

      <Card>
        <CardHeader
          title="Worker Check-In"
          description="Enter worker ID or scan badge"
          action={<ScanLine size={20} className="text-primary-600" />}
        />
        <CardContent>
          <form onSubmit={handleCheckIn} className="flex gap-3">
            <div className="flex-1">
              <Input
                value={workerId}
                onChange={(e) => setWorkerId(e.target.value)}
                placeholder="Worker ID or badge number"
                aria-label="Worker ID"
              />
            </div>
            <Button type="submit" disabled={isPending || !workerId.trim()}>
              {isPending ? 'Checking...' : 'Check In'}
            </Button>
          </form>

          {result && (
            <div className={`mt-4 p-4 rounded-lg border ${
              result.decision === 'allowed' ? 'bg-green-50 border-green-200' :
              result.decision === 'conditional' ? 'bg-yellow-50 border-yellow-200' :
              'bg-red-50 border-red-200'
            }`}>
              <div className="flex items-center gap-3 mb-2">
                {result.decision === 'allowed' ? (
                  <CheckCircle size={24} className="text-green-600" />
                ) : result.decision === 'denied' ? (
                  <XCircle size={24} className="text-red-600" />
                ) : (
                  <ScanLine size={24} className="text-yellow-600" />
                )}
                <div>
                  <p className="font-medium text-gray-900">{result.workerName}</p>
                  <StatusBadge status={result.decision} />
                </div>
              </div>
              {result.reasons.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {result.reasons.map((reason, i) => (
                    <li key={i} className="text-sm text-gray-600">• {reason}</li>
                  ))}
                </ul>
              )}
              {result.missingCerts.length > 0 && (
                <div className="mt-2">
                  <p className="text-sm font-medium text-gray-700">Missing certifications:</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {result.missingCerts.map((cert) => (
                      <Badge key={cert} variant="danger">{cert}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Recent Check-Ins" description="Last 10 entries" />
        <CardContent>
          <ul className="space-y-3">
            {recentData?.checkIns.slice(0, 10).map((entry) => (
              <li key={entry.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-gray-900">{entry.workerName || 'Unknown Worker'}</p>
                  <p className="text-gray-500">{entry.site || 'Unknown Site'}</p>
                  {entry.decision === 'denied' && entry.denialReason && (
                    <p className="text-xs text-red-600 mt-0.5">{entry.denialReason}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={entry.decision} />
                  <span className="text-xs text-gray-400">
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </li>
            ))}
            {(!recentData?.checkIns || recentData.checkIns.length === 0) && (
              <li className="text-sm text-gray-500 text-center py-4">No recent check-ins</li>
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
