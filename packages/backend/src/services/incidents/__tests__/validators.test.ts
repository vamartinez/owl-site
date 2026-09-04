/**
 * Unit tests for the Incident Service validators module.
 * Verifies that invalid incident payloads are rejected with field-level errors.
 *
 * Requirements: 9.5
 */

import { describe, it, expect } from 'vitest';
import {
  incidentCreateSchema,
  incidentUpdateSchema,
  commentSchema,
  closureSchema,
  reopenSchema,
  createAttachmentSchema,
  personSchema,
  regulatoryDataSchema,
} from '../validators';
import { IncidentType, OperationalSeverity, InvolvementType } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildValidCreatePayload() {
  return {
    title: 'Workplace injury on floor 3',
    description: 'Worker slipped on wet surface and sustained minor injury.',
    incident_type: IncidentType.INJURY,
    incident_datetime: '2024-06-15T10:30:00Z',
    site_id: 'site-001',
    location: 'Building A, Floor 3',
    persons_involved_count: 1,
    severity: OperationalSeverity.MEDIUM,
    regulatory_indicators: {
      medical_treatment_beyond_first_aid: false,
      lost_time: false,
      hospitalization: false,
      fatality: false,
      amputation: false,
      loss_of_eye: false,
      structural_collapse: false,
      hazardous_substance_release: false,
      fire_or_explosion: false,
    },
  };
}

// ─── incidentCreateSchema ────────────────────────────────────────────────────

describe('incidentCreateSchema', () => {
  it('accepts a valid payload', () => {
    const result = incidentCreateSchema.safeParse(buildValidCreatePayload());
    expect(result.success).toBe(true);
  });

  describe('rejects missing required fields with field-level errors', () => {
    it('rejects missing title', () => {
      const payload = buildValidCreatePayload();
      delete (payload as Record<string, unknown>).title;

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('title');
      }
    });

    it('rejects missing description', () => {
      const payload = buildValidCreatePayload();
      delete (payload as Record<string, unknown>).description;

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('description');
      }
    });

    it('rejects missing incident_type', () => {
      const payload = buildValidCreatePayload();
      delete (payload as Record<string, unknown>).incident_type;

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('incident_type');
      }
    });

    it('rejects missing incident_datetime', () => {
      const payload = buildValidCreatePayload();
      delete (payload as Record<string, unknown>).incident_datetime;

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('incident_datetime');
      }
    });

    it('rejects missing site_id', () => {
      const payload = buildValidCreatePayload();
      delete (payload as Record<string, unknown>).site_id;

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('site_id');
      }
    });

    it('rejects missing severity', () => {
      const payload = buildValidCreatePayload();
      delete (payload as Record<string, unknown>).severity;

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('severity');
      }
    });

    it('rejects missing regulatory_indicators', () => {
      const payload = buildValidCreatePayload();
      delete (payload as Record<string, unknown>).regulatory_indicators;

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('regulatory_indicators');
      }
    });
  });

  describe('rejects wrong types with field-level errors', () => {
    it('rejects title as number', () => {
      const payload = { ...buildValidCreatePayload(), title: 12345 };

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('title');
      }
    });

    it('rejects persons_involved_count as string', () => {
      const payload = { ...buildValidCreatePayload(), persons_involved_count: 'five' };

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('persons_involved_count');
      }
    });

    it('rejects severity as number', () => {
      const payload = { ...buildValidCreatePayload(), severity: 3 };

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('severity');
      }
    });

    it('rejects regulatory_indicators as string', () => {
      const payload = { ...buildValidCreatePayload(), regulatory_indicators: 'none' };

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('regulatory_indicators');
      }
    });
  });

  describe('rejects invalid values with field-level errors', () => {
    it('rejects empty title', () => {
      const payload = { ...buildValidCreatePayload(), title: '' };

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('title');
      }
    });

    it('rejects title exceeding 200 characters', () => {
      const payload = { ...buildValidCreatePayload(), title: 'x'.repeat(201) };

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('title');
      }
    });

    it('rejects description exceeding 5000 characters', () => {
      const payload = { ...buildValidCreatePayload(), description: 'x'.repeat(5001) };

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('description');
      }
    });

    it('rejects invalid incident_type enum value', () => {
      const payload = { ...buildValidCreatePayload(), incident_type: 'explosion' };

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('incident_type');
      }
    });

    it('rejects invalid severity enum value', () => {
      const payload = { ...buildValidCreatePayload(), severity: 'extreme' };

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('severity');
      }
    });

    it('rejects negative persons_involved_count', () => {
      const payload = { ...buildValidCreatePayload(), persons_involved_count: -1 };

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('persons_involved_count');
      }
    });

    it('rejects non-integer persons_involved_count', () => {
      const payload = { ...buildValidCreatePayload(), persons_involved_count: 2.5 };

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('persons_involved_count');
      }
    });

    it('rejects incident_type "other" without other_type_description', () => {
      const payload = { ...buildValidCreatePayload(), incident_type: IncidentType.OTHER };

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('other_type_description');
      }
    });

    it('rejects incident_type "other" with short other_type_description', () => {
      const payload = {
        ...buildValidCreatePayload(),
        incident_type: IncidentType.OTHER,
        other_type_description: 'short',
      };

      const result = incidentCreateSchema.safeParse(payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path[0]);
        expect(paths).toContain('other_type_description');
      }
    });
  });

  it('rejects completely empty body', () => {
    const result = incidentCreateSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it('rejects null body', () => {
    const result = incidentCreateSchema.safeParse(null);
    expect(result.success).toBe(false);
  });
});

// ─── incidentUpdateSchema ────────────────────────────────────────────────────

describe('incidentUpdateSchema', () => {
  it('accepts a valid partial update', () => {
    const result = incidentUpdateSchema.safeParse({ title: 'Updated title' });
    expect(result.success).toBe(true);
  });

  it('accepts an empty object (no fields to update)', () => {
    const result = incidentUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects empty title when provided', () => {
    const result = incidentUpdateSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('title');
    }
  });

  it('rejects title exceeding 200 characters', () => {
    const result = incidentUpdateSchema.safeParse({ title: 'x'.repeat(201) });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('title');
    }
  });

  it('rejects invalid severity value', () => {
    const result = incidentUpdateSchema.safeParse({ severity: 'unknown' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('severity');
    }
  });

  it('rejects persons_involved_count as non-integer', () => {
    const result = incidentUpdateSchema.safeParse({ persons_involved_count: 1.7 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('persons_involved_count');
    }
  });

  it('rejects incident_type "other" without description in update', () => {
    const result = incidentUpdateSchema.safeParse({
      incident_type: IncidentType.OTHER,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('other_type_description');
    }
  });
});

// ─── commentSchema ───────────────────────────────────────────────────────────

describe('commentSchema', () => {
  it('accepts valid non-empty comment', () => {
    const result = commentSchema.safeParse({ content: 'This is a valid comment.' });
    expect(result.success).toBe(true);
  });

  it('rejects empty string content', () => {
    const result = commentSchema.safeParse({ content: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('content');
    }
  });

  it('rejects whitespace-only content', () => {
    const result = commentSchema.safeParse({ content: '   \t\n  ' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('content');
    }
  });

  it('rejects content exceeding 5000 characters', () => {
    const result = commentSchema.safeParse({ content: 'x'.repeat(5001) });
    expect(result.success).toBe(false);
  });

  it('rejects missing content field', () => {
    const result = commentSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects content as number', () => {
    const result = commentSchema.safeParse({ content: 123 });
    expect(result.success).toBe(false);
  });
});

// ─── closureSchema ───────────────────────────────────────────────────────────

describe('closureSchema', () => {
  it('accepts resolution notes >= 20 characters', () => {
    const result = closureSchema.safeParse({
      resolution_notes: 'This issue has been fully resolved and closed.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects resolution notes shorter than 20 characters', () => {
    const result = closureSchema.safeParse({ resolution_notes: 'Too short.' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('resolution_notes');
    }
  });

  it('rejects whitespace-padded notes that trim to < 20 chars', () => {
    const result = closureSchema.safeParse({ resolution_notes: '   short   ' });
    expect(result.success).toBe(false);
  });

  it('rejects missing resolution_notes', () => {
    const result = closureSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ─── reopenSchema ────────────────────────────────────────────────────────────

describe('reopenSchema', () => {
  it('accepts justification >= 20 characters', () => {
    const result = reopenSchema.safeParse({
      justification: 'New evidence has emerged requiring further review.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects justification shorter than 20 characters', () => {
    const result = reopenSchema.safeParse({ justification: 'Need review' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('justification');
    }
  });

  it('rejects missing justification', () => {
    const result = reopenSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ─── createAttachmentSchema ──────────────────────────────────────────────────

describe('createAttachmentSchema', () => {
  it('accepts valid non-video attachment', () => {
    const result = createAttachmentSchema.safeParse({
      file_name: 'photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 1024,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing file_name', () => {
    const result = createAttachmentSchema.safeParse({
      mime_type: 'image/jpeg',
      size_bytes: 1024,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('file_name');
    }
  });

  it('rejects empty file_name', () => {
    const result = createAttachmentSchema.safeParse({
      file_name: '',
      mime_type: 'image/jpeg',
      size_bytes: 1024,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('file_name');
    }
  });

  it('rejects unsupported mime_type', () => {
    const result = createAttachmentSchema.safeParse({
      file_name: 'file.zip',
      mime_type: 'application/zip',
      size_bytes: 1024,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('mime_type');
    }
  });

  it('rejects zero size_bytes', () => {
    const result = createAttachmentSchema.safeParse({
      file_name: 'photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('size_bytes');
    }
  });

  it('rejects size_bytes exceeding max', () => {
    const result = createAttachmentSchema.safeParse({
      file_name: 'photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 50 * 1024 * 1024 + 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('size_bytes');
    }
  });

  it('rejects video without duration_seconds', () => {
    const result = createAttachmentSchema.safeParse({
      file_name: 'video.mp4',
      mime_type: 'video/mp4',
      size_bytes: 1024,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('duration_seconds');
    }
  });

  it('rejects video with duration exceeding 60 seconds', () => {
    const result = createAttachmentSchema.safeParse({
      file_name: 'video.mp4',
      mime_type: 'video/mp4',
      size_bytes: 1024,
      duration_seconds: 61,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('duration_seconds');
    }
  });

  it('rejects size_bytes as string', () => {
    const result = createAttachmentSchema.safeParse({
      file_name: 'photo.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 'large',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('size_bytes');
    }
  });
});

// ─── personSchema ────────────────────────────────────────────────────────────

describe('personSchema', () => {
  it('accepts valid person payload', () => {
    const result = personSchema.safeParse({
      full_name: 'Jane Smith',
      involvement_type: InvolvementType.WITNESS,
      organization: 'ACME Corp',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing full_name', () => {
    const result = personSchema.safeParse({
      involvement_type: InvolvementType.WITNESS,
      organization: 'ACME Corp',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('full_name');
    }
  });

  it('rejects empty full_name', () => {
    const result = personSchema.safeParse({
      full_name: '',
      involvement_type: InvolvementType.WITNESS,
      organization: 'ACME Corp',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('full_name');
    }
  });

  it('rejects invalid involvement_type', () => {
    const result = personSchema.safeParse({
      full_name: 'Jane Smith',
      involvement_type: 'bystander',
      organization: 'ACME Corp',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('involvement_type');
    }
  });

  it('rejects missing organization', () => {
    const result = personSchema.safeParse({
      full_name: 'Jane Smith',
      involvement_type: InvolvementType.WITNESS,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('organization');
    }
  });

  it('rejects empty organization', () => {
    const result = personSchema.safeParse({
      full_name: 'Jane Smith',
      involvement_type: InvolvementType.WITNESS,
      organization: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('organization');
    }
  });
});

// ─── regulatoryDataSchema ────────────────────────────────────────────────────

describe('regulatoryDataSchema', () => {
  it('accepts valid worksafebc_employer type', () => {
    const result = regulatoryDataSchema.safeParse({
      type: 'worksafebc_employer',
      data: { employer_name: 'ACME Corp', is_complete: false },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid type value', () => {
    const result = regulatoryDataSchema.safeParse({
      type: 'invalid_type',
      data: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('type');
    }
  });

  it('rejects missing type field', () => {
    const result = regulatoryDataSchema.safeParse({
      data: { employer_name: 'ACME Corp' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing data field', () => {
    const result = regulatoryDataSchema.safeParse({
      type: 'worksafebc_employer',
    });
    expect(result.success).toBe(false);
  });
});
