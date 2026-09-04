/**
 * Unit tests for form versioning logic (form-version.ts).
 * Tests version retrieval, listing, response association check, and immutability enforcement.
 *
 * Requirements: 14.1, 14.2, 14.3, 14.6
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn().mockImplementation((params) => ({ input: params })),
    GetCommand: vi.fn().mockImplementation((params) => ({ input: params })),
    QueryCommand: vi.fn().mockImplementation((params) => ({ input: params })),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

describe('forms: form versioning logic', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockAwsSdk();
  });

  // ─── padVersionNumber ───────────────────────────────────────────────────────

  describe('padVersionNumber', () => {
    it('pads single digit to 4 digits', async () => {
      const { padVersionNumber } = await import(
        '../../src/services/forms/form-version.js'
      );
      expect(padVersionNumber(1)).toBe('0001');
    });

    it('pads double digit to 4 digits', async () => {
      const { padVersionNumber } = await import(
        '../../src/services/forms/form-version.js'
      );
      expect(padVersionNumber(12)).toBe('0012');
    });

    it('pads triple digit to 4 digits', async () => {
      const { padVersionNumber } = await import(
        '../../src/services/forms/form-version.js'
      );
      expect(padVersionNumber(123)).toBe('0123');
    });

    it('does not pad 4-digit number', async () => {
      const { padVersionNumber } = await import(
        '../../src/services/forms/form-version.js'
      );
      expect(padVersionNumber(9999)).toBe('9999');
    });
  });

  // ─── getFormVersion ─────────────────────────────────────────────────────────

  describe('getFormVersion', () => {
    it('returns the version when found', async () => {
      const versionItem = {
        PK: 'FORM#form-123',
        SK: 'VERSION#0001',
        form_id: 'form-123',
        version_number: 1,
        fields_snapshot: [
          { field_id: 'f1', type: 'texto_corto', label: 'Name', required: true, order: 1 },
        ],
        created_at: '2024-01-15T10:00:00.000Z',
        created_by: 'user-1',
      };

      mockSend.mockResolvedValueOnce({ Item: versionItem });

      const { getFormVersion } = await import(
        '../../src/services/forms/form-version.js'
      );
      const result = await getFormVersion('form-123', 1);

      expect(result).toEqual(versionItem);
    });

    it('returns null when version not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const { getFormVersion } = await import(
        '../../src/services/forms/form-version.js'
      );
      const result = await getFormVersion('form-123', 99);

      expect(result).toBeNull();
    });
  });

  // ─── getFormVersions ────────────────────────────────────────────────────────

  describe('getFormVersions', () => {
    it('returns all versions sorted ascending', async () => {
      const versions = [
        {
          form_id: 'form-123',
          version_number: 1,
          fields_snapshot: [],
          created_at: '2024-01-01T00:00:00.000Z',
          created_by: 'user-1',
        },
        {
          form_id: 'form-123',
          version_number: 2,
          fields_snapshot: [],
          created_at: '2024-02-01T00:00:00.000Z',
          created_by: 'user-1',
        },
      ];

      mockSend.mockResolvedValueOnce({ Items: versions });

      const { getFormVersions } = await import(
        '../../src/services/forms/form-version.js'
      );
      const result = await getFormVersions('form-123');

      expect(result).toHaveLength(2);
      expect(result[0].version_number).toBe(1);
      expect(result[1].version_number).toBe(2);
    });

    it('returns empty array when no versions exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const { getFormVersions } = await import(
        '../../src/services/forms/form-version.js'
      );
      const result = await getFormVersions('form-nonexistent');

      expect(result).toEqual([]);
    });

    it('returns empty array when Items is undefined', async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined });

      const { getFormVersions } = await import(
        '../../src/services/forms/form-version.js'
      );
      const result = await getFormVersions('form-nonexistent');

      expect(result).toEqual([]);
    });
  });

  // ─── hasResponsesForVersion ─────────────────────────────────────────────────

  describe('hasResponsesForVersion', () => {
    it('returns true when responses exist for the version', async () => {
      mockSend.mockResolvedValueOnce({ Count: 1 });

      const { hasResponsesForVersion } = await import(
        '../../src/services/forms/form-version.js'
      );
      const result = await hasResponsesForVersion('form-123', 1);

      expect(result).toBe(true);
    });

    it('returns false when no responses exist for the version', async () => {
      mockSend.mockResolvedValueOnce({ Count: 0 });

      const { hasResponsesForVersion } = await import(
        '../../src/services/forms/form-version.js'
      );
      const result = await hasResponsesForVersion('form-123', 1);

      expect(result).toBe(false);
    });

    it('returns false when Count is undefined', async () => {
      mockSend.mockResolvedValueOnce({ Count: undefined });

      const { hasResponsesForVersion } = await import(
        '../../src/services/forms/form-version.js'
      );
      const result = await hasResponsesForVersion('form-123', 1);

      expect(result).toBe(false);
    });
  });

  // ─── rejectVersionModification ──────────────────────────────────────────────

  describe('rejectVersionModification', () => {
    it('throws error when version has responses (Req 14.6)', async () => {
      mockSend.mockResolvedValueOnce({ Count: 1 });

      const { rejectVersionModification } = await import(
        '../../src/services/forms/form-version.js'
      );

      await expect(
        rejectVersionModification('form-123', 1)
      ).rejects.toThrow(
        'La versión 1 del formulario no puede ser modificada ni eliminada porque tiene respuestas asociadas'
      );
    });

    it('does not throw when version has no responses', async () => {
      mockSend.mockResolvedValueOnce({ Count: 0 });

      const { rejectVersionModification } = await import(
        '../../src/services/forms/form-version.js'
      );

      await expect(
        rejectVersionModification('form-123', 1)
      ).resolves.toBeUndefined();
    });
  });

  // ─── createFormVersion (existing function) ──────────────────────────────────

  describe('createFormVersion', () => {
    it('creates version with sequential numbering from 1', async () => {
      // First call: getCurrentVersionNumber query returns no items (first version)
      mockSend.mockResolvedValueOnce({ Items: [] });
      // Second call: PutCommand succeeds
      mockSend.mockResolvedValueOnce({});

      const { createFormVersion } = await import(
        '../../src/services/forms/form-version.js'
      );

      const fields = [
        { field_id: 'f1', type: 'texto_corto', label: 'Name', required: true, order: 1 },
      ];

      const result = await createFormVersion('form-123', fields as any, 'user-1');

      expect(result.version_number).toBe(1);
      expect(result.form_id).toBe('form-123');
      expect(result.fields_snapshot).toEqual(fields);
      expect(result.created_by).toBe('user-1');
      expect(result.created_at).toBeDefined();
    });

    it('increments version number sequentially', async () => {
      // getCurrentVersionNumber returns version 2 as the latest
      mockSend.mockResolvedValueOnce({
        Items: [{ version_number: 2 }],
      });
      // PutCommand succeeds
      mockSend.mockResolvedValueOnce({});

      const { createFormVersion } = await import(
        '../../src/services/forms/form-version.js'
      );

      const result = await createFormVersion('form-123', [], 'user-1');

      expect(result.version_number).toBe(3);
    });
  });
});
