// Feature: contractor-forms-qr, Property 25: Versionado secuencial e inmutable
// Feature: contractor-forms-qr, Property 26: Versiones con respuestas son inmutables

/**
 * Property-based tests for form versioning module.
 *
 * Property 25: Version numbers are sequential starting from 1, and each version's
 * fields_snapshot is immutable (identical to the fields provided at creation time).
 *
 * Property 26: Versions with existing responses cannot be modified or deleted
 * (rejectVersionModification throws an error).
 *
 * **Validates: Requirements 14.1, 14.2, 14.3, 14.6**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { FieldType } from '../../src/services/forms/types.js';
import type { FieldConfig, FieldOption, FormVersion } from '../../src/services/forms/types.js';

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockSend = vi.fn();
let capturedPutItems: any[] = [];

const mockAwsSdk = () => {
  vi.doMock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
    PutCommand: vi.fn().mockImplementation((params) => {
      capturedPutItems.push(params);
      return params;
    }),
    GetCommand: vi.fn().mockImplementation((params) => params),
    QueryCommand: vi.fn().mockImplementation((params) => params),
  }));
  vi.doMock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: vi.fn(() => ({})),
  }));
};

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Arbitrary for valid labels (1-200 chars) */
const arbValidLabel = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.length >= 1 && s.length <= 200);

/** Arbitrary for valid option */
const arbValidOption = fc.record({
  option_id: fc.uuid(),
  label: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.length >= 1),
}) as fc.Arbitrary<FieldOption>;

/** Arbitrary for valid options array (2-10 options for performance) */
const arbValidOptions = fc.array(arbValidOption, { minLength: 2, maxLength: 10 });

/** Non-selection field types */
const NON_SELECTION_TYPES = [
  FieldType.TEXTO_CORTO,
  FieldType.TEXTO_LARGO,
  FieldType.NUMERO,
  FieldType.FECHA,
  FieldType.CHECKBOX_ACEPTACION,
  FieldType.CARGA_ARCHIVO,
];

/** Arbitrary for a valid non-selection field */
const arbValidNonSelectionField = fc
  .tuple(
    fc.uuid(),
    fc.constantFrom(...NON_SELECTION_TYPES),
    arbValidLabel,
    fc.boolean(),
    fc.integer({ min: 1, max: 50 }),
  )
  .map(([field_id, type, label, required, order]) => ({
    field_id,
    type,
    label,
    required,
    order,
  })) as fc.Arbitrary<FieldConfig>;

/** Arbitrary for a valid selection field */
const arbValidSelectionField = fc
  .tuple(
    fc.uuid(),
    fc.constantFrom(FieldType.SELECCION_SIMPLE, FieldType.SELECCION_MULTIPLE),
    arbValidLabel,
    fc.boolean(),
    fc.integer({ min: 1, max: 50 }),
    arbValidOptions,
  )
  .map(([field_id, type, label, required, order, options]) => ({
    field_id,
    type,
    label,
    required,
    order,
    options,
  })) as fc.Arbitrary<FieldConfig>;

/** Arbitrary for any valid field */
const arbValidField = fc.oneof(arbValidNonSelectionField, arbValidSelectionField);

/** Arbitrary for a valid fields array (1-10 fields for performance) */
const arbValidFieldsArray = fc.array(arbValidField, { minLength: 1, maxLength: 10 });

/** Arbitrary for form IDs */
const arbFormId = fc.uuid();

/** Arbitrary for user IDs */
const arbUserId = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
    minLength: 3,
    maxLength: 36,
  })
  .map((id) => `user-${id}`);

/** Arbitrary for existing version numbers (1-100) */
const arbExistingVersionNumber = fc.integer({ min: 1, max: 100 });

/** Arbitrary for number of sequential versions to create (1-5 for performance) */
const arbVersionCount = fc.integer({ min: 1, max: 5 });

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Forms Versioning Property Tests', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    capturedPutItems = [];
    mockAwsSdk();
    process.env['ENVIRONMENT'] = 'dev';
  });

  // **Validates: Requirements 14.1, 14.2, 14.3**
  describe('Property 25: Versionado secuencial e inmutable', () => {
    it('version numbers are sequential starting from 1 when no prior versions exist', () => {
      fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbValidFieldsArray,
          arbUserId,
          async (formId, fields, userId) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            // Mock: no existing versions (getCurrentVersionNumber returns 0)
            mockSend.mockResolvedValueOnce({ Items: [] }); // QueryCommand for current version
            // Mock: PutCommand succeeds
            mockSend.mockResolvedValueOnce({});

            const { createFormVersion } = await import(
              '../../src/services/forms/form-version.js'
            );

            const version = await createFormVersion(formId, fields, userId);

            // First version must be 1
            expect(version.version_number).toBe(1);
            expect(version.form_id).toBe(formId);
            expect(version.created_by).toBe(userId);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('version numbers increment sequentially from the current highest version', () => {
      fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbValidFieldsArray,
          arbUserId,
          arbExistingVersionNumber,
          async (formId, fields, userId, existingVersion) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            // Mock: existing version number returned by getCurrentVersionNumber
            mockSend.mockResolvedValueOnce({
              Items: [{ version_number: existingVersion } as FormVersion],
            });
            // Mock: PutCommand succeeds
            mockSend.mockResolvedValueOnce({});

            const { createFormVersion } = await import(
              '../../src/services/forms/form-version.js'
            );

            const version = await createFormVersion(formId, fields, userId);

            // New version must be exactly existingVersion + 1
            expect(version.version_number).toBe(existingVersion + 1);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('fields_snapshot is identical to the fields provided at creation time', () => {
      fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbValidFieldsArray,
          arbUserId,
          async (formId, fields, userId) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            // Mock: no existing versions
            mockSend.mockResolvedValueOnce({ Items: [] });
            // Mock: PutCommand succeeds
            mockSend.mockResolvedValueOnce({});

            const { createFormVersion } = await import(
              '../../src/services/forms/form-version.js'
            );

            const version = await createFormVersion(formId, fields, userId);

            // fields_snapshot must be deeply equal to the input fields
            expect(version.fields_snapshot).toEqual(fields);

            // Verify each field property is preserved
            for (let i = 0; i < fields.length; i++) {
              expect(version.fields_snapshot[i].field_id).toBe(fields[i].field_id);
              expect(version.fields_snapshot[i].type).toBe(fields[i].type);
              expect(version.fields_snapshot[i].label).toBe(fields[i].label);
              expect(version.fields_snapshot[i].required).toBe(fields[i].required);
              expect(version.fields_snapshot[i].order).toBe(fields[i].order);
              if (fields[i].options) {
                expect(version.fields_snapshot[i].options).toEqual(fields[i].options);
              }
              if (fields[i].validation) {
                expect(version.fields_snapshot[i].validation).toEqual(fields[i].validation);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('multiple sequential versions maintain correct numbering without gaps', () => {
      fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbUserId,
          arbVersionCount,
          fc.array(arbValidFieldsArray, { minLength: 1, maxLength: 5 }),
          async (formId, userId, versionCount, fieldSets) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            const { createFormVersion } = await import(
              '../../src/services/forms/form-version.js'
            );

            const createdVersions: FormVersion[] = [];
            const actualCount = Math.min(versionCount, fieldSets.length);

            for (let i = 0; i < actualCount; i++) {
              // Reset mocks for each iteration
              mockSend.mockReset();

              // Mock: getCurrentVersionNumber returns the count of previously created versions
              if (i === 0) {
                mockSend.mockResolvedValueOnce({ Items: [] });
              } else {
                mockSend.mockResolvedValueOnce({
                  Items: [{ version_number: i } as FormVersion],
                });
              }
              // Mock: PutCommand succeeds
              mockSend.mockResolvedValueOnce({});

              const version = await createFormVersion(formId, fieldSets[i], userId);
              createdVersions.push(version);
            }

            // Verify sequential numbering starting from 1
            for (let i = 0; i < createdVersions.length; i++) {
              expect(createdVersions[i].version_number).toBe(i + 1);
            }

            // Verify each version has its own fields_snapshot
            for (let i = 0; i < createdVersions.length; i++) {
              expect(createdVersions[i].fields_snapshot).toEqual(fieldSets[i]);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('the PutCommand stores the version with correct DynamoDB keys (PK/SK)', () => {
      fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbValidFieldsArray,
          arbUserId,
          arbExistingVersionNumber,
          async (formId, fields, userId, existingVersion) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            // Mock: existing version
            mockSend.mockResolvedValueOnce({
              Items: [{ version_number: existingVersion } as FormVersion],
            });
            // Mock: PutCommand succeeds
            mockSend.mockResolvedValueOnce({});

            const { createFormVersion, padVersionNumber } = await import(
              '../../src/services/forms/form-version.js'
            );

            await createFormVersion(formId, fields, userId);

            // Verify the PutCommand was called with correct keys
            const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
            const putCalls = (PutCommand as unknown as ReturnType<typeof vi.fn>).mock.calls;

            expect(putCalls.length).toBeGreaterThanOrEqual(1);
            const putItem = putCalls[0][0].Item;

            const expectedVersionNumber = existingVersion + 1;
            expect(putItem.PK).toBe(`FORM#${formId}`);
            expect(putItem.SK).toBe(`VERSION#${padVersionNumber(expectedVersionNumber)}`);
            expect(putItem.form_id).toBe(formId);
            expect(putItem.version_number).toBe(expectedVersionNumber);
            expect(putItem.fields_snapshot).toEqual(fields);
            expect(putItem.created_by).toBe(userId);
            // created_at must be a valid ISO 8601 string
            expect(new Date(putItem.created_at).toISOString()).toBe(putItem.created_at);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // **Validates: Requirements 14.6**
  describe('Property 26: Versiones con respuestas son inmutables', () => {
    it('rejectVersionModification throws when the version has associated responses', () => {
      fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbExistingVersionNumber,
          async (formId, versionNumber) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            // Mock: hasResponsesForVersion returns true (Count > 0)
            mockSend.mockResolvedValueOnce({ Count: 1 });

            const { rejectVersionModification } = await import(
              '../../src/services/forms/form-version.js'
            );

            // Must throw an error
            await expect(
              rejectVersionModification(formId, versionNumber),
            ).rejects.toThrow();

            // Verify the error message mentions the version number
            try {
              await rejectVersionModification(formId, versionNumber);
            } catch (error: any) {
              expect(error.message).toContain(`${versionNumber}`);
              expect(error.message).toContain('no puede ser modificada ni eliminada');
              expect(error.message).toContain('respuestas asociadas');
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejectVersionModification does NOT throw when the version has no responses', () => {
      fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbExistingVersionNumber,
          async (formId, versionNumber) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            // Mock: hasResponsesForVersion returns false (Count = 0)
            mockSend.mockResolvedValueOnce({ Count: 0 });

            const { rejectVersionModification } = await import(
              '../../src/services/forms/form-version.js'
            );

            // Must NOT throw
            await expect(
              rejectVersionModification(formId, versionNumber),
            ).resolves.toBeUndefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('hasResponsesForVersion correctly identifies versions with responses', () => {
      fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbExistingVersionNumber,
          fc.boolean(),
          async (formId, versionNumber, hasResponses) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            // Mock: QueryCommand returns Count based on hasResponses
            mockSend.mockResolvedValueOnce({ Count: hasResponses ? 1 : 0 });

            const { hasResponsesForVersion } = await import(
              '../../src/services/forms/form-version.js'
            );

            const result = await hasResponsesForVersion(formId, versionNumber);

            expect(result).toBe(hasResponses);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('rejectVersionModification queries the correct form and version number', () => {
      fc.assert(
        fc.asyncProperty(
          arbFormId,
          arbExistingVersionNumber,
          async (formId, versionNumber) => {
            vi.resetModules();
            mockSend.mockReset();
            capturedPutItems = [];
            mockAwsSdk();

            // Mock: no responses (Count = 0) so it doesn't throw
            mockSend.mockResolvedValueOnce({ Count: 0 });

            const { rejectVersionModification } = await import(
              '../../src/services/forms/form-version.js'
            );

            await rejectVersionModification(formId, versionNumber);

            // Verify the QueryCommand was called with correct parameters
            const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');
            const queryCalls = (QueryCommand as unknown as ReturnType<typeof vi.fn>).mock
              .calls;

            expect(queryCalls.length).toBeGreaterThanOrEqual(1);
            const queryParams = queryCalls[0][0];

            // Must query the FormResponses table with the correct form PK
            expect(queryParams.KeyConditionExpression).toContain('PK = :pk');
            expect(queryParams.FilterExpression).toContain('version_number = :vn');
            expect(queryParams.ExpressionAttributeValues[':pk']).toBe(`FORM#${formId}`);
            expect(queryParams.ExpressionAttributeValues[':vn']).toBe(versionNumber);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
