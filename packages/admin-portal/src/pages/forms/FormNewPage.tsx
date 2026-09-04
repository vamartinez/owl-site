import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useCreateForm } from '@/features/forms/hooks';

export default function FormNewPage() {
  const navigate = useNavigate();
  const { mutate: createForm, isPending } = useCreateForm();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({});

  function validate(): boolean {
    const newErrors: typeof errors = {};

    if (!name.trim()) {
      newErrors.name = 'Name is required';
    } else if (name.trim().length < 3) {
      newErrors.name = 'Name must be at least 3 characters';
    } else if (name.length > 200) {
      newErrors.name = 'Name cannot exceed 200 characters';
    }

    if (description.length > 1000) {
      newErrors.description = 'Description cannot exceed 1000 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    createForm(
      { name: name.trim(), description: description.trim() || undefined },
      {
        onSuccess: (data) => {
          navigate(`/forms/${data.form.form_id}/edit`);
        },
      }
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">New Form</h1>
        <p className="mt-1 text-sm text-gray-500">
          Create a new form for contractors
        </p>
      </div>

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <Input
            label="Form name"
            placeholder="e.g. Daily safety inspection"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            required
            autoFocus
            maxLength={200}
          />

          <div className="space-y-1">
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700"
            >
              Description (optional)
            </label>
            <textarea
              id="description"
              rows={3}
              placeholder="Describe the purpose of this form..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
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
            <p className="text-xs text-gray-400 text-right">
              {description.length}/1000
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating...' : 'Create form'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/forms')}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
