import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useApiQuery, useApiMutation, useInvalidateQueries } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { CheckCircle, Settings } from 'lucide-react';

interface TenantConfigData {
  tenantName: string;
  timezone: string;
  language: string;
  dateFormat: string;
  inactivityTimeoutMinutes: number;
  sessionMaxHours: number;
  enforceStrictCompliance: boolean;
  notifyOnExpiry: boolean;
  expiryWarningDays: number;
}

export default function TenantConfig() {
  const [saved, setSaved] = useState(false);
  const invalidate = useInvalidateQueries();

  const { data, isLoading } = useApiQuery<TenantConfigData>(
    ['admin', 'tenant-config'],
    '/admin/tenant-config'
  );

  const { register, handleSubmit, formState: { errors } } = useForm<TenantConfigData>({
    values: data,
  });

  const { mutate, isPending } = useApiMutation<void, TenantConfigData>(
    'patch',
    '/admin/tenant-config',
    {
      onSuccess: () => {
        invalidate([['admin', 'tenant-config']]);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      },
    }
  );

  const onSubmit = (formData: TenantConfigData) => {
    mutate(formData);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-gray-100 rounded animate-pulse" />
        <div className="h-64 bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Tenant Configuration</h1>
          <p className="mt-1 text-sm text-gray-500">
            Platform-wide settings for your organization
          </p>
        </div>
        <Settings size={24} className="text-gray-400" />
      </div>

      {saved && (
        <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle size={20} className="text-green-600" />
          <p className="text-sm text-green-700">Configuration saved successfully</p>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader title="Organization" />
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Tenant Name"
                {...register('tenantName', { required: 'Name is required' })}
                error={errors.tenantName?.message}
              />
              <Select
                label="Timezone"
                options={[
                  { value: 'America/New_York', label: 'Eastern (US)' },
                  { value: 'America/Chicago', label: 'Central (US)' },
                  { value: 'America/Denver', label: 'Mountain (US)' },
                  { value: 'America/Los_Angeles', label: 'Pacific (US)' },
                  { value: 'America/Mexico_City', label: 'Mexico City' },
                  { value: 'America/Bogota', label: 'Bogota' },
                  { value: 'America/Santiago', label: 'Santiago' },
                ]}
                {...register('timezone')}
              />
              <Select
                label="Language"
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'es', label: 'Spanish' },
                  { value: 'pt', label: 'Portuguese' },
                ]}
                {...register('language')}
              />
              <Select
                label="Date Format"
                options={[
                  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
                  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
                  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
                ]}
                {...register('dateFormat')}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Security" />
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Inactivity Timeout (minutes)"
                type="number"
                {...register('inactivityTimeoutMinutes', { valueAsNumber: true })}
                helperText="Auto-logout after inactivity"
              />
              <Input
                label="Max Session Duration (hours)"
                type="number"
                {...register('sessionMaxHours', { valueAsNumber: true })}
                helperText="Force re-authentication after this period"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Compliance Settings" />
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Expiry Warning (days)"
                type="number"
                {...register('expiryWarningDays', { valueAsNumber: true })}
                helperText="Days before expiry to send notifications"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving...' : 'Save Configuration'}
          </Button>
        </div>
      </form>
    </div>
  );
}
