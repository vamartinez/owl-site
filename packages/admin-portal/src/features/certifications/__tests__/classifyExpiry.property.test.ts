// Feature: worker-certification-upload, Property 5: Expiry classification correctness
// Feature: worker-certification-upload, Property 6: Expiry summary count consistency

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { classifyExpiry } from '../utils/classifyExpiry';
import type { Certification } from '../types';
import { CertificationType, CertificationStatus } from '../types';

/**
 * Helper: compute expected expiry status for a given date relative to now.
 * Uses the same logic boundary as classifyExpiry (Math.ceil of day difference).
 */
function expectedClassification(expiryDate: Date, now: Date): 'expired' | 'expiring' | 'valid' {
  const daysUntilExpiry = Math.ceil(
    (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysUntilExpiry < 0) return 'expired';
  if (daysUntilExpiry <= 30) return 'expiring';
  return 'valid';
}

/**
 * Arbitrary: generates a Date within a reasonable range around now
 * (up to 365 days in the past or future).
 */
const dateArbitrary = fc.date({
  min: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
  max: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
});

/**
 * Arbitrary: generates a minimal Certification object with a random expiry_date.
 */
const certificationArbitrary = dateArbitrary.map((date): Certification => {
  const now = new Date();
  const issueDate = new Date(date.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days before expiry
  return {
    certification_id: 'cert-' + Math.random().toString(36).slice(2),
    worker_id: 'worker-1',
    tenant_id: 'tenant-1',
    certification_type: CertificationType.WHMIS_2015,
    issuer: 'Test Issuer',
    issue_date: issueDate.toISOString(),
    expiry_date: date.toISOString(),
    validation_status: CertificationStatus.VALIDATED,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
});

describe('classifyExpiry - Property-Based Tests', () => {
  // **Validates: Requirements 4.1, 4.2, 4.3**
  it('Property 5: Expiry classification correctness — classifyExpiry returns correct category based on 30-day threshold', () => {
    fc.assert(
      fc.property(dateArbitrary, (expiryDate) => {
        const now = new Date();
        const result = classifyExpiry(expiryDate.toISOString());
        const expected = expectedClassification(expiryDate, now);

        expect(result).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  // **Validates: Requirements 4.4**
  it('Property 6: Expiry summary count consistency — count of each category matches filter results', () => {
    fc.assert(
      fc.property(
        fc.array(certificationArbitrary, { minLength: 0, maxLength: 50 }),
        (certifications) => {
          // Compute counts by classifying each certification
          const counts = { valid: 0, expiring: 0, expired: 0 };
          for (const cert of certifications) {
            const status = classifyExpiry(cert.expiry_date);
            counts[status]++;
          }

          // Verify counts match filtering by each category
          const validFiltered = certifications.filter(
            (c) => classifyExpiry(c.expiry_date) === 'valid'
          );
          const expiringFiltered = certifications.filter(
            (c) => classifyExpiry(c.expiry_date) === 'expiring'
          );
          const expiredFiltered = certifications.filter(
            (c) => classifyExpiry(c.expiry_date) === 'expired'
          );

          expect(counts.valid).toBe(validFiltered.length);
          expect(counts.expiring).toBe(expiringFiltered.length);
          expect(counts.expired).toBe(expiredFiltered.length);

          // Total should equal array length
          expect(counts.valid + counts.expiring + counts.expired).toBe(
            certifications.length
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
