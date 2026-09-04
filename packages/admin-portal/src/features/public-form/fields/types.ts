import type { PublicFormField } from '../PublicFormPage';

export interface PublicFieldProps {
  field: PublicFormField;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
  onBlur: () => void;
}
