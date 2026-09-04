/**
 * Unit tests for validation rejection in the Identity Service.
 * Verifies that invalid input to worker and certification modules
 * is rejected with descriptive error messages.
 *
 * Test cases cover:
 * - Missing required fields
 * - Invalid field types
 * - Empty strings where non-empty required
 *
 * Requirements: 1.6
 */

import { describe, it, expect } from 'vitest';
import { createWorkerSchema, updateWorkerSchema } from '../worker.js';
import { createCertificationSchema, updateCertificationSchema } from '../certification.js';

// --- Helper ---

function getErrors(result: { success: false; error: { issues: Array<{ message: string; path: (string | number)[] }> } }) {
  return result.error.issues;
}

// --- Worker Creation: Missing Required Fields ---

describe('validation-rejection: createWorkerSchema — missing required fields', () => {
  it('rejects when legal_name is missing', () => {
    const input = {
      phone: '+14155552671',
      language_preference: 'en',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('legal_name'))).toBe(true);
    }
  });

  it('rejects when phone is missing', () => {
    const input = {
      legal_name: 'John Smith',
      language_preference: 'en',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('phone'))).toBe(true);
    }
  });

  it('rejects when language_preference is missing', () => {
    const input = {
      legal_name: 'John Smith',
      phone: '+14155552671',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('language_preference'))).toBe(true);
    }
  });

  it('rejects when all required fields are missing (empty object)', () => {
    const result = createWorkerSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.length).toBeGreaterThanOrEqual(3);
    }
  });
});

// --- Worker Creation: Invalid Field Types ---

describe('validation-rejection: createWorkerSchema — invalid field types', () => {
  it('rejects when legal_name is a number', () => {
    const input = {
      legal_name: 12345,
      phone: '+14155552671',
      language_preference: 'en',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('legal_name'))).toBe(true);
    }
  });

  it('rejects when phone is a number', () => {
    const input = {
      legal_name: 'John Smith',
      phone: 14155552671,
      language_preference: 'en',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('phone'))).toBe(true);
    }
  });

  it('rejects when language_preference is a number', () => {
    const input = {
      legal_name: 'John Smith',
      phone: '+14155552671',
      language_preference: 42,
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('language_preference'))).toBe(true);
    }
  });

  it('rejects when email is not a valid email format', () => {
    const input = {
      legal_name: 'John Smith',
      phone: '+14155552671',
      language_preference: 'en',
      email: 'not-an-email',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('email'))).toBe(true);
      expect(errors.some((e) => e.message.toLowerCase().includes('email'))).toBe(true);
    }
  });

  it('rejects when phone format is invalid (not E.164)', () => {
    const input = {
      legal_name: 'John Smith',
      phone: '555-123-4567',
      language_preference: 'en',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.message.includes('E.164'))).toBe(true);
    }
  });

  it('rejects when language_preference is not a valid enum value', () => {
    const input = {
      legal_name: 'John Smith',
      phone: '+14155552671',
      language_preference: 'french',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('language_preference'))).toBe(true);
    }
  });
});

// --- Worker Creation: Empty Strings Where Non-Empty Required ---

describe('validation-rejection: createWorkerSchema — empty strings', () => {
  it('rejects empty string for legal_name', () => {
    const input = {
      legal_name: '',
      phone: '+14155552671',
      language_preference: 'en',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('legal_name'))).toBe(true);
      expect(errors.some((e) => e.message.includes('required'))).toBe(true);
    }
  });

  it('rejects whitespace-only string for legal_name', () => {
    const input = {
      legal_name: '   ',
      phone: '+14155552671',
      language_preference: 'en',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('legal_name'))).toBe(true);
    }
  });

  it('rejects empty string for phone', () => {
    const input = {
      legal_name: 'John Smith',
      phone: '',
      language_preference: 'en',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('phone'))).toBe(true);
    }
  });

  it('rejects empty string for language_preference', () => {
    const input = {
      legal_name: 'John Smith',
      phone: '+14155552671',
      language_preference: '',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('language_preference'))).toBe(true);
    }
  });
});

// --- Worker Update: Validation Rejection ---

describe('validation-rejection: updateWorkerSchema', () => {
  it('rejects empty object (at least one field required)', () => {
    const result = updateWorkerSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.message.includes('At least one field'))).toBe(true);
    }
  });

  it('rejects when phone has invalid format', () => {
    const input = { phone: 'not-a-phone' };
    const result = updateWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('phone'))).toBe(true);
      expect(errors.some((e) => e.message.includes('E.164'))).toBe(true);
    }
  });

  it('rejects when legal_name is empty string', () => {
    const input = { legal_name: '' };
    const result = updateWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('legal_name'))).toBe(true);
    }
  });

  it('rejects when email is invalid format', () => {
    const input = { email: 'bad-email' };
    const result = updateWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('email'))).toBe(true);
    }
  });

  it('rejects when language_preference is invalid', () => {
    const input = { language_preference: 'xx' };
    const result = updateWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('language_preference'))).toBe(true);
    }
  });
});

// --- Certification Creation: Missing Required Fields ---

describe('validation-rejection: createCertificationSchema — missing required fields', () => {
  it('rejects when certification_type is missing', () => {
    const input = {
      issuer: 'BC Safety Authority',
      issue_date: '2024-01-15',
      expiry_date: '2025-01-15',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('certification_type'))).toBe(true);
    }
  });

  it('rejects when issuer is missing', () => {
    const input = {
      certification_type: 'whmis_2015',
      issue_date: '2024-01-15',
      expiry_date: '2025-01-15',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('issuer'))).toBe(true);
    }
  });

  it('rejects when issue_date is missing', () => {
    const input = {
      certification_type: 'whmis_2015',
      issuer: 'BC Safety Authority',
      expiry_date: '2025-01-15',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('issue_date'))).toBe(true);
    }
  });

  it('rejects when expiry_date is missing', () => {
    const input = {
      certification_type: 'whmis_2015',
      issuer: 'BC Safety Authority',
      issue_date: '2024-01-15',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('expiry_date'))).toBe(true);
    }
  });

  it('rejects when all required fields are missing (empty object)', () => {
    const result = createCertificationSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.length).toBeGreaterThanOrEqual(4);
    }
  });
});

// --- Certification Creation: Invalid Field Types ---

describe('validation-rejection: createCertificationSchema — invalid field types', () => {
  it('rejects when certification_type is not a valid enum value', () => {
    const input = {
      certification_type: 'invalid_cert_type',
      issuer: 'Safety Corp',
      issue_date: '2024-01-15',
      expiry_date: '2025-01-15',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('certification_type'))).toBe(true);
    }
  });

  it('rejects when issue_date has invalid format', () => {
    const input = {
      certification_type: 'whmis_2015',
      issuer: 'Safety Corp',
      issue_date: '15-01-2024',
      expiry_date: '2025-01-15',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('issue_date'))).toBe(true);
    }
  });

  it('rejects when expiry_date has invalid format', () => {
    const input = {
      certification_type: 'whmis_2015',
      issuer: 'Safety Corp',
      issue_date: '2024-01-15',
      expiry_date: 'January 15, 2025',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('expiry_date'))).toBe(true);
    }
  });

  it('rejects when issuer is a number', () => {
    const input = {
      certification_type: 'whmis_2015',
      issuer: 99999,
      issue_date: '2024-01-15',
      expiry_date: '2025-01-15',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('issuer'))).toBe(true);
    }
  });

  it('provides descriptive error when expiry_date is before issue_date', () => {
    const input = {
      certification_type: 'whmis_2015',
      issuer: 'Safety Corp',
      issue_date: '2025-06-15',
      expiry_date: '2024-01-01',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.message.includes('Expiry date must be after'))).toBe(true);
    }
  });
});

// --- Certification Creation: Empty Strings Where Non-Empty Required ---

describe('validation-rejection: createCertificationSchema — empty strings', () => {
  it('rejects empty string for issuer', () => {
    const input = {
      certification_type: 'whmis_2015',
      issuer: '',
      issue_date: '2024-01-15',
      expiry_date: '2025-01-15',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('issuer'))).toBe(true);
    }
  });

  it('rejects whitespace-only string for issuer', () => {
    const input = {
      certification_type: 'whmis_2015',
      issuer: '    ',
      issue_date: '2024-01-15',
      expiry_date: '2025-01-15',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('issuer'))).toBe(true);
    }
  });

  it('rejects empty string for issue_date', () => {
    const input = {
      certification_type: 'whmis_2015',
      issuer: 'Safety Corp',
      issue_date: '',
      expiry_date: '2025-01-15',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('issue_date'))).toBe(true);
    }
  });

  it('rejects empty string for expiry_date', () => {
    const input = {
      certification_type: 'whmis_2015',
      issuer: 'Safety Corp',
      issue_date: '2024-01-15',
      expiry_date: '',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.path.includes('expiry_date'))).toBe(true);
    }
  });
});

// --- Error Message Descriptiveness ---

describe('validation-rejection: error messages are descriptive', () => {
  it('worker creation provides field-specific error for missing legal_name', () => {
    const input = { phone: '+14155552671', language_preference: 'en' };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      const nameError = errors.find((e) => e.path.includes('legal_name'));
      expect(nameError).toBeDefined();
      expect(nameError!.message.length).toBeGreaterThan(0);
    }
  });

  it('worker creation provides E.164 format guidance for invalid phone', () => {
    const input = {
      legal_name: 'John',
      phone: '123',
      language_preference: 'en',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      const phoneError = errors.find((e) => e.path.includes('phone'));
      expect(phoneError).toBeDefined();
      expect(phoneError!.message).toContain('E.164');
    }
  });

  it('certification creation provides descriptive error for date constraint', () => {
    const input = {
      certification_type: 'whmis_2015',
      issuer: 'Safety Corp',
      issue_date: '2025-01-15',
      expiry_date: '2024-01-15',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.message.includes('Expiry date must be after the issue date'))).toBe(true);
    }
  });

  it('worker update provides descriptive error for empty update', () => {
    const result = updateWorkerSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      expect(errors.some((e) => e.message.includes('At least one field must be provided'))).toBe(true);
    }
  });

  it('certification creation provides descriptive error for date format', () => {
    const input = {
      certification_type: 'whmis_2015',
      issuer: 'Safety Corp',
      issue_date: 'not-a-date',
      expiry_date: '2025-01-15',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = getErrors(result);
      const dateError = errors.find((e) => e.path.includes('issue_date'));
      expect(dateError).toBeDefined();
      expect(dateError!.message).toContain('YYYY-MM-DD');
    }
  });
});
