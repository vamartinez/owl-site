import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useApiMutation, useInvalidateQueries } from '@/hooks/useApi';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { UserPlus, CheckCircle } from 'lucide-react';

interface WorkerFormData {
  legal_name: string;
  preferred_name: string;
  phone: string;
  email: string;
  language_preference: string;
  contractor_id: string;
  primary_site_id: string;
}

export default function WorkerOnboarding() {
  const [success, setSuccess] = useState(false);
  const invalidate = useInvalidateQueries();
  const { error, setError, clearError } = useErrorHandler();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<WorkerFormData>();

  const { mutate, isPending } = useApiMutation<{ id: string }, WorkerFormData>(
    'post',
    '/workers',
    {
      onSuccess: () => {
        setSuccess(true);
        clearError();
        invalidate([['workers']]);
        reset();
        setTimeout(() => setSuccess(false), 3000);
      },
      onError: (err) => {
        setError(err);
      },
    }
  );

  const onSubmit = (data: WorkerFormData) => {
    clearError();
    mutate(data);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Worker Onboarding</h1>
          <p className="mt-1 text-sm text-gray-500">
            Register a new worker in the compliance platform
          </p>
        </div>
        <Badge variant="info">
          <UserPlus size={14} className="mr-1" />
          New Registration
        </Badge>
      </div>

      {success && (
        <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg">
          <CheckCircle size={20} className="text-green-600" />
          <p className="text-sm text-green-700">Worker registered successfully</p>
        </div>
      )}

      <ErrorDisplay
        error={error ? new Error(error.message) : null}
        title={error?.title}
        variant="banner"
        onDismiss={clearError}
        debugInfo={error?.debugInfo}
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader title="Personal Information" description="Worker identity details" />
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Legal Name"
                {...register('legal_name', { required: 'Legal name is required' })}
                error={errors.legal_name?.message}
                placeholder="Full legal name"
              />
              <Input
                label="Preferred Name"
                {...register('preferred_name')}
                placeholder="Preferred name (optional)"
              />
              <Input
                label="Phone"
                type="tel"
                {...register('phone', { required: 'Phone is required' })}
                error={errors.phone?.message}
                placeholder="+1 (555) 000-0000"
              />
              <Input
                label="Email"
                type="email"
                {...register('email')}
                placeholder="worker@email.com (optional)"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Identification" description="Government-issued ID" />
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label="Language Preference"
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'es', label: 'Spanish' },
                  { value: 'pa', label: 'Punjabi' },
                ]}
                placeholder="Select language"
                {...register('language_preference', { required: 'Language is required' })}
                error={errors.language_preference?.message}
              />
              </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Assignment" description="Contractor and site assignment" />
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Contractor ID"
                {...register('contractor_id', { required: 'Contractor is required' })}
                error={errors.contractor_id?.message}
                placeholder="Contractor identifier"
              />
              <Input
                label="Primary Site ID"
                {...register('primary_site_id')}
                placeholder="Primary site (optional)"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => reset()}>
            Reset
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Registering...' : 'Register Worker'}
          </Button>
        </div>
      </form>
    </div>
  );
}
