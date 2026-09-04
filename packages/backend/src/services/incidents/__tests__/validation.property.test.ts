// Feature: incident-reporting, Properties 2, 3, 4, 8, 9, 10, 11: Validation schema property tests

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  incidentCreateSchema,
  regulatoryIndicatorsSchema,
  createAttachmentSchema,
  commentSchema,
  closureSchema,
  reopenSchema,
  ALLOWED_EVIDENCE_TYPES,
  MAX_FILE_SIZE,
  MAX_VIDEO_DURATION_SECONDS,
} from '../validators';
import { IncidentType, OperationalSeverity } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ALL_INCIDENT_TYPES = Object.values(IncidentType);
const NON_OTHER_TYPES = ALL_INCIDENT_TYPES.filter((t) => t !== IncidentType.OTHER);
const ALL_SEVERITIES = Object.values(OperationalSeverity);

/**
 * Generates a complete valid incident creation payload (non-"other" type).
 */
const validBasePayloadArb = fc.record({
  title: fc.string({ minLength: 1, maxLength: 200 }),
  description: fc.string({ minLength: 1, maxLength: 5000 }),
  incident_type: fc.constantFrom(...NON_OTHER_TYPES),
  incident_datetime: fc.constant('2024-06-15T10:30:00Z'),
  site_id: fc.string({ minLength: 1, maxLength: 50 }),
  location: fc.string({ minLength: 1, maxLength: 200 }),
  persons_involved_count: fc.nat({ max: 1000 }),
  severity: fc.constantFrom(...ALL_SEVERITIES),
  regulatory_indicators: fc.record({
    medical_treatment_beyond_first_aid: fc.boolean(),
    lost_time: fc.boolean(),
    hospitalization: fc.boolean(),
    fatality: fc.boolean(),
    amputation: fc.boolean(),
    loss_of_eye: fc.boolean(),
    structural_collapse: fc.boolean(),
    hazardous_substance_release: fc.boolean(),
    fire_or_explosion: fc.boolean(),
  }),
});

/**
 * Mandatory field keys for incident creation.
 */
const MANDATORY_FIELDS = [
  'title',
  'description',
  'incident_type',
  'incident_datetime',
  'site_id',
  'location',
  'persons_involved_count',
  'severity',
  'regulatory_indicators',
] as const;

// ─── Property 2 ──────────────────────────────────────────────────────────────

describe('Property 2: Missing mandatory fields are rejected with field identification', () => {
  // **Validates: Requirements 1.3, 3.1**

  it('removing at least one mandatory field causes schema rejection identifying the missing field', () => {
    // Generate a valid payload and a non-empty subset of mandatory fields to remove
    const fieldsToRemoveArb = fc
      .subarray([...MANDATORY_FIELDS], { minLength: 1 })
      .filter((arr) => arr.length >= 1);

    fc.assert(
      fc.property(validBasePayloadArb, fieldsToRemoveArb, (payload, fieldsToRemove) => {
        const incomplete = { ...payload } as Record<string, unknown>;
        for (const field of fieldsToRemove) {
          delete incomplete[field];
        }

        const result = incidentCreateSchema.safeParse(incomplete);
        expect(result.success).toBe(false);

        if (!result.success) {
          const errorPaths = result.error.issues.map((issue) => issue.path[0]);
          // At least one of the removed fields should appear in the error paths
          const hasIdentifiedField = fieldsToRemove.some((field) =>
            errorPaths.includes(field),
          );
          expect(hasIdentifiedField).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 3 ──────────────────────────────────────────────────────────────

describe('Property 3: "Other" incident type requires description >= 10 chars', () => {
  // **Validates: Requirements 2.3**

  it('incident_type "other" with description < 10 chars is rejected', () => {
    const shortDescArb = fc.string({ minLength: 0, maxLength: 9 });

    fc.assert(
      fc.property(validBasePayloadArb, shortDescArb, (basePayload, shortDesc) => {
        const payload = {
          ...basePayload,
          incident_type: IncidentType.OTHER,
          other_type_description: shortDesc,
        };

        const result = incidentCreateSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('incident_type "other" with description >= 10 chars is accepted', () => {
    const longDescArb = fc.string({ minLength: 10, maxLength: 500 });

    fc.assert(
      fc.property(validBasePayloadArb, longDescArb, (basePayload, longDesc) => {
        const payload = {
          ...basePayload,
          incident_type: IncidentType.OTHER,
          other_type_description: longDesc,
        };

        const result = incidentCreateSchema.safeParse(payload);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('incident_type "other" with missing description is rejected', () => {
    fc.assert(
      fc.property(validBasePayloadArb, (basePayload) => {
        const payload = {
          ...basePayload,
          incident_type: IncidentType.OTHER,
          // no other_type_description
        };

        const result = incidentCreateSchema.safeParse(payload);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4 ──────────────────────────────────────────────────────────────

describe('Property 4: Regulatory indicators default to false when omitted', () => {
  // **Validates: Requirements 3.3**

  const ALL_INDICATOR_KEYS = [
    'medical_treatment_beyond_first_aid',
    'lost_time',
    'hospitalization',
    'fatality',
    'amputation',
    'loss_of_eye',
    'structural_collapse',
    'hazardous_substance_release',
    'fire_or_explosion',
  ] as const;

  it('omitted fields in regulatory indicators default to false', () => {
    // Generate a subset of keys to include (the rest are omitted)
    const keysToIncludeArb = fc.subarray([...ALL_INDICATOR_KEYS]);

    fc.assert(
      fc.property(keysToIncludeArb, (keysToInclude) => {
        const partial: Record<string, boolean> = {};
        for (const key of keysToInclude) {
          partial[key] = true; // Set included keys to true
        }

        const result = regulatoryIndicatorsSchema.parse(partial);

        // All omitted keys should be false
        for (const key of ALL_INDICATOR_KEYS) {
          if (!keysToInclude.includes(key)) {
            expect(result[key]).toBe(false);
          } else {
            expect(result[key]).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('empty object produces all false values', () => {
    const result = regulatoryIndicatorsSchema.parse({});
    for (const key of ALL_INDICATOR_KEYS) {
      expect(result[key]).toBe(false);
    }
  });
});

// ─── Property 8 ──────────────────────────────────────────────────────────────

describe('Property 8: Attachment validation accepts valid files and rejects invalid ones', () => {
  // **Validates: Requirements 12.1, 12.2, 12.3**

  const VALID_MIME_TYPES = [...ALLOWED_EVIDENCE_TYPES];
  const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime'];
  const NON_VIDEO_MIME_TYPES = VALID_MIME_TYPES.filter(
    (t) => !VIDEO_MIME_TYPES.includes(t),
  );
  const INVALID_MIME_TYPES = [
    'application/zip',
    'text/plain',
    'image/gif',
    'video/avi',
    'application/json',
    'audio/mp3',
  ];

  it('valid non-video files within size limit are accepted', () => {
    const validNonVideoArb = fc.record({
      file_name: fc.string({ minLength: 1, maxLength: 100 }),
      mime_type: fc.constantFrom(...NON_VIDEO_MIME_TYPES),
      size_bytes: fc.integer({ min: 1, max: MAX_FILE_SIZE }),
    });

    fc.assert(
      fc.property(validNonVideoArb, (file) => {
        const result = createAttachmentSchema.safeParse(file);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('valid video files within size and duration limits are accepted', () => {
    const validVideoArb = fc.record({
      file_name: fc.string({ minLength: 1, maxLength: 100 }),
      mime_type: fc.constantFrom(...VIDEO_MIME_TYPES),
      size_bytes: fc.integer({ min: 1, max: MAX_FILE_SIZE }),
      duration_seconds: fc.integer({ min: 0, max: MAX_VIDEO_DURATION_SECONDS }),
    });

    fc.assert(
      fc.property(validVideoArb, (file) => {
        const result = createAttachmentSchema.safeParse(file);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('files with invalid MIME types are rejected', () => {
    const invalidMimeArb = fc.record({
      file_name: fc.string({ minLength: 1, maxLength: 100 }),
      mime_type: fc.constantFrom(...INVALID_MIME_TYPES),
      size_bytes: fc.integer({ min: 1, max: MAX_FILE_SIZE }),
    });

    fc.assert(
      fc.property(invalidMimeArb, (file) => {
        const result = createAttachmentSchema.safeParse(file);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('files exceeding size limit are rejected', () => {
    const oversizedArb = fc.record({
      file_name: fc.string({ minLength: 1, maxLength: 100 }),
      mime_type: fc.constantFrom(...VALID_MIME_TYPES),
      size_bytes: fc.integer({ min: MAX_FILE_SIZE + 1, max: MAX_FILE_SIZE * 2 }),
    });

    fc.assert(
      fc.property(oversizedArb, (file) => {
        const result = createAttachmentSchema.safeParse(file);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('video files exceeding duration limit are rejected', () => {
    const longVideoArb = fc.record({
      file_name: fc.string({ minLength: 1, maxLength: 100 }),
      mime_type: fc.constantFrom(...VIDEO_MIME_TYPES),
      size_bytes: fc.integer({ min: 1, max: MAX_FILE_SIZE }),
      duration_seconds: fc.integer({
        min: MAX_VIDEO_DURATION_SECONDS + 1,
        max: MAX_VIDEO_DURATION_SECONDS * 10,
      }),
    });

    fc.assert(
      fc.property(longVideoArb, (file) => {
        const result = createAttachmentSchema.safeParse(file);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('video files without duration_seconds are rejected', () => {
    const videoNoDurationArb = fc.record({
      file_name: fc.string({ minLength: 1, maxLength: 100 }),
      mime_type: fc.constantFrom(...VIDEO_MIME_TYPES),
      size_bytes: fc.integer({ min: 1, max: MAX_FILE_SIZE }),
    });

    fc.assert(
      fc.property(videoNoDurationArb, (file) => {
        const result = createAttachmentSchema.safeParse(file);
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 9 ──────────────────────────────────────────────────────────────

describe('Property 9: Empty or whitespace-only comments are rejected', () => {
  // **Validates: Requirements 14.4**

  it('whitespace-only strings are rejected', () => {
    const whitespaceArb = fc
      .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), { minLength: 0, maxLength: 100 })
      .map((chars) => chars.join(''));

    fc.assert(
      fc.property(whitespaceArb, (whitespace) => {
        const result = commentSchema.safeParse({ content: whitespace });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('non-empty trimmed strings of length 1-5000 are accepted', () => {
    // Generate strings that have at least 1 non-whitespace character and total length <= 5000
    const validCommentArb = fc
      .string({ minLength: 1, maxLength: 5000 })
      .filter((s) => s.trim().length >= 1 && s.trim().length <= 5000);

    fc.assert(
      fc.property(validCommentArb, (content) => {
        const result = commentSchema.safeParse({ content });
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 10 ─────────────────────────────────────────────────────────────

describe('Property 10: Closure requires resolution notes >= 20 chars', () => {
  // **Validates: Requirements 19.1, 19.2**

  it('strings with trimmed length < 20 are rejected', () => {
    // Generate strings whose trimmed length is < 20
    const shortNotesArb = fc
      .string({ minLength: 0, maxLength: 50 })
      .filter((s) => s.trim().length < 20);

    fc.assert(
      fc.property(shortNotesArb, (notes) => {
        const result = closureSchema.safeParse({ resolution_notes: notes });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('strings with trimmed length >= 20 are accepted', () => {
    // Generate strings with at least 20 non-whitespace characters
    const longNotesArb = fc
      .string({ minLength: 20, maxLength: 500 })
      .filter((s) => s.trim().length >= 20);

    fc.assert(
      fc.property(longNotesArb, (notes) => {
        const result = closureSchema.safeParse({ resolution_notes: notes });
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 11 ─────────────────────────────────────────────────────────────

describe('Property 11: Reopen requires justification >= 20 chars', () => {
  // **Validates: Requirements 20.1, 20.3**

  it('strings with trimmed length < 20 are rejected', () => {
    const shortJustificationArb = fc
      .string({ minLength: 0, maxLength: 50 })
      .filter((s) => s.trim().length < 20);

    fc.assert(
      fc.property(shortJustificationArb, (justification) => {
        const result = reopenSchema.safeParse({ justification });
        expect(result.success).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('strings with trimmed length >= 20 are accepted', () => {
    const longJustificationArb = fc
      .string({ minLength: 20, maxLength: 500 })
      .filter((s) => s.trim().length >= 20);

    fc.assert(
      fc.property(longJustificationArb, (justification) => {
        const result = reopenSchema.safeParse({ justification });
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
