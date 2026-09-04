import { useState, useCallback, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { AlertCircle, Save, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { useRegulatoryData, useSaveRegulatoryData } from './hooks/useRegulatoryData';
import { LegalDisclaimer } from './LegalDisclaimer';
import {
  OshaRecordability,
  OshaCaseOutcome,
  type RegulatoryIndicators,
  type Incident,
} from './types';
import { OSHA_RECORDABILITY_LABELS } from './constants';

// ─── Types ───────────────────────────────────────────────────────────────────

type RegulatoryTab = 'osha' | 'worksafebc';

interface OshaFormData {
  case_identifier: string;
  worker_name: string;
  job_title: string;
  incident_date: string;
  location_within_site: string;
  injury_illness_description: string;
  case_outcome: OshaCaseOutcome | '';
  days_away_from_work: number;
  days_restricted_work: number;
  recordability: OshaRecordability | '';
  is_complete: boolean;
}

interface WorkSafeBCFormData {
  employer_name: string;
  employer_address: string;
  employer_phone: string;
  worksafebc_account_number: string;
  worker_name: string;
  worker_address: string;
  worker_date_of_birth: string;
  worker_occupation: string;
  worker_hire_date: string;
  incident_description: string;
  body_part_affected: string;
  nature_of_injury: string;
  days_shifts_lost: number;
  modified_work_proposal: string;
  worker_earnings_data: string;
  is_complete: boolean;
}

export interface RegulatoryDataFormProps {
  /** The incident to manage regulatory data for */
  incident: Incident;
  /** Which tab to show initially */
  defaultTab?: RegulatoryTab;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const OSHA_CASE_OUTCOME_OPTIONS = [
  { value: OshaCaseOutcome.DEATH, label: 'Death' },
  { value: OshaCaseOutcome.DAYS_AWAY_FROM_WORK, label: 'Days Away from Work' },
  { value: OshaCaseOutcome.RESTRICTED_WORK, label: 'Restricted Work' },
  { value: OshaCaseOutcome.JOB_TRANSFER, label: 'Job Transfer' },
  { value: OshaCaseOutcome.OTHER_RECORDABLE, label: 'Other Recordable Case' },
];

const OSHA_RECORDABILITY_OPTIONS = Object.entries(OSHA_RECORDABILITY_LABELS).map(
  ([value, label]) => ({ value, label })
);

const OSHA_REQUIRED_FIELDS: (keyof OshaFormData)[] = [
  'case_identifier',
  'worker_name',
  'job_title',
  'incident_date',
  'location_within_site',
  'injury_illness_description',
  'case_outcome',
  'recordability',
];

const WORKSAFEBC_REQUIRED_FIELDS: (keyof WorkSafeBCFormData)[] = [
  'employer_name',
  'employer_address',
  'employer_phone',
  'worksafebc_account_number',
  'worker_name',
  'worker_address',
  'worker_date_of_birth',
  'worker_occupation',
  'worker_hire_date',
  'incident_description',
  'body_part_affected',
  'nature_of_injury',
  'days_shifts_lost',
];

const OSHA_DEFAULT_VALUES: OshaFormData = {
  case_identifier: '',
  worker_name: '',
  job_title: '',
  incident_date: '',
  location_within_site: '',
  injury_illness_description: '',
  case_outcome: '',
  days_away_from_work: 0,
  days_restricted_work: 0,
  recordability: '',
  is_complete: false,
};

const WORKSAFEBC_DEFAULT_VALUES: WorkSafeBCFormData = {
  employer_name: '',
  employer_address: '',
  employer_phone: '',
  worksafebc_account_number: '',
  worker_name: '',
  worker_address: '',
  worker_date_of_birth: '',
  worker_occupation: '',
  worker_hire_date: '',
  incident_description: '',
  body_part_affected: '',
  nature_of_injury: '',
  days_shifts_lost: 0,
  modified_work_proposal: '',
  worker_earnings_data: '',
  is_complete: false,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Checks consistency between OSHA recordability classification and
 * the boolean regulatory indicators on the incident.
 * Requirement 11.2: Consistency check.
 */
function getRecordabilityConsistencyWarning(
  recordability: OshaRecordability | '',
  indicators: RegulatoryIndicators
): string | null {
  if (!recordability) return null;

  if (recordability === OshaRecordability.FATALITY && !indicators.fatality) {
    return 'Recordability is set to "Fatality" but the fatality indicator is not active.';
  }
  if (recordability === OshaRecordability.FIRST_AID_ONLY) {
    if (
      indicators.medical_treatment_beyond_first_aid ||
      indicators.hospitalization ||
      indicators.fatality ||
      indicators.amputation ||
      indicators.loss_of_eye
    ) {
      return 'Recordability is "First Aid Only" but medical/hospitalization/fatality indicators are active. This may be inconsistent.';
    }
  }
  if (
    recordability === OshaRecordability.DAYS_AWAY &&
    !indicators.lost_time
  ) {
    return 'Recordability is "Days Away from Work" but the lost time indicator is not active.';
  }
  if (
    recordability === OshaRecordability.MEDICAL_TREATMENT &&
    !indicators.medical_treatment_beyond_first_aid
  ) {
    return 'Recordability is "Medical Treatment" but the medical treatment indicator is not active.';
  }
  return null;
}

function getMissingFields<T extends Record<string, unknown>>(
  data: T,
  requiredFields: (keyof T)[]
): (keyof T)[] {
  return requiredFields.filter((field) => {
    const value = data[field];
    if (typeof value === 'string') return value.trim() === '';
    if (typeof value === 'number') return false; // numbers are always "present"
    return !value;
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * RegulatoryDataForm — tabbed form for OSHA (Form 300/301 fields) and
 * WorkSafeBC (employer report, emergency summary).
 *
 * Supports draft saves without full validation; indicates missing fields visually.
 * Shows OSHA recordability classification selector with consistency check
 * against boolean indicators. Includes LegalDisclaimer component.
 *
 * Requirements: 8.1, 8.3, 9.1, 9.2, 9.3, 10.1, 10.2, 10.4, 11.1, 11.2, 11.3
 */
export function RegulatoryDataForm({
  incident,
  defaultTab = 'osha',
}: RegulatoryDataFormProps) {
  const [activeTab, setActiveTab] = useState<RegulatoryTab>(defaultTab);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: savedData, isLoading } = useRegulatoryData(incident.incident_id);
  const saveMutation = useSaveRegulatoryData();

  // Parse saved data into form defaults
  const oshaDefaults = useMemo<OshaFormData>(() => {
    if (!savedData?.osha_300) return OSHA_DEFAULT_VALUES;
    const d = savedData.osha_300 as Record<string, unknown>;
    return {
      case_identifier: (d.case_identifier as string) || '',
      worker_name: (d.worker_name as string) || '',
      job_title: (d.job_title as string) || '',
      incident_date: (d.incident_date as string) || '',
      location_within_site: (d.location_within_site as string) || '',
      injury_illness_description: (d.injury_illness_description as string) || '',
      case_outcome: (d.case_outcome as OshaCaseOutcome) || '',
      days_away_from_work: (d.days_away_from_work as number) || 0,
      days_restricted_work: (d.days_restricted_work as number) || 0,
      recordability: (d.recordability as OshaRecordability) || '',
      is_complete: (d.is_complete as boolean) || false,
    };
  }, [savedData]);

  const worksafebcDefaults = useMemo<WorkSafeBCFormData>(() => {
    if (!savedData?.worksafebc_employer) return WORKSAFEBC_DEFAULT_VALUES;
    const d = savedData.worksafebc_employer as Record<string, unknown>;
    return {
      employer_name: (d.employer_name as string) || '',
      employer_address: (d.employer_address as string) || '',
      employer_phone: (d.employer_phone as string) || '',
      worksafebc_account_number: (d.worksafebc_account_number as string) || '',
      worker_name: (d.worker_name as string) || '',
      worker_address: (d.worker_address as string) || '',
      worker_date_of_birth: (d.worker_date_of_birth as string) || '',
      worker_occupation: (d.worker_occupation as string) || '',
      worker_hire_date: (d.worker_hire_date as string) || '',
      incident_description: (d.incident_description as string) || '',
      body_part_affected: (d.body_part_affected as string) || '',
      nature_of_injury: (d.nature_of_injury as string) || '',
      days_shifts_lost: (d.days_shifts_lost as number) || 0,
      modified_work_proposal: (d.modified_work_proposal as string) || '',
      worker_earnings_data: (d.worker_earnings_data as string) || '',
      is_complete: (d.is_complete as boolean) || false,
    };
  }, [savedData]);

  // Save handler (draft save — no full validation required)
  const handleSave = useCallback(
    async (type: 'osha_300' | 'worksafebc_employer', data: Record<string, unknown>) => {
      setSaveSuccess(null);
      setSaveError(null);
      try {
        await saveMutation.mutateAsync({
          incidentId: incident.incident_id,
          data: { type, ...data },
        });
        setSaveSuccess(
          type === 'osha_300'
            ? 'OSHA data saved as draft.'
            : 'WorkSafeBC data saved as draft.'
        );
        setTimeout(() => setSaveSuccess(null), 3000);
      } catch {
        setSaveError('Failed to save. Please try again.');
        setTimeout(() => setSaveError(null), 5000);
      }
    },
    [incident.incident_id, saveMutation]
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-1/3" />
            <div className="h-10 bg-gray-200 rounded" />
            <div className="h-10 bg-gray-200 rounded" />
            <div className="h-10 bg-gray-200 rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Legal Disclaimer — Requirement 24.1, 24.2, 24.3 */}
      <LegalDisclaimer requireAcknowledgment variant="inline" />

      {/* Tab Navigation */}
      <div className="border-b border-gray-200" role="tablist" aria-label="Regulatory data tabs">
        <nav className="flex -mb-px space-x-6">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'osha'}
            aria-controls="panel-osha"
            id="tab-osha"
            onClick={() => setActiveTab('osha')}
            className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'osha'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            OSHA (Form 300/301)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'worksafebc'}
            aria-controls="panel-worksafebc"
            id="tab-worksafebc"
            onClick={() => setActiveTab('worksafebc')}
            className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'worksafebc'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            WorkSafeBC
          </button>
        </nav>
      </div>

      {/* Status Messages */}
      {saveSuccess && (
        <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-4 py-2" role="status">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <p className="text-sm text-green-700">{saveSuccess}</p>
        </div>
      )}
      {saveError && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-4 py-2" role="alert">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <p className="text-sm text-red-700">{saveError}</p>
        </div>
      )}

      {/* Tab Panels */}
      {activeTab === 'osha' && (
        <div role="tabpanel" id="panel-osha" aria-labelledby="tab-osha">
          <OshaTab
            defaults={oshaDefaults}
            indicators={incident.regulatory_indicators}
            onSave={(data) => handleSave('osha_300', data as unknown as Record<string, unknown>)}
            isSaving={saveMutation.isPending}
          />
        </div>
      )}
      {activeTab === 'worksafebc' && (
        <div role="tabpanel" id="panel-worksafebc" aria-labelledby="tab-worksafebc">
          <WorkSafeBCTab
            defaults={worksafebcDefaults}
            onSave={(data) => handleSave('worksafebc_employer', data as unknown as Record<string, unknown>)}
            isSaving={saveMutation.isPending}
          />
        </div>
      )}
    </div>
  );
}

// ─── OSHA Tab ────────────────────────────────────────────────────────────────

interface OshaTabProps {
  defaults: OshaFormData;
  indicators: RegulatoryIndicators;
  onSave: (data: OshaFormData) => void;
  isSaving: boolean;
}

function OshaTab({ defaults, indicators, onSave, isSaving }: OshaTabProps) {
  const { register, handleSubmit, control, watch } = useForm<OshaFormData>({
    defaultValues: defaults,
  });

  const formValues = watch();
  const missingFields = getMissingFields(formValues as unknown as Record<string, unknown>, OSHA_REQUIRED_FIELDS);
  const consistencyWarning = getRecordabilityConsistencyWarning(
    formValues.recordability as OshaRecordability | '',
    indicators
  );

  const handleDraftSave = (data: OshaFormData) => {
    onSave({ ...data, is_complete: missingFields.length === 0 });
  };

  return (
    <Card>
      <CardHeader
        title="OSHA Form 300/301 Data"
        description="Capture fields for OSHA recording. Save as draft at any time."
        action={
          missingFields.length > 0 ? (
            <Badge variant="warning">{missingFields.length} fields missing</Badge>
          ) : (
            <Badge variant="success">Complete</Badge>
          )
        }
      />
      <CardContent>
        <form onSubmit={handleSubmit(handleDraftSave)} className="space-y-4">

          {/* Recordability Classification — Requirement 11.1, 11.2 */}
          <div className="rounded-md border border-blue-200 bg-blue-50 p-4 space-y-3">
            <h4 className="text-sm font-semibold text-blue-900">
              OSHA Recordability Classification
            </h4>
            <Controller
              name="recordability"
              control={control}
              render={({ field }) => (
                <Select
                  label="Recordability"
                  options={OSHA_RECORDABILITY_OPTIONS}
                  placeholder="Select classification"
                  {...field}
                  value={field.value || ''}
                  className={isMissing('recordability', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
                />
              )}
            />
            {consistencyWarning && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-300 px-3 py-2">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-800">{consistencyWarning}</p>
              </div>
            )}
          </div>

          {/* Case Information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Case Identifier"
              placeholder="e.g., 2024-001"
              {...register('case_identifier')}
              className={isMissing('case_identifier', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
            />
            <Input
              label="Worker Name"
              placeholder="Full name of affected worker"
              {...register('worker_name')}
              className={isMissing('worker_name', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Job Title"
              placeholder="Worker's job title/position"
              {...register('job_title')}
              className={isMissing('job_title', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
            />
            <Input
              label="Incident Date"
              type="date"
              {...register('incident_date')}
              className={isMissing('incident_date', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
            />
          </div>

          <Input
            label="Location Within Site"
            placeholder="Specific area where incident occurred"
            {...register('location_within_site')}
            className={isMissing('location_within_site', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
          />

          <div className="space-y-1">
            <label htmlFor="osha-description" className="block text-sm font-medium text-gray-700">
              Injury/Illness Description
            </label>
            <textarea
              id="osha-description"
              rows={3}
              placeholder="Describe the injury or illness"
              className={`block w-full rounded-md border px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500 ${
                isMissing('injury_illness_description', missingFields)
                  ? 'border-amber-400 bg-amber-50'
                  : 'border-gray-300'
              }`}
              {...register('injury_illness_description')}
            />
          </div>

          {/* Case Outcome — Requirement 10.2 */}
          <Controller
            name="case_outcome"
            control={control}
            render={({ field }) => (
              <Select
                label="Case Outcome"
                options={OSHA_CASE_OUTCOME_OPTIONS}
                placeholder="Select case outcome"
                {...field}
                value={field.value || ''}
                className={isMissing('case_outcome', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
              />
            )}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Controller
              name="days_away_from_work"
              control={control}
              render={({ field }) => (
                <Input
                  label="Days Away from Work"
                  type="number"
                  min={0}
                  value={field.value}
                  onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                />
              )}
            />
            <Controller
              name="days_restricted_work"
              control={control}
              render={({ field }) => (
                <Input
                  label="Days with Restricted Work/Transfer"
                  type="number"
                  min={0}
                  value={field.value}
                  onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                />
              )}
            />
          </div>

          {/* Missing Fields Indicator */}
          {missingFields.length > 0 && (
            <MissingFieldsNotice fields={missingFields as string[]} />
          )}

          {/* Save Button */}
          <div className="flex justify-end pt-4 border-t border-gray-200">
            <Button type="submit" disabled={isSaving} size="md">
              <Save className="h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Draft'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── WorkSafeBC Tab ──────────────────────────────────────────────────────────

interface WorkSafeBCTabProps {
  defaults: WorkSafeBCFormData;
  onSave: (data: WorkSafeBCFormData) => void;
  isSaving: boolean;
}

function WorkSafeBCTab({ defaults, onSave, isSaving }: WorkSafeBCTabProps) {
  const { register, handleSubmit, control, watch } = useForm<WorkSafeBCFormData>({
    defaultValues: defaults,
  });

  const formValues = watch();
  const missingFields = getMissingFields(formValues as unknown as Record<string, unknown>, WORKSAFEBC_REQUIRED_FIELDS);

  const handleDraftSave = (data: WorkSafeBCFormData) => {
    onSave({ ...data, is_complete: missingFields.length === 0 });
  };

  return (
    <Card>
      <CardHeader
        title="WorkSafeBC Employer Report"
        description="Capture employer injury/illness report data. Save as draft at any time."
        action={
          missingFields.length > 0 ? (
            <Badge variant="warning">{missingFields.length} fields missing</Badge>
          ) : (
            <Badge variant="success">Complete</Badge>
          )
        }
      />
      <CardContent>
        <form onSubmit={handleSubmit(handleDraftSave)} className="space-y-6">

          {/* Employer Information — Requirement 9.1 */}
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-gray-900 border-b border-gray-200 pb-2 w-full">
              Employer Information
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Employer Name"
                placeholder="Company name"
                {...register('employer_name')}
                className={isMissing('employer_name', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
              />
              <Input
                label="Phone"
                type="tel"
                placeholder="Contact phone number"
                {...register('employer_phone')}
                className={isMissing('employer_phone', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
              />
            </div>
            <Input
              label="Address"
              placeholder="Employer address"
              {...register('employer_address')}
              className={isMissing('employer_address', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
            />
            <Input
              label="WorkSafeBC Account Number"
              placeholder="Account number"
              {...register('worksafebc_account_number')}
              className={isMissing('worksafebc_account_number', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
            />
          </fieldset>

          {/* Worker Information — Requirement 9.1 */}
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-gray-900 border-b border-gray-200 pb-2 w-full">
              Worker Information
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Worker Name"
                placeholder="Full name"
                {...register('worker_name')}
                className={isMissing('worker_name', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
              />
              <Input
                label="Date of Birth"
                type="date"
                {...register('worker_date_of_birth')}
                className={isMissing('worker_date_of_birth', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
              />
            </div>
            <Input
              label="Address"
              placeholder="Worker address"
              {...register('worker_address')}
              className={isMissing('worker_address', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Occupation"
                placeholder="Worker's occupation"
                {...register('worker_occupation')}
                className={isMissing('worker_occupation', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
              />
              <Input
                label="Hire Date"
                type="date"
                {...register('worker_hire_date')}
                className={isMissing('worker_hire_date', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
              />
            </div>
          </fieldset>

          {/* Incident Details — Requirement 9.1 */}
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-gray-900 border-b border-gray-200 pb-2 w-full">
              Incident Details
            </legend>
            <div className="space-y-1">
              <label htmlFor="wsbc-description" className="block text-sm font-medium text-gray-700">
                Incident Description
              </label>
              <textarea
                id="wsbc-description"
                rows={3}
                placeholder="Detailed description of the incident"
                className={`block w-full rounded-md border px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500 ${
                  isMissing('incident_description', missingFields)
                    ? 'border-amber-400 bg-amber-50'
                    : 'border-gray-300'
                }`}
                {...register('incident_description')}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Body Part Affected"
                placeholder="e.g., left hand, lower back"
                {...register('body_part_affected')}
                className={isMissing('body_part_affected', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
              />
              <Input
                label="Nature of Injury"
                placeholder="e.g., fracture, laceration"
                {...register('nature_of_injury')}
                className={isMissing('nature_of_injury', missingFields) ? 'border-amber-400 bg-amber-50' : ''}
              />
            </div>

            <Controller
              name="days_shifts_lost"
              control={control}
              render={({ field }) => (
                <Input
                  label="Days/Shifts Lost"
                  type="number"
                  min={0}
                  value={field.value}
                  onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                />
              )}
            />
          </fieldset>

          {/* Optional Fields */}
          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-gray-900 border-b border-gray-200 pb-2 w-full">
              Additional Information (Optional)
            </legend>
            <div className="space-y-1">
              <label htmlFor="wsbc-modified-work" className="block text-sm font-medium text-gray-700">
                Modified/Transitional Work Proposal
              </label>
              <textarea
                id="wsbc-modified-work"
                rows={2}
                placeholder="Describe any modified work arrangements"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
                {...register('modified_work_proposal')}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="wsbc-earnings" className="block text-sm font-medium text-gray-700">
                Worker Earnings Data
              </label>
              <textarea
                id="wsbc-earnings"
                rows={2}
                placeholder="Relevant earnings information"
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
                {...register('worker_earnings_data')}
              />
            </div>
          </fieldset>

          {/* Missing Fields Indicator */}
          {missingFields.length > 0 && (
            <MissingFieldsNotice fields={missingFields as string[]} />
          )}

          {/* Save Button */}
          <div className="flex justify-end pt-4 border-t border-gray-200">
            <Button type="submit" disabled={isSaving} size="md">
              <Save className="h-4 w-4" />
              {isSaving ? 'Saving...' : 'Save Draft'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── Shared Helper Components ────────────────────────────────────────────────

/**
 * Visual indicator for missing required fields.
 * Requirement 8.3, 9.3, 10.4: Indicate missing fields visually.
 */
function MissingFieldsNotice({ fields }: { fields: string[] }) {
  const formatFieldName = (field: string) =>
    field
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-amber-800">
            Missing required fields ({fields.length})
          </p>
          <ul className="mt-1 text-xs text-amber-700 list-disc list-inside space-y-0.5">
            {fields.map((field) => (
              <li key={field}>{formatFieldName(field)}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-600 italic">
            You can save as a draft and complete these fields later.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Checks if a field is in the missing fields list.
 */
function isMissing(field: string, missingFields: (string | number | symbol)[]): boolean {
  return missingFields.includes(field);
}
