// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useFormValidation } from '../useFormValidation';
import { FieldType } from '../types';
import type { FieldConfig } from '../types';

function makeField(overrides: Partial<FieldConfig> & { field_id: string; type: FieldType; label: string }): FieldConfig {
  return {
    required: false,
    order: 1,
    ...overrides,
  };
}

const testFields: FieldConfig[] = [
  makeField({
    field_id: 'name',
    type: FieldType.TEXTO_CORTO,
    label: 'Nombre',
    required: true,
    order: 1,
  }),
  makeField({
    field_id: 'age',
    type: FieldType.NUMERO,
    label: 'Edad',
    required: true,
    order: 2,
    validation: { min_value: 18, max_value: 100 },
  }),
  makeField({
    field_id: 'notes',
    type: FieldType.TEXTO_LARGO,
    label: 'Notas',
    required: false,
    order: 3,
    validation: { max_length: 500 },
  }),
];

describe('useFormValidation', () => {
  describe('validateOnBlur', () => {
    it('validates a single field and stores errors', () => {
      const { result } = renderHook(() => useFormValidation(testFields));

      act(() => {
        result.current.validateOnBlur('name', '');
      });

      expect(result.current.getFieldErrors('name')).toHaveLength(1);
      expect(result.current.getFieldErrors('name')[0]).toContain('obligatorio');
    });

    it('clears errors when field becomes valid', () => {
      const { result } = renderHook(() => useFormValidation(testFields));

      act(() => {
        result.current.validateOnBlur('name', '');
      });
      expect(result.current.hasFieldError('name')).toBe(true);

      act(() => {
        result.current.validateOnBlur('name', 'Juan');
      });
      expect(result.current.hasFieldError('name')).toBe(false);
    });

    it('does not show errors for untouched fields', () => {
      const { result } = renderHook(() => useFormValidation(testFields));

      // age field is required but not touched
      expect(result.current.getFieldErrors('age')).toHaveLength(0);
      expect(result.current.hasFieldError('age')).toBe(false);
    });
  });

  describe('validateOnSubmit', () => {
    it('validates all fields and shows all errors simultaneously', () => {
      const { result } = renderHook(() => useFormValidation(testFields));

      let validationResult;
      act(() => {
        validationResult = result.current.validateOnSubmit({});
      });

      expect(validationResult!.valid).toBe(false);
      expect(validationResult!.errors).toHaveLength(2); // name and age are required
      expect(result.current.getFieldErrors('name')).toHaveLength(1);
      expect(result.current.getFieldErrors('age')).toHaveLength(1);
    });

    it('returns valid result when all required fields are filled correctly', () => {
      const { result } = renderHook(() => useFormValidation(testFields));

      let validationResult;
      act(() => {
        validationResult = result.current.validateOnSubmit({ name: 'Juan', age: 25 });
      });

      expect(validationResult!.valid).toBe(true);
      expect(validationResult!.errors).toHaveLength(0);
    });

    it('shows errors for all fields after submit even if not touched', () => {
      const { result } = renderHook(() => useFormValidation(testFields));

      act(() => {
        result.current.validateOnSubmit({});
      });

      // Both required fields should show errors even though they were never touched
      expect(result.current.hasSubmitted).toBe(true);
      expect(result.current.getFieldErrors('name').length).toBeGreaterThan(0);
      expect(result.current.getFieldErrors('age').length).toBeGreaterThan(0);
    });
  });

  describe('clearErrors', () => {
    it('clears all validation state', () => {
      const { result } = renderHook(() => useFormValidation(testFields));

      act(() => {
        result.current.validateOnSubmit({});
      });
      expect(result.current.hasSubmitted).toBe(true);

      act(() => {
        result.current.clearErrors();
      });

      expect(result.current.hasSubmitted).toBe(false);
      expect(result.current.getFieldErrors('name')).toHaveLength(0);
      expect(result.current.getFieldErrors('age')).toHaveLength(0);
    });
  });

  describe('setServerErrors', () => {
    it('sets errors from server response', () => {
      const { result } = renderHook(() => useFormValidation(testFields));

      act(() => {
        result.current.setServerErrors([
          { field_id: 'name', field_label: 'Nombre', message: 'Error del servidor' },
        ]);
      });

      expect(result.current.getFieldErrors('name')).toEqual(['Error del servidor']);
      expect(result.current.hasSubmitted).toBe(true);
    });
  });

  describe('clearFieldErrors', () => {
    it('clears errors for a specific field only', () => {
      const { result } = renderHook(() => useFormValidation(testFields));

      act(() => {
        result.current.validateOnSubmit({});
      });
      expect(result.current.getFieldErrors('name').length).toBeGreaterThan(0);
      expect(result.current.getFieldErrors('age').length).toBeGreaterThan(0);

      act(() => {
        result.current.clearFieldErrors('name');
      });

      expect(result.current.getFieldErrors('name')).toHaveLength(0);
      expect(result.current.getFieldErrors('age').length).toBeGreaterThan(0);
    });
  });

  describe('getFieldError', () => {
    it('returns first error message as string for a touched field', () => {
      const { result } = renderHook(() => useFormValidation(testFields));

      act(() => {
        result.current.validateOnBlur('name', '');
      });

      expect(result.current.getFieldError('name')).toContain('obligatorio');
    });

    it('returns undefined for untouched field', () => {
      const { result } = renderHook(() => useFormValidation(testFields));

      expect(result.current.getFieldError('name')).toBeUndefined();
    });
  });

  describe('getErrorsForRenderer', () => {
    it('returns Record<string, string> with first error per field after submit', () => {
      const { result } = renderHook(() => useFormValidation(testFields));

      act(() => {
        result.current.validateOnSubmit({});
      });

      const rendererErrors = result.current.getErrorsForRenderer();
      expect(rendererErrors['name']).toContain('obligatorio');
      expect(rendererErrors['age']).toContain('obligatorio');
      expect(rendererErrors['notes']).toBeUndefined();
    });

    it('only includes touched fields before submit', () => {
      const { result } = renderHook(() => useFormValidation(testFields));

      act(() => {
        result.current.validateOnBlur('name', '');
      });

      const rendererErrors = result.current.getErrorsForRenderer();
      expect(rendererErrors['name']).toContain('obligatorio');
      expect(rendererErrors['age']).toBeUndefined();
    });
  });
});
