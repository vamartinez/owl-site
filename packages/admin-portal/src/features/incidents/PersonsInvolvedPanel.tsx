import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { apiClient, ApiClientError } from '@/services/api-client';
import { personSchema, type PersonFormData } from './schemas';
import { InvolvementType, type InvolvedPerson } from './types';
import { INVOLVEMENT_TYPE_LABELS } from './constants';

// ─── Select Options ──────────────────────────────────────────────────────────

const INVOLVEMENT_TYPE_OPTIONS = Object.entries(INVOLVEMENT_TYPE_LABELS).map(
  ([value, label]) => ({ value, label })
);

// ─── Props ───────────────────────────────────────────────────────────────────

interface PersonsInvolvedPanelProps {
  /** Incident ID to manage persons for */
  incidentId: string;
  /** Whether the panel is read-only (e.g., closed incidents) */
  readOnly?: boolean;
}

// ─── API Response Types ──────────────────────────────────────────────────────

interface PersonsApiResponse {
  persons: InvolvedPerson[];
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Panel for managing persons involved in an incident.
 * Supports adding and removing persons with role selection.
 * Uses personSchema for validation and apiClient for API calls.
 *
 * Requirements: 13.1, 13.2, 13.3
 */
export function PersonsInvolvedPanel({ incidentId, readOnly = false }: PersonsInvolvedPanelProps) {
  const [showForm, setShowForm] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // ─── Fetch Persons ─────────────────────────────────────────────────────────

  const {
    data: persons = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<InvolvedPerson[], ApiClientError>({
    queryKey: ['incidents', incidentId, 'persons'],
    queryFn: async () => {
      const response = await apiClient.get<PersonsApiResponse>(
        `/incidents/${incidentId}/persons`
      );
      return response.persons;
    },
    enabled: !!incidentId,
    retry: (failureCount, error) => {
      if (error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });

  // ─── Add Person Mutation ───────────────────────────────────────────────────

  const addPersonMutation = useMutation<InvolvedPerson, ApiClientError, PersonFormData>({
    mutationFn: async (data) => {
      return apiClient.post<InvolvedPerson>(
        `/incidents/${incidentId}/persons`,
        data
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'persons'] });
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'timeline'] });
      setShowForm(false);
      setApiError(null);
      reset();
    },
    onError: (error) => {
      setApiError(error.message);
    },
  });

  // ─── Remove Person Mutation ────────────────────────────────────────────────

  const removePersonMutation = useMutation<void, ApiClientError, string>({
    mutationFn: async (personId) => {
      return apiClient.delete<void>(
        `/incidents/${incidentId}/persons/${personId}`
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'persons'] });
      queryClient.invalidateQueries({ queryKey: ['incidents', incidentId, 'timeline'] });
    },
    onError: (error) => {
      setApiError(error.message);
    },
  });

  // ─── Form Setup ────────────────────────────────────────────────────────────

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PersonFormData>({
    resolver: zodResolver(personSchema),
    defaultValues: {
      full_name: '',
      involvement_type: undefined,
      organization: '',
      worker_id: '',
    },
  });

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const onSubmit = (data: PersonFormData) => {
    setApiError(null);
    // Strip empty worker_id before sending
    const payload: PersonFormData = {
      ...data,
      worker_id: data.worker_id?.trim() || undefined,
    };
    addPersonMutation.mutate(payload);
  };

  const handleRemovePerson = (personId: string) => {
    removePersonMutation.mutate(personId);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setApiError(null);
    reset();
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader
        title="Persons Involved"
        description="People associated with this incident"
        action={
          !readOnly && !showForm ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowForm(true)}
            >
              Add Person
            </Button>
          ) : undefined
        }
      />
      <CardContent>
        {/* Error Display */}
        {apiError && (
          <div className="rounded-md bg-red-50 p-3 mb-4" role="alert">
            <p className="text-sm text-red-700">{apiError}</p>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="animate-pulse flex items-center gap-3 p-3 rounded-md border border-gray-100">
                <div className="h-4 bg-gray-200 rounded w-1/3" />
                <div className="h-4 bg-gray-200 rounded w-1/4" />
                <div className="h-4 bg-gray-200 rounded w-1/4" />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {isError && !isLoading && (
          <div className="text-center py-4">
            <p className="text-sm text-gray-500 mb-2">Failed to load persons involved.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        )}

        {/* Persons List */}
        {!isLoading && !isError && (
          <div className="space-y-2">
            {persons.length === 0 && !showForm && (
              <p className="text-sm text-gray-500 italic py-2">
                No persons have been added to this incident yet.
              </p>
            )}

            {persons.map((person) => (
              <div
                key={person.person_id}
                className="flex items-center justify-between p-3 rounded-md border border-gray-200 bg-gray-50"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {person.full_name}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
                    <span className="text-xs text-gray-600">
                      {INVOLVEMENT_TYPE_LABELS[person.involvement_type]}
                    </span>
                    <span className="text-xs text-gray-500">
                      {person.organization}
                    </span>
                    {person.worker_id && (
                      <span className="text-xs text-primary-600">
                        ID: {person.worker_id}
                      </span>
                    )}
                  </div>
                </div>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemovePerson(person.person_id)}
                    disabled={removePersonMutation.isPending}
                    aria-label={`Remove ${person.full_name}`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4 text-red-500"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add Person Form */}
        {showForm && (
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="mt-4 p-4 rounded-md border border-gray-200 bg-white space-y-4"
            noValidate
          >
            <Input
              label="Full Name"
              placeholder="Enter full name"
              error={errors.full_name?.message}
              {...register('full_name')}
            />

            <Controller
              name="involvement_type"
              control={control}
              render={({ field }) => (
                <Select
                  label="Involvement Type"
                  options={INVOLVEMENT_TYPE_OPTIONS}
                  placeholder="Select role"
                  error={errors.involvement_type?.message}
                  {...field}
                />
              )}
            />

            <Input
              label="Organization"
              placeholder="Enter organization name"
              error={errors.organization?.message}
              {...register('organization')}
            />

            <Input
              label="Worker ID (Optional)"
              placeholder="ClearSite worker identifier"
              helperText="If the person exists in ClearSite, enter their worker ID to link the record."
              error={errors.worker_id?.message}
              {...register('worker_id')}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCancelForm}
                disabled={isSubmitting || addPersonMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting || addPersonMutation.isPending}
              >
                {addPersonMutation.isPending ? 'Adding...' : 'Add Person'}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
