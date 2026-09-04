/**
 * Unit tests for the Identity Service.
 * Tests worker validation schemas, certification validation,
 * status state machine, and handler routing.
 */

import { describe, it, expect } from 'vitest';
import { createWorkerSchema, updateWorkerSchema } from '../../src/services/identity/worker.js';
import {
  createCertificationSchema,
  validateDocument,
  validateStatusTransition,
} from '../../src/services/identity/certification.js';
import { CertificationStatus } from '../../src/shared/types/common.js';
import {
  VALID_STATUS_TRANSITIONS,
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENT_SIZE,
} from '../../src/services/identity/types.js';

// --- Worker Schema Validation Tests ---

describe('identity-service: createWorkerSchema', () => {
  it('accepts valid worker input', () => {
    const input = {
      legal_name: 'John Smith',
      preferred_name: 'Johnny',
      phone: '+14155552671',
      language_preference: 'en',
    };
    expect(createWorkerSchema.safeParse(input).success).toBe(true);
  });

  it('accepts worker without optional preferred_name', () => {
    const input = {
      legal_name: 'Maria Garcia',
      phone: '+14155552671',
      language_preference: 'es',
    };
    expect(createWorkerSchema.safeParse(input).success).toBe(true);
  });

  it('rejects legal_name exceeding 150 characters', () => {
    const input = {
      legal_name: 'x'.repeat(151),
      phone: '+14155552671',
      language_preference: 'en',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects empty legal_name', () => {
    const input = {
      legal_name: '',
      phone: '+14155552671',
      language_preference: 'en',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects preferred_name exceeding 100 characters', () => {
    const input = {
      legal_name: 'John Smith',
      preferred_name: 'x'.repeat(101),
      phone: '+14155552671',
      language_preference: 'en',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects invalid phone number (not E.164)', () => {
    const input = {
      legal_name: 'John Smith',
      phone: '555-1234',
      language_preference: 'en',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects phone number without leading +', () => {
    const input = {
      legal_name: 'John Smith',
      phone: '14155552671',
      language_preference: 'en',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects invalid language preference', () => {
    const input = {
      legal_name: 'John Smith',
      phone: '+14155552671',
      language_preference: 'fr',
    };
    const result = createWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('accepts all valid language preferences (en, es, pa)', () => {
    for (const lang of ['en', 'es', 'pa']) {
      const input = {
        legal_name: 'Test Worker',
        phone: '+14155552671',
        language_preference: lang,
      };
      expect(createWorkerSchema.safeParse(input).success).toBe(true);
    }
  });

  it('accepts legal_name at exactly 150 characters', () => {
    const input = {
      legal_name: 'x'.repeat(150),
      phone: '+14155552671',
      language_preference: 'en',
    };
    expect(createWorkerSchema.safeParse(input).success).toBe(true);
  });
});

describe('identity-service: updateWorkerSchema', () => {
  it('accepts partial update with single field', () => {
    const input = { legal_name: 'Updated Name' };
    expect(updateWorkerSchema.safeParse(input).success).toBe(true);
  });

  it('rejects empty update (no fields provided)', () => {
    const input = {};
    const result = updateWorkerSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('accepts update with multiple fields', () => {
    const input = {
      legal_name: 'New Name',
      phone: '+14155559999',
      language_preference: 'pa',
    };
    expect(updateWorkerSchema.safeParse(input).success).toBe(true);
  });
});

// --- Certification Schema Validation Tests ---

describe('identity-service: createCertificationSchema', () => {
  it('accepts valid certification input', () => {
    const input = {
      certification_type: 'whmis_2015',
      issuer: 'BC Safety Authority',
      issue_date: '2024-01-15',
      expiry_date: '2025-01-15',
    };
    expect(createCertificationSchema.safeParse(input).success).toBe(true);
  });

  it('rejects expiry_date equal to issue_date', () => {
    const input = {
      certification_type: 'fall_protection',
      issuer: 'Safety Corp',
      issue_date: '2024-06-01',
      expiry_date: '2024-06-01',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects expiry_date before issue_date', () => {
    const input = {
      certification_type: 'first_aid',
      issuer: 'Red Cross',
      issue_date: '2024-06-15',
      expiry_date: '2024-06-01',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects issuer exceeding 200 characters', () => {
    const input = {
      certification_type: 'whmis_2015',
      issuer: 'x'.repeat(201),
      issue_date: '2024-01-15',
      expiry_date: '2025-01-15',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects invalid certification type', () => {
    const input = {
      certification_type: 'invalid_type',
      issuer: 'Safety Corp',
      issue_date: '2024-01-15',
      expiry_date: '2025-01-15',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('accepts all valid certification types', () => {
    for (const type of ['whmis_2015', 'fall_protection', 'site_ready_bc', 'first_aid']) {
      const input = {
        certification_type: type,
        issuer: 'Test Issuer',
        issue_date: '2024-01-01',
        expiry_date: '2025-01-01',
      };
      expect(createCertificationSchema.safeParse(input).success).toBe(true);
    }
  });

  it('rejects invalid date format', () => {
    const input = {
      certification_type: 'whmis_2015',
      issuer: 'Safety Corp',
      issue_date: '01/15/2024',
      expiry_date: '01/15/2025',
    };
    const result = createCertificationSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

// --- Document Validation Tests ---

describe('identity-service: validateDocument', () => {
  it('returns null for valid PDF', () => {
    expect(validateDocument('application/pdf', 5 * 1024 * 1024)).toBeNull();
  });

  it('returns null for valid JPEG', () => {
    expect(validateDocument('image/jpeg', 1024)).toBeNull();
  });

  it('returns null for valid PNG', () => {
    expect(validateDocument('image/png', 2 * 1024 * 1024)).toBeNull();
  });

  it('rejects unsupported content type', () => {
    const error = validateDocument('application/zip', 1024);
    expect(error).not.toBeNull();
    expect(error).toContain('PDF, JPEG, or PNG');
  });

  it('rejects document exceeding 10 MB', () => {
    const error = validateDocument('application/pdf', 11 * 1024 * 1024);
    expect(error).not.toBeNull();
    expect(error).toContain('10 MB');
  });

  it('accepts document at exactly 10 MB', () => {
    expect(validateDocument('application/pdf', MAX_DOCUMENT_SIZE)).toBeNull();
  });

  it('returns null when no content type or size provided', () => {
    expect(validateDocument(undefined, undefined)).toBeNull();
  });
});

// --- Certification Status State Machine Tests ---

describe('identity-service: validateStatusTransition', () => {
  it('allows pending → validated', () => {
    expect(validateStatusTransition(CertificationStatus.PENDING, CertificationStatus.VALIDATED)).toBeNull();
  });

  it('allows pending → rejected', () => {
    expect(validateStatusTransition(CertificationStatus.PENDING, CertificationStatus.REJECTED)).toBeNull();
  });

  it('allows pending → expired', () => {
    expect(validateStatusTransition(CertificationStatus.PENDING, CertificationStatus.EXPIRED)).toBeNull();
  });

  it('allows rejected → pending (re-upload)', () => {
    expect(validateStatusTransition(CertificationStatus.REJECTED, CertificationStatus.PENDING)).toBeNull();
  });

  it('allows rejected → expired', () => {
    expect(validateStatusTransition(CertificationStatus.REJECTED, CertificationStatus.EXPIRED)).toBeNull();
  });

  it('allows validated → expired', () => {
    expect(validateStatusTransition(CertificationStatus.VALIDATED, CertificationStatus.EXPIRED)).toBeNull();
  });

  it('rejects validated → pending', () => {
    const error = validateStatusTransition(CertificationStatus.VALIDATED, CertificationStatus.PENDING);
    expect(error).not.toBeNull();
    expect(error).toContain('Cannot transition');
  });

  it('rejects validated → rejected', () => {
    const error = validateStatusTransition(CertificationStatus.VALIDATED, CertificationStatus.REJECTED);
    expect(error).not.toBeNull();
  });

  it('rejects expired → any status', () => {
    for (const status of [CertificationStatus.PENDING, CertificationStatus.VALIDATED, CertificationStatus.REJECTED]) {
      const error = validateStatusTransition(CertificationStatus.EXPIRED, status);
      expect(error).not.toBeNull();
      expect(error).toContain('Cannot transition');
    }
  });

  it('rejects rejected → validated (must go through pending first)', () => {
    const error = validateStatusTransition(CertificationStatus.REJECTED, CertificationStatus.VALIDATED);
    expect(error).not.toBeNull();
  });
});

// --- Constants Verification ---

describe('identity-service: constants', () => {
  it('MAX_DOCUMENT_SIZE is 10 MB', () => {
    expect(MAX_DOCUMENT_SIZE).toBe(10 * 1024 * 1024);
  });

  it('ALLOWED_DOCUMENT_TYPES includes PDF, JPEG, PNG', () => {
    expect(ALLOWED_DOCUMENT_TYPES).toContain('application/pdf');
    expect(ALLOWED_DOCUMENT_TYPES).toContain('image/jpeg');
    expect(ALLOWED_DOCUMENT_TYPES).toContain('image/png');
    expect(ALLOWED_DOCUMENT_TYPES).toHaveLength(3);
  });

  it('VALID_STATUS_TRANSITIONS covers all statuses', () => {
    expect(Object.keys(VALID_STATUS_TRANSITIONS)).toHaveLength(4);
    expect(VALID_STATUS_TRANSITIONS[CertificationStatus.PENDING]).toBeDefined();
    expect(VALID_STATUS_TRANSITIONS[CertificationStatus.VALIDATED]).toBeDefined();
    expect(VALID_STATUS_TRANSITIONS[CertificationStatus.REJECTED]).toBeDefined();
    expect(VALID_STATUS_TRANSITIONS[CertificationStatus.EXPIRED]).toBeDefined();
  });
});
