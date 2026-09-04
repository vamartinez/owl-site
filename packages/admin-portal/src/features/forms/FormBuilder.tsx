import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardContent } from '@/components/ui/Card';
import { useFormQuery } from './hooks/useFormQuery';
import { useUpdateForm } from './hooks/useUpdateForm';
import { useCreateForm } from './hooks/useCreateForm';
import {
  FieldType,
  type FieldConfig,
  type FieldValidation,
  type UpdateFormRequest,
} from './types';
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Save,
  AlertCircle,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_FIELDS = 50;

const FIELD_TYPE_OPTIONS = [
  { value: FieldType.TEXTO_CORTO, label: 'Short text' },
  { value: FieldType.TEXTO_LARGO, label: 'Long text' },
  { value: FieldType.NUMERO, label: 'Number' },
  { value: FieldType.FECHA, label: 'Date' },
  { value: FieldType.SELECCION_SIMPLE, label: 'Single choice' },
  { value: FieldType.SELECCION_MULTIPLE, label: 'Multiple choice' },
  { value: FieldType.CHECKBOX_ACEPTACION, label: 'Acceptance checkbox' },
  { value: FieldType.CARGA_ARCHIVO, label: 'File upload' },
];

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  [FieldType.TEXTO_CORTO]: 'Short text',
  [FieldType.TEXTO_LARGO]: 'Long text',
  [FieldType.NUMERO]: 'Number',
  [FieldType.FECHA]: 'Date',
  [FieldType.SELECCION_SIMPLE]: 'Single choice',
  [FieldType.SELECCION_MULTIPLE]: 'Multiple choice',
  [FieldType.CHECKBOX_ACEPTACION]: 'Acceptance checkbox',
  [FieldType.CARGA_ARCHIVO]: 'File upload',
};

// ─── Validation Helpers ───────────────────────────────────────────────────────

interface FieldErrors {
  label?: string;
  options?: string;
  validation?: string;
}

interface FormErrors {
  name?: string;
  description?: string;
  fields?: Record<string, FieldErrors>;
}

function validateFormName(name: string): string | undefined {
  if (!name || name.trim().length === 0) {
    return 'Name is required';
  }
  if (name.length < 3) {
    return 'Name must be at least 3 characters';
  }
  if (name.length > 200) {
    return 'Name cannot exceed 200 characters';
  }
  if (!name.trim()) {
    return 'Name must contain at least one non-space character';
  }
  return undefined;
}

function validateDescription(description: string): string | undefined {
  if (description.length > 1000) {
    return 'Description cannot exceed 1000 characters';
  }
  return undefined;
}

function validateFieldConfig(field: FieldConfig): FieldErrors {
  const errors: FieldErrors = {};

  // Label validation (1-200 chars)
  if (!field.label || field.label.trim().length === 0) {
    errors.label = 'Label is required';
  } else if (field.label.length > 200) {
    errors.label = 'Label cannot exceed 200 characters';
  }

  // Options validation for selection fields
  if (
    field.type === FieldType.SELECCION_SIMPLE ||
    field.type === FieldType.SELECCION_MULTIPLE
  ) {
    const options = field.options || [];
    if (options.length < 2) {
      errors.options = 'At least 2 options are required';
    } else if (options.length > 50) {
      errors.options = 'Cannot exceed 50 options';
    } else {
      const invalidOption = options.find(
        (o) => !o.label || o.label.trim().length === 0 || o.label.length > 200
      );
      if (invalidOption) {
        errors.options = 'Each option must have a label of 1 to 200 characters';
      }
    }
  }

  // Numeric validation rules
  if (field.type === FieldType.NUMERO && field.validation) {
    const { min_value, max_value } = field.validation;
    if (min_value !== undefined && (min_value < -999999999 || min_value > 999999999)) {
      errors.validation = 'Minimum value must be between -999999999 and 999999999';
    }
    if (max_value !== undefined && (max_value < -999999999 || max_value > 999999999)) {
      errors.validation = 'Maximum value must be between -999999999 and 999999999';
    }
    if (min_value !== undefined && max_value !== undefined && min_value > max_value) {
      errors.validation = 'Minimum value cannot be greater than the maximum';
    }
  }

  // Text validation rules
  if (
    (field.type === FieldType.TEXTO_CORTO || field.type === FieldType.TEXTO_LARGO) &&
    field.validation
  ) {
    const { min_length, max_length } = field.validation;
    if (min_length !== undefined && min_length < 0) {
      errors.validation = 'Minimum length cannot be negative';
    }
    if (max_length !== undefined && (max_length < 0 || max_length > 10000)) {
      errors.validation = 'Maximum length must be between 0 and 10000';
    }
    if (min_length !== undefined && max_length !== undefined && min_length > max_length) {
      errors.validation = 'Minimum length cannot be greater than the maximum';
    }
  }

  return errors;
}

// ─── Field Configuration Panel ────────────────────────────────────────────────

interface FieldConfigPanelProps {
  field: FieldConfig;
  errors: FieldErrors;
  onUpdate: (field: FieldConfig) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}

function FieldConfigPanel({
  field,
  errors,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: FieldConfigPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const handleLabelChange = (value: string) => {
    onUpdate({ ...field, label: value });
  };

  const handleTypeChange = (value: string) => {
    const newType = value as FieldType;
    const updated: FieldConfig = { ...field, type: newType };
    // Reset options when switching to/from selection types
    if (
      newType === FieldType.SELECCION_SIMPLE ||
      newType === FieldType.SELECCION_MULTIPLE
    ) {
      if (!updated.options || updated.options.length < 2) {
        updated.options = [
          { option_id: crypto.randomUUID(), label: '' },
          { option_id: crypto.randomUUID(), label: '' },
        ];
      }
    } else {
      updated.options = undefined;
    }
    // Reset validation when type changes
    updated.validation = undefined;
    onUpdate(updated);
  };

  const handleRequiredChange = (checked: boolean) => {
    onUpdate({ ...field, required: checked });
  };

  const handlePlaceholderChange = (value: string) => {
    onUpdate({ ...field, placeholder: value || undefined });
  };

  const handleHelpTextChange = (value: string) => {
    onUpdate({ ...field, help_text: value || undefined });
  };

  const handleOptionChange = (index: number, label: string) => {
    const options = [...(field.options || [])];
    const existing = options[index];
    if (existing) {
      options[index] = { ...existing, label };
    }
    onUpdate({ ...field, options });
  };

  const handleAddOption = () => {
    const options = [...(field.options || [])];
    if (options.length >= 50) return;
    options.push({ option_id: crypto.randomUUID(), label: '' });
    onUpdate({ ...field, options });
  };

  const handleRemoveOption = (index: number) => {
    const options = [...(field.options || [])];
    if (options.length <= 2) return;
    options.splice(index, 1);
    onUpdate({ ...field, options });
  };

  const handleValidationChange = (key: keyof FieldValidation, value: string) => {
    const validation: FieldValidation = { ...(field.validation || {}) };
    if (value === '' || value === undefined) {
      delete validation[key];
    } else if (
      key === 'min_value' ||
      key === 'max_value' ||
      key === 'min_length' ||
      key === 'max_length' ||
      key === 'max_file_size_mb'
    ) {
      const numVal = Number(value);
      if (!isNaN(numVal)) {
        (validation as Record<string, unknown>)[key] = numVal;
      }
    } else {
      (validation as Record<string, unknown>)[key] = value;
    }
    onUpdate({ ...field, validation: Object.keys(validation).length > 0 ? validation : undefined });
  };

  const isSelectionType =
    field.type === FieldType.SELECCION_SIMPLE ||
    field.type === FieldType.SELECCION_MULTIPLE;
  const isNumericType = field.type === FieldType.NUMERO;
  const isTextType =
    field.type === FieldType.TEXTO_CORTO || field.type === FieldType.TEXTO_LARGO;
  const isDateType = field.type === FieldType.FECHA;

  const hasErrors = errors.label || errors.options || errors.validation;

  return (
    <Card className={hasErrors ? 'border-red-300' : ''}>
      <div className="px-4 py-3 flex items-center gap-3 border-b border-gray-100">
        <GripVertical className="h-4 w-4 text-gray-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
              {field.order}
            </span>
            <span className="text-sm font-medium text-gray-700 truncate">
              {field.label || 'No label'}
            </span>
            <span className="text-xs text-gray-400">
              {FIELD_TYPE_LABELS[field.type]}
            </span>
            {field.required && (
              <span className="text-xs text-red-500 font-medium">*</span>
            )}
            {hasErrors && (
              <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
            aria-label="Move up"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
            aria-label="Move down"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="p-1 text-gray-400 hover:text-gray-600"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="p-1 text-red-400 hover:text-red-600"
            aria-label="Delete field"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <CardContent>
          <div className="space-y-4">
            {/* Basic field config */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Label"
                value={field.label}
                onChange={(e) => handleLabelChange(e.target.value)}
                error={errors.label}
                placeholder="Field name"
              />
              <Select
                label="Field type"
                options={FIELD_TYPE_OPTIONS}
                value={field.type}
                onChange={(e) => handleTypeChange(e.target.value)}
              />
            </div>

            {/* Required checkbox */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`required-${field.field_id}`}
                checked={field.required}
                onChange={(e) => handleRequiredChange(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <label
                htmlFor={`required-${field.field_id}`}
                className="text-sm text-gray-700"
              >
                Required field
              </label>
            </div>

            {/* Placeholder and help text */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Placeholder"
                value={field.placeholder || ''}
                onChange={(e) => handlePlaceholderChange(e.target.value)}
                placeholder="Example text (max. 200)"
                helperText="Maximum 200 characters"
              />
              <Input
                label="Help text"
                value={field.help_text || ''}
                onChange={(e) => handleHelpTextChange(e.target.value)}
                placeholder="Instructions for the user (max. 500)"
                helperText="Maximum 500 characters"
              />
            </div>

            {/* Options for selection fields */}
            {isSelectionType && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Options
                </label>
                {errors.options && (
                  <p className="text-xs text-red-600" role="alert">
                    {errors.options}
                  </p>
                )}
                {(field.options || []).map((option, idx) => (
                  <div key={option.option_id} className="flex items-center gap-2">
                    <Input
                      value={option.label}
                      onChange={(e) => handleOptionChange(idx, e.target.value)}
                      placeholder={`Option ${idx + 1}`}
                      className="flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveOption(idx)}
                      disabled={(field.options || []).length <= 2}
                      className="p-1.5 text-red-400 hover:text-red-600 disabled:opacity-30"
                      aria-label={`Delete option ${idx + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {(field.options || []).length < 50 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleAddOption}
                  >
                    <Plus className="h-3 w-3" /> Add option
                  </Button>
                )}
              </div>
            )}

            {/* Numeric validation */}
            {isNumericType && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Numeric validation rules
                </label>
                {errors.validation && (
                  <p className="text-xs text-red-600" role="alert">
                    {errors.validation}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Minimum value"
                    type="number"
                    value={field.validation?.min_value ?? ''}
                    onChange={(e) => handleValidationChange('min_value', e.target.value)}
                    placeholder="-999999999"
                  />
                  <Input
                    label="Maximum value"
                    type="number"
                    value={field.validation?.max_value ?? ''}
                    onChange={(e) => handleValidationChange('max_value', e.target.value)}
                    placeholder="999999999"
                  />
                </div>
              </div>
            )}

            {/* Text validation */}
            {isTextType && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Text validation rules
                </label>
                {errors.validation && (
                  <p className="text-xs text-red-600" role="alert">
                    {errors.validation}
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Input
                    label="Minimum length"
                    type="number"
                    value={field.validation?.min_length ?? ''}
                    onChange={(e) => handleValidationChange('min_length', e.target.value)}
                    placeholder="0"
                  />
                  <Input
                    label="Maximum length"
                    type="number"
                    value={field.validation?.max_length ?? ''}
                    onChange={(e) => handleValidationChange('max_length', e.target.value)}
                    placeholder="10000"
                  />
                  <Input
                    label="Pattern (regex)"
                    value={field.validation?.pattern ?? ''}
                    onChange={(e) => handleValidationChange('pattern', e.target.value)}
                    placeholder="^[a-zA-Z]+$"
                  />
                </div>
              </div>
            )}

            {/* Date validation */}
            {isDateType && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Date validation rules
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Minimum date"
                    type="date"
                    value={field.validation?.min_date ?? ''}
                    onChange={(e) => handleValidationChange('min_date', e.target.value)}
                  />
                  <Input
                    label="Maximum date"
                    type="date"
                    value={field.validation?.max_date ?? ''}
                    onChange={(e) => handleValidationChange('max_date', e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Main FormBuilder Component ───────────────────────────────────────────────

export default function FormBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditMode = !!id;

  // Fetch existing form data if editing
  const { data: existingForm, isLoading: isLoadingForm } = useFormQuery(id);

  // Mutations
  const createForm = useCreateForm();
  const updateForm = useUpdateForm();

  // Local state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [initialized, setInitialized] = useState(false);

  // Initialize form data from existing form
  if (existingForm && !initialized) {
    setFormName(existingForm.name);
    setFormDescription(existingForm.description || '');
    setFields(existingForm.fields || []);
    setInitialized(true);
  }

  // ─── Field Operations ─────────────────────────────────────────────────────

  const addField = useCallback(() => {
    if (fields.length >= MAX_FIELDS) return;
    const newField: FieldConfig = {
      field_id: crypto.randomUUID(),
      type: FieldType.TEXTO_CORTO,
      label: '',
      required: false,
      order: fields.length + 1,
    };
    setFields((prev) => [...prev, newField]);
  }, [fields.length]);

  const removeField = useCallback((index: number) => {
    setFields((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      // Recalculate order to maintain consecutive values
      return updated.map((f, i) => ({ ...f, order: i + 1 }));
    });
  }, []);

  const moveFieldUp = useCallback((index: number) => {
    if (index === 0) return;
    setFields((prev) => {
      const updated = [...prev];
      const temp = updated[index - 1]!;
      updated[index - 1] = updated[index]!;
      updated[index] = temp;
      return updated.map((f, i) => ({ ...f, order: i + 1 }));
    });
  }, []);

  const moveFieldDown = useCallback((index: number) => {
    setFields((prev) => {
      if (index >= prev.length - 1) return prev;
      const updated = [...prev];
      const temp = updated[index]!;
      updated[index] = updated[index + 1]!;
      updated[index + 1] = temp;
      return updated.map((f, i) => ({ ...f, order: i + 1 }));
    });
  }, []);

  const updateField = useCallback((index: number, updatedField: FieldConfig) => {
    setFields((prev) => {
      const updated = [...prev];
      updated[index] = updatedField;
      return updated;
    });
  }, []);

  // ─── Validation ─────────────────────────────────────────────────────────

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    const nameError = validateFormName(formName);
    if (nameError) newErrors.name = nameError;

    const descError = validateDescription(formDescription);
    if (descError) newErrors.description = descError;

    const fieldErrors: Record<string, FieldErrors> = {};
    fields.forEach((field) => {
      const errs = validateFieldConfig(field);
      if (errs.label || errs.options || errs.validation) {
        fieldErrors[field.field_id] = errs;
      }
    });

    if (Object.keys(fieldErrors).length > 0) {
      newErrors.fields = fieldErrors;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formName, formDescription, fields]);

  // Compute field errors for display
  const fieldErrorsMap = useMemo(() => {
    const map: Record<string, FieldErrors> = {};
    fields.forEach((field) => {
      map[field.field_id] = errors.fields?.[field.field_id] || {};
    });
    return map;
  }, [fields, errors.fields]);

  // ─── Save as Draft ──────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!validateForm()) return;

    setSaveStatus('saving');

    try {
      if (isEditMode && id) {
        const payload: UpdateFormRequest & { formId: string } = {
          formId: id,
          name: formName,
          description: formDescription || undefined,
          fields,
        };
        await updateForm.mutateAsync(payload);
      } else {
        // Create new form first, then update with fields
        const result = await createForm.mutateAsync({
          name: formName,
          description: formDescription || undefined,
        });
        const newFormId = result.form.form_id;
        // Update with fields
        if (fields.length > 0) {
          await updateForm.mutateAsync({
            formId: newFormId,
            fields,
          });
        }
        // Navigate to edit mode
        navigate(`/forms/${newFormId}/edit`, { replace: true });
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 5000);
    }
  }, [validateForm, isEditMode, id, formName, formDescription, fields, updateForm, createForm, navigate]);

  // ─── Loading State ──────────────────────────────────────────────────────

  if (isEditMode && isLoadingForm) {
    return (
      <PageContainer title="Loading form...">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      </PageContainer>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  const breadcrumbs = [
    { label: 'Forms', href: '/forms' },
    { label: isEditMode ? 'Edit form' : 'New form' },
  ];

  const saveButtonLabel = (() => {
    switch (saveStatus) {
      case 'saving':
        return 'Saving...';
      case 'saved':
        return 'Saved ✓';
      case 'error':
        return 'Failed to save';
      default:
        return 'Save draft';
    }
  })();

  return (
    <PageContainer
      title={isEditMode ? 'Edit form' : 'New form'}
      description="Configure the form fields. You can save as a draft at any time."
      breadcrumbs={breadcrumbs}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => navigate('/forms')}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
          >
            <Save className="h-4 w-4" />
            {saveButtonLabel}
          </Button>
        </div>
      }
    >
      {/* Form metadata */}
      <Card>
        <CardContent>
          <div className="space-y-4">
            <Input
              label="Form name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              error={errors.name}
              placeholder="e.g. Site entry registration"
              helperText="Between 3 and 200 characters"
            />
            <div className="space-y-1">
              <label
                htmlFor="form-description"
                className="block text-sm font-medium text-gray-700"
              >
                Description
              </label>
              <textarea
                id="form-description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Optional form description (max. 1000 characters)"
                rows={3}
                className={`
                  block w-full rounded-md border px-3 py-2 text-sm shadow-sm
                  transition-colors focus:outline-none focus:ring-1
                  ${errors.description
                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500'
                    : 'border-gray-300 focus:border-primary-500 focus:ring-primary-500'
                  }
                `}
              />
              {errors.description && (
                <p className="text-xs text-red-600" role="alert">
                  {errors.description}
                </p>
              )}
              <p className="text-xs text-gray-500">
                {formDescription.length}/1000 characters
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fields section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">
            Fields ({fields.length}/{MAX_FIELDS})
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addField}
            disabled={fields.length >= MAX_FIELDS}
          >
            <Plus className="h-4 w-4" /> Add field
          </Button>
        </div>

        {fields.length >= MAX_FIELDS && (
          <div className="rounded-md bg-yellow-50 p-3" role="alert">
            <p className="text-sm text-yellow-700">
              The maximum limit of {MAX_FIELDS} fields per form has been reached.
            </p>
          </div>
        )}

        {fields.length === 0 && (
          <Card>
            <CardContent className="text-center py-12">
              <p className="text-gray-500 mb-4">
                No fields configured. Add fields to build your form.
              </p>
              <Button type="button" variant="outline" onClick={addField}>
                <Plus className="h-4 w-4" /> Add first field
              </Button>
            </CardContent>
          </Card>
        )}

        {fields.map((field, index) => (
          <FieldConfigPanel
            key={field.field_id}
            field={field}
            errors={fieldErrorsMap[field.field_id] || {}}
            onUpdate={(updated) => updateField(index, updated)}
            onRemove={() => removeField(index)}
            onMoveUp={() => moveFieldUp(index)}
            onMoveDown={() => moveFieldDown(index)}
            isFirst={index === 0}
            isLast={index === fields.length - 1}
          />
        ))}
      </div>

      {/* Bottom save bar */}
      {fields.length > 0 && (
        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 py-3 -mx-4 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => navigate('/forms')}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
          >
            <Save className="h-4 w-4" />
            {saveButtonLabel}
          </Button>
        </div>
      )}
    </PageContainer>
  );
}
