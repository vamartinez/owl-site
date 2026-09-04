import { useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useApiQuery, useApiMutation, useInvalidateQueries } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { useState } from 'react';
import { CheckCircle } from 'lucide-react';

interface SiteConfigData {
  name: string;
  address: string;
  city: string;
  status: string;
  maxCapacity: number;
  checkInMethod: string;
  autoEnforcement: boolean;
  notifyOnRejection: boolean;
}

export default function SiteConfig() {
  const { id } = useParams<{ id: string }>();
  const [saved, setSaved] = useState(false);
  const invalidate = useInvalidateQueries();

  const { data, isLoading } = useApiQuery<SiteConfigData>(
    ['sites', id!, 'config'],
    `/sites/${id}/config`
  );

  const { register, handleSubmit, formState: { errors } } = useForm<SiteConfigData>({
    values: data,
  });

  const { mutate, isPending } = useApiMutation<void, SiteConfigData>(
    'patch',
    `/sites/${id}/config`,
    {
      onSuccess: () => {
        invalidate([['sites', id!], ['sites', id!, 'config']]);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      },
    }
  );

  const onSubmit = (formData: SiteConfigData) => {
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
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Site Configuration</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage settings for this construction site
        </p>
      </div>

      {saved && (
        <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle size={20} className="text-green-600" />
          <p className="text-sm text-green-700">Configuration saved successfully</p>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader title="General Settings" />
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Site Name"
                {...register('name', { required: 'Name is required' })}
                error={errors.name?.message}
              />
              <Input
                label="Address"
                {...register('address', { required: 'Address is required' })}
                error={errors.address?.message}
              />
              <Input
                label="City"
                {...register('city', { required: 'City is required' })}
                error={errors.city?.message}
              />
              <Select
                label="Status"
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' },
                  { value: 'setup', label: 'Setup' },
                ]}
                {...register('status')}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Access Control" />
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Max Capacity"
                type="number"
                {...register('maxCapacity', { valueAsNumber: true })}
              />
              <Select
                label="Check-In Method"
                options={[
                  { value: 'badge', label: 'Badge Scan' },
                  { value: 'qr', label: 'QR Code' },
                  { value: 'biometric', label: 'Biometric' },
                  { value: 'manual', label: 'Manual Entry' },
                ]}
                {...register('checkInMethod')}
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
