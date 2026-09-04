import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { useFormQuery } from '@/features/forms/hooks/useFormQuery';
import { useUpdateForm } from '@/features/forms/hooks/useUpdateForm';
import { FieldType } from '@/features/forms/types';
import type { FieldConfig } from '@/features/forms/types';

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

function generateId() {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function FormEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useFormQuery(id);
  const { mutate: updateForm, isPending: isSaving } = useUpdateForm();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // Initialize state from fetched data
  if (data && !initialized) {
    setName(data.name);
    setDescription(data.description || '');
    setFields(data.fields || []);
    setInitialized(true);
  }

  const addField = useCallback(() => {
    const newField: FieldConfig = {
      field_id: generateId(),
      type: FieldType.TEXTO_CORTO,
      label: '',
      required: false,
      order: fields.length + 1,
    };
    setFields((prev) => [...prev, newField]);
  }, [fields.length]);

  const removeField = useCallback((index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index).map((f, i) => ({ ...f, order: i + 1 })));
  }, []);

  const updateField = useCallback((index: number, updates: Partial<FieldConfig>) => {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...updates } : f))
    );
  }, []);

  function handleSave() {
    if (!id) return;
    setSaveMessage('');

    updateForm(
      { formId: id, name: name.trim(), description: description.trim() || undefined, fields },
      {
        onSuccess: () => setSaveMessage('Saved successfully'),
        onError: () => setSaveMessage('Failed to save'),
      }
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-500">Loading form...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-500">Form not found</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Edit Form</h1>
          <p className="mt-1 text-sm text-gray-500">
            Modify the form's fields and configuration
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saveMessage && (
            <span className={`text-sm ${saveMessage.includes('Failed') ? 'text-red-600' : 'text-green-600'}`}>
              {saveMessage}
            </span>
          )}
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
          <Button variant="outline" onClick={() => navigate(`/forms/${id}`)}>
            Back
          </Button>
        </div>
      </div>

      {/* Form metadata */}
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-medium text-gray-900">General information</h2>
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
        />
        <div className="space-y-1">
          <label htmlFor="edit-description" className="block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            id="edit-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:border-primary-500 focus:ring-primary-500"
          />
        </div>
      </Card>

      {/* Fields editor */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">
            Fields ({fields.length}/50)
          </h2>
          <Button size="sm" onClick={addField} disabled={fields.length >= 50}>
            + Add field
          </Button>
        </div>

        {fields.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">
            No fields configured. Add at least one to publish.
          </p>
        )}

        <div className="space-y-3">
          {fields.map((field, index) => (
            <div
              key={field.field_id}
              className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50"
            >
              <div className="flex items-start gap-3">
                <span className="text-xs text-gray-400 mt-2 font-mono w-6">
                  {index + 1}
                </span>
                <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Input
                    label="Label"
                    value={field.label}
                    onChange={(e) => updateField(index, { label: e.target.value })}
                    placeholder="Field name"
                    maxLength={200}
                  />
                  <Select
                    label="Type"
                    value={field.type}
                    onChange={(e) => updateField(index, { type: e.target.value as FieldType })}
                    options={Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                  <div className="flex items-end gap-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateField(index, { required: e.target.checked })}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      Required
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeField(index)}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50 ml-auto"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
