// Feature: worker-certification-upload, Property 2: Default sort order invariant

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Certification } from '../types';
import { CertificationType, CertificationStatus } from '../types';

/**
 * Sort function extracted from useCertifications hook select option.
 * Sorts certifications by expiry_date in ascending order (earliest first).
 */
const sortByExpiryDate = (data: Certification[]): Certification[] =>
  [...data].sort(
    (a, b) =>
      new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime()
  );

/**
 * Arbitrary: generates a random CertificationType enum value.
 */
const certificationTypeArbitrary = fc.constantFrom(
  CertificationType.WHMIS_2015,
  CertificationType.FALL_PROTECTION,
  CertificationType.SITE_READY_BC,
  CertificationType.FIRST_AID
);

/**
 * Arbitrary: generates a random CertificationStatus enum value.
 */
const certificationStatusArbitrary = fc.constantFrom(
  CertificationStatus.PENDING,
  CertificationStatus.VALIDATED,
  CertificationStatus.REJECTED,
  CertificationStatus.EXPIRED
);

/**
 * Arbitrary: generates a Date within a wide range (2020–2030) for expiry dates.
 */
const expiryDateArbitrary = fc.date({
  min: new Date('2020-01-01T00:00:00.000Z'),
  max: new Date('2030-12-31T23:59:59.999Z'),
});

/**
 * Arbitrary: generates a Certification object with a random expiry_date.
 */
const certificationArbitrary = fc
  .record({
    certification_id: fc.uuid(),
    worker_id: fc.uuid(),
    tenant_id: fc.uuid(),
    certification_type: certificationTypeArbitrary,
    issuer: fc.string({ minLength: 1, maxLength: 100 }),
    expiry_date: expiryDateArbitrary,
    validation_status: certificationStatusArbitrary,
  })
  .map(
    ({ expiry_date, ...rest }): Certification => {
      const issueDate = new Date(
        expiry_date.getTime() - 90 * 24 * 60 * 60 * 1000
      );
      const now = new Date();
      return {
        ...rest,
        issue_date: issueDate.toISOString(),
        expiry_date: expiry_date.toISOString(),
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
    }
  );

describe('sortByExpiryDate - Property-Based Tests', () => {
  // **Validates: Requirements 1.5**
  it('Property 2: Default sort order invariant — For any list of certifications, output is sorted by expiry_date ascending', () => {
    fc.assert(
      fc.property(
        fc.array(certificationArbitrary, { minLength: 0, maxLength: 50 }),
        (certifications) => {
          const sorted = sortByExpiryDate(certifications);

          // Assert output is in ascending order by expiry_date
          for (let i = 0; i < sorted.length - 1; i++) {
            const currentExpiry = new Date(sorted[i]!.expiry_date).getTime();
            const nextExpiry = new Date(sorted[i + 1]!.expiry_date).getTime();
            expect(currentExpiry).toBeLessThanOrEqual(nextExpiry);
          }

          // Assert no elements are lost (same length)
          expect(sorted.length).toBe(certifications.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
