import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';

import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Combobox } from '@/components/ui/Combobox';
import { apiClient } from '@/services/api-client';
import { useCreateIncident } from './hooks/useCreateIncident';
import { useSiteSearch, formatSiteLabel, type Site } from './hooks/useSiteSearch';
import { useWorkerSearch } from './hooks/useWorkerSearch';
import { incidentCreateSchema, type IncidentCreateFormData } from './schemas';
import { buildCreateIncidentPayload } from './buildCreateIncidentPayload';
import {
  IncidentType,
  OperationalSeverity,
  type RegulatoryEvaluationResult,
} from './types';
import {
  INCIDENT_TYPE_LABELS,
  SEVERITY_LABELS,
  REGULATORY_INDICATOR_LABELS,
} from './constants';

// ─── Select Options ──────────────────────────────────────────────────────────

const INCIDENT_TYPE_OPTIONS = Object.entries(INCIDENT_TYPE_LABELS).map(
  ([value, label]) => ({ value, label })
);

const SEVERITY_OPTIONS = Object.entries(SEVERITY_LABELS).map(
  ([value, label]) => ({ value, label })
);

const JURISDICTION_OPTIONS = [
  { value: 'british_columbia', label: 'British Columbia' },
  { value: 'alberta', label: 'Alberta' },
  { value: 'ontario', label: 'Ontario' },
  { value: 'quebec', label: 'Quebec' },
  { value: 'other_canadian', label: 'Other Canadian Province' },
  { value: 'us_state', label: 'US State' },
];

// ─── Props ───────────────────────────────────────────────────────────────────

interface IncidentCreateFormProps {
  /** Site ID to associate the incident with */
  siteId?: string;
  /** Whether the site has a configured jurisdiction (skips jurisdiction selector if true) */
  siteJurisdiction?: string;
  /** Callback when incident is successfully created */
  onSuccess?: (result: { incident_id: string; regulatoryResult: RegulatoryEvaluationResult }) => void;
  /** Callback when form is cancelled */
  onCancel?: () => void;
}

// ─── Regulatory Indicator Keys ───────────────────────────────────────────────

const REGULATORY_INDICATOR_KEYS = [
  'medical_treatment_beyond_first_aid',
  'lost_time',
  'hospitalization',
  'fatality',
  'amputation',
  'loss_of_eye',
  'structural_collapse',
  'hazardous_substance_release',
  'fire_or_explosion',
] as const;

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Multi-step incident creation form.
 * Uses react-hook-form with zodResolver for validation.
 * Responsive design adapting to 320px minimum width.
 * Supports camera capture via media capture API on mobile.
 *
 * Requirements: 1.1, 1.3, 2.2, 3.1, 3.2, 3.3, 22.1, 22.2, 22.3, 23.3
 */
export function IncidentCreateForm({
  siteId,
  siteJurisdiction,
  onSuccess,
  onCancel,
}: IncidentCreateFormProps) {
  const [apiError, setApiError] = useState<string | null>(null);
  const [capturedPhotos, setCapturedPhotos] = useState<File[]>([]);
  const [siteSearchQuery, setSiteSearchQuery] = useState('');
  const [workerSearchQuery, setWorkerSearchQuery] = useState('');

  const createIncidentMutation = useCreateIncident();
  const siteSearch = useSiteSearch(siteSearchQuery);
  const workerSearch = useWorkerSearch(workerSearchQuery);

  // Fetch the initial site by ID when siteId prop is provided (for displaying the site name)
  const { data: initialSite } = useQuery<Site>({
    queryKey: ['site', siteId],
    queryFn: async () => {
      const response = await apiClient.get<{ site: Site }>(`/sites/${siteId}`);
      return response.site;
    },
    enabled: !!siteId,
    staleTime: Infinity,
  });

  // Build options for the site combobox, merging the initial site if needed
  const siteOptions = (() => {
    if (initialSite && !siteSearch.options.some((opt) => opt.value === initialSite.id)) {
      return [
        { value: initialSite.id, label: formatSiteLabel(initialSite) },
        ...siteSearch.options,
      ];
    }
    return siteSearch.options;
  })();

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<IncidentCreateFormData>({
    resolver: zodResolver(incidentCreateSchema) as any,
    defaultValues: {
      title: '',
      description: '',
      incident_type: undefined,
      other_type_description: undefined,
      incident_datetime: '',
      site_id: siteId || '',
      worker_id: undefined,
      location: '',
      persons_involved_count: 0,
      severity: undefined,
      jurisdiction: siteJurisdiction || undefined,
      regulatory_indicators: {
        medical_treatment_beyond_first_aid: false,
        lost_time: false,
        hospitalization: false,
        fatality: false,
        amputation: false,
        loss_of_eye: false,
        structural_collapse: false,
        hazardous_substance_release: false,
        fire_or_explosion: false,
      },
    },
  });

  const watchedIncidentType = watch('incident_type');
  const showJurisdictionSelector = !siteJurisdiction;

  // ─── Camera Capture ──────────────────────────────────────────────────────

  const handleCameraCapture = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setCapturedPhotos((prev) => [...prev, ...Array.from(files)]);
    }
  };

  const removeCapturedPhoto = (index: number) => {
    setCapturedPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  // ─── Form Submission ─────────────────────────────────────────────────────

  const onSubmit = async (data: IncidentCreateFormData) => {
    setApiError(null);
    try {
      const payload = buildCreateIncidentPayload(data);

      const result = await createIncidentMutation.mutateAsync(payload);
      onSuccess?.({
        incident_id: result.incident.incident_id,
        regulatoryResult: result.regulatory_result,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.';
      setApiError(message);
    }
  };

  // ─── Step Rendering ──────────────────────────────────────────────────────

  const renderBasicInfoStep = () => (
    <div className="space-y-4">
      <Input
        label="Title"
        placeholder="Brief incident title"
        error={errors.title?.message}
        {...register('title')}
      />

      <div className="space-y-1">
        <label htmlFor="description" className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          id="description"
          rows={4}
          placeholder="Detailed description of the incident"
          aria-invalid={!!errors.description}
          className={`
            block w-full rounded-md border px-3 py-2 text-sm shadow-sm
            transition-colors focus:outline-none focus:ring-1
            ${errors.description
              ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
            }
          `}
          {...register('description')}
        />
        {errors.description?.message && (
          <p className="text-xs text-red-600" role="alert">
            {errors.description.message}
          </p>
        )}
      </div>

      <Input
        label="Incident Date/Time"
        type="datetime-local"
        error={errors.incident_datetime?.message}
        {...register('incident_datetime')}
      />

      <Controller
        name="site_id"
        control={control}
        render={({ field }) => (
          <Combobox
            label="Site"
            placeholder="Search for a site..."
            value={field.value || undefined}
            onChange={(val) => field.onChange(val ?? '')}
            options={siteOptions}
            onSearchChange={setSiteSearchQuery}
            isLoading={siteSearch.isLoading}
            isError={siteSearch.isError}
            errorMessage="Unable to load sites. Please try again."
            emptyMessage="No sites found"
            error={errors.site_id?.message}
          />
        )}
      />

      <Controller
        name="worker_id"
        control={control}
        render={({ field }) => (
          <Combobox
            label="Worker (Optional)"
            placeholder="Search for a worker..."
            value={field.value}
            onChange={(val) => field.onChange(val ?? undefined)}
            options={workerSearch.options}
            onSearchChange={setWorkerSearchQuery}
            isLoading={workerSearch.isLoading}
            isError={workerSearch.isError}
            errorMessage="Unable to load workers. Please try again."
            emptyMessage="No workers found"
          />
        )}
      />

      <Input
        label="Location"
        placeholder="Specific location within the site"
        error={errors.location?.message}
        {...register('location')}
      />

      <Controller
        name="persons_involved_count"
        control={control}
        render={({ field }) => (
          <Input
            label="Number of Persons Involved"
            type="number"
            min={0}
            error={errors.persons_involved_count?.message}
            value={field.value ?? 0}
            onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
            onBlur={field.onBlur}
            ref={field.ref}
          />
        )}
      />

      {/* Camera capture for mobile devices */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Quick Photo Capture (Optional)
        </label>
        <div className="flex flex-wrap gap-2">
          <label
            htmlFor="camera-capture"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-700 bg-primary-50 rounded-md cursor-pointer hover:bg-primary-100 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Take Photo
          </label>
          <input
            id="camera-capture"
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={handleCameraCapture}
            aria-label="Capture photo from camera"
          />
        </div>
        {capturedPhotos.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {capturedPhotos.map((photo, index) => (
              <div key={index} className="relative">
                <div className="w-16 h-16 rounded border border-gray-200 bg-gray-50 flex items-center justify-center text-xs text-gray-500 overflow-hidden">
                  <img
                    src={URL.createObjectURL(photo)}
                    alt={`Captured photo ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeCapturedPhoto(index)}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center"
                  aria-label={`Remove photo ${index + 1}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-500">
          Photos captured here will be available for upload after the incident is created.
        </p>
      </div>
    </div>
  );

  const renderClassificationStep = () => (
    <div className="space-y-4">
      <Controller
        name="incident_type"
        control={control}
        render={({ field }) => (
          <Select
            label="Incident Type"
            options={INCIDENT_TYPE_OPTIONS}
            placeholder="Select incident type"
            error={errors.incident_type?.message}
            {...field}
          />
        )}
      />

      {watchedIncidentType === IncidentType.OTHER && (
        <div className="space-y-1">
          <label htmlFor="other-type-description" className="block text-sm font-medium text-gray-700">
            Custom Type Description
          </label>
          <textarea
            id="other-type-description"
            rows={3}
            placeholder="Describe the incident type (minimum 10 characters)"
            aria-invalid={!!errors.other_type_description}
            className={`
              block w-full rounded-md border px-3 py-2 text-sm shadow-sm
              transition-colors focus:outline-none focus:ring-1
              ${errors.other_type_description
                ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
              }
            `}
            {...register('other_type_description')}
          />
          {errors.other_type_description?.message && (
            <p className="text-xs text-red-600" role="alert">
              {errors.other_type_description.message}
            </p>
          )}
        </div>
      )}

      <Controller
        name="severity"
        control={control}
        render={({ field }) => (
          <Select
            label="Operational Severity"
            options={SEVERITY_OPTIONS}
            placeholder="Select severity level"
            error={errors.severity?.message}
            {...field}
          />
        )}
      />

      {showJurisdictionSelector && (
        <Controller
          name="jurisdiction"
          control={control}
          render={({ field }) => (
            <Select
              label="Jurisdiction"
              options={JURISDICTION_OPTIONS}
              placeholder="Select applicable jurisdiction"
              error={errors.jurisdiction?.message}
              {...field}
              value={field.value || ''}
            />
          )}
        />
      )}
    </div>
  );

  const renderRegulatoryStep = () => (
    <div className="space-y-4">
      <div className="rounded-md bg-amber-50 border border-amber-200 p-3 mb-4">
        <p className="text-sm text-amber-800">
          Select all indicators that apply to this incident. These are used to determine
          potential regulatory reporting obligations. All default to "No".
        </p>
      </div>

      <div className="space-y-3">
        {REGULATORY_INDICATOR_KEYS.map((key) => (
          <Controller
            key={key}
            name={`regulatory_indicators.${key}`}
            control={control}
            render={({ field }) => (
              <label
                className="flex items-center gap-3 p-3 rounded-md border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors"
                htmlFor={`indicator-${key}`}
              >
                <input
                  id={`indicator-${key}`}
                  type="checkbox"
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700">
                  {REGULATORY_INDICATOR_LABELS[key]}
                </span>
              </label>
            )}
          />
        ))}
      </div>
    </div>
  );

  // ─── Main Render ─────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-2xl mx-auto px-4 sm:px-0">
      <Card>
        <CardHeader
          title="Report New Incident"
          description="Fill in the details below"
        />
        <CardContent>
          {apiError && (
            <div className="rounded-md bg-red-50 p-3 mb-4" role="alert">
              <p className="text-sm text-red-700">{apiError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit as any)} noValidate>
            {renderBasicInfoStep()}
            {renderClassificationStep()}
            {renderRegulatoryStep()}

            {/* Form Buttons */}
            <div className="flex flex-col-reverse sm:flex-row justify-between gap-3 pt-6 mt-6 border-t border-gray-200">
              <div className="flex gap-2">
                {onCancel && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={onCancel}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                )}
              </div>

              <div>
                <Button
                  type="submit"
                  disabled={isSubmitting || createIncidentMutation.isPending}
                  className="w-full sm:w-auto"
                >
                  {isSubmitting || createIncidentMutation.isPending
                    ? 'Submitting...'
                    : 'Submit Incident Report'}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
