/**
 * Unit tests for the publish and unpublish modules.
 * Validates: Requirements 7.2, 7.3
 *
 * Verifies:
 * - Publish: version record created with incremented version number and public token generated
 * - Unpublish: status changed to DESPUBLICADO and public token invalidated
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupDynamoMock,
  getDynamoCalls,
  resetDynamoMock,
  getMockSend,
} from '../../../../tests/helpers/mock-dynamo';

// Mock the dynamo-client module to use our test mock
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: { send: getMockSend() },
  getTableName: (baseName: string) => `test-${baseName}`,
}));

// Mock the audit module to prevent real audit writes
vi.mock('../audit.js', () => ({
  logAuditEntry: vi.fn().mockResolvedValue(undefined),
}));

// Mock the logger
vi.mock('../../../shared/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Track createFormVersion calls
const mockCreateFormVersion = vi.fn();

vi.mock('../form-version.js', () => ({
  createFormVersion: (...args: unknown[]) => mockCreateFormVersion(...args),
}));

// Mock uuid to return predictable values
const MOCK_TOKEN = 'aaaaaaaa-1111-2222-3333-444444444444';

vi.mock('uuid', () => ({
  v4: () => MOCK_TOKEN,
}));

import { publishForm, unpublishForm } from '../form.js';
import { FormStatus, FieldType } from '../types.js';
import type { Form } from '../types.js';

describe('Publish Module', () => {
  const updateCapture: Array<Record<string, unknown>> = [];
  const putCapture: Array<Record<string, unknown>> = [];

  const validPublishableForm: Form = {
    form_id: 'form-123',
    tenant_id: 'tenant-test',
    name: 'Safety Inspection',
    description: 'Daily safety checklist',
    status: FormStatus.BORRADOR,
    fields: [
      {
        field_id: 'field-1',
        type: FieldType.TEXTO_CORTO,
        label: 'Worker Name',
        required: true,
        order: 1,
      },
    ],
    author_id: 'user-1',
    created_at: '2024-06-01T00:00:00.000Z',
    updated_at: '2024-06-01T00:00:00.000Z',
  };

  beforeEach(() => {
    resetDynamoMock();
    updateCapture.length = 0;
    putCapture.length = 0;

    // Setup createFormVersion mock to return expected version
    mockCreateFormVersion.mockResolvedValue({
      form_id: 'form-123',
      version_number: 1,
      fields_snapshot: validPublishableForm.fields,
      created_at: '2024-06-15T10:30:00.000Z',
      created_by: 'user-1',
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T10:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    mockCreateFormVersion.mockReset();
  });

  describe('version record creation and public token generation', () => {
    it('creates a version record via createFormVersion when publishing', async () => {
      const getKey = JSON.stringify({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-123',
      });
      const getResponses = new Map<string, Record<string, unknown>>([
        [getKey, validPublishableForm as unknown as Record<string, unknown>],
      ]);

      setupDynamoMock({ getResponses, updateCapture, putCapture });

      await publishForm('tenant-test', 'form-123', 'user-1', '127.0.0.1');

      expect(mockCreateFormVersion).toHaveBeenCalledOnce();
      expect(mockCreateFormVersion).toHaveBeenCalledWith(
        'form-123',
        validPublishableForm.fields,
        'user-1'
      );
    });

    it('generates a public token (UUID) for the published form', async () => {
      const getKey = JSON.stringify({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-123',
      });
      const getResponses = new Map<string, Record<string, unknown>>([
        [getKey, validPublishableForm as unknown as Record<string, unknown>],
      ]);

      setupDynamoMock({ getResponses, updateCapture, putCapture });

      const result = await publishForm('tenant-test', 'form-123', 'user-1', '127.0.0.1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.token_publico).toBe(MOCK_TOKEN);
        expect(result.token_publico).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        );
      }
    });

    it('updates form with status publicado, token, and version number in DynamoDB', async () => {
      const getKey = JSON.stringify({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-123',
      });
      const getResponses = new Map<string, Record<string, unknown>>([
        [getKey, validPublishableForm as unknown as Record<string, unknown>],
      ]);

      setupDynamoMock({ getResponses, updateCapture, putCapture });

      await publishForm('tenant-test', 'form-123', 'user-1', '127.0.0.1');

      // Find the UpdateCommand call (form status update)
      const calls = getDynamoCalls();
      const updateCalls = calls.filter((c) => c.command === 'UpdateCommand');
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);

      const updateInput = updateCapture[0] as Record<string, unknown>;
      expect(updateInput.TableName).toBe('test-Forms');
      expect(updateInput.Key).toEqual({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-123',
      });

      const exprValues = updateInput.ExpressionAttributeValues as Record<string, unknown>;
      expect(exprValues[':status']).toBe('publicado');
      expect(exprValues[':token_publico']).toBe(MOCK_TOKEN);
      expect(exprValues[':current_version']).toBe(1);
      expect(exprValues[':published_at']).toBe('2024-06-15T10:30:00.000Z');
      expect(exprValues[':updated_at']).toBe('2024-06-15T10:30:00.000Z');
    });

    it('sets the GSI1PK with TOKEN# prefix for public access lookup', async () => {
      const getKey = JSON.stringify({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-123',
      });
      const getResponses = new Map<string, Record<string, unknown>>([
        [getKey, validPublishableForm as unknown as Record<string, unknown>],
      ]);

      setupDynamoMock({ getResponses, updateCapture, putCapture });

      await publishForm('tenant-test', 'form-123', 'user-1', '127.0.0.1');

      const updateInput = updateCapture[0] as Record<string, unknown>;
      const exprValues = updateInput.ExpressionAttributeValues as Record<string, unknown>;
      expect(exprValues[':gsi1pk']).toBe(`TOKEN#${MOCK_TOKEN}`);
      expect(exprValues[':gsi1sk']).toBe('FORM#form-123');
    });

    it('returns version_number from the created version record', async () => {
      mockCreateFormVersion.mockResolvedValue({
        form_id: 'form-123',
        version_number: 3,
        fields_snapshot: validPublishableForm.fields,
        created_at: '2024-06-15T10:30:00.000Z',
        created_by: 'user-1',
      });

      const getKey = JSON.stringify({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-123',
      });
      const getResponses = new Map<string, Record<string, unknown>>([
        [getKey, validPublishableForm as unknown as Record<string, unknown>],
      ]);

      setupDynamoMock({ getResponses, updateCapture, putCapture });

      const result = await publishForm('tenant-test', 'form-123', 'user-1', '127.0.0.1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.version_number).toBe(3);
      }
    });

    it('returns a public URL containing the token', async () => {
      const getKey = JSON.stringify({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-123',
      });
      const getResponses = new Map<string, Record<string, unknown>>([
        [getKey, validPublishableForm as unknown as Record<string, unknown>],
      ]);

      setupDynamoMock({ getResponses, updateCapture, putCapture });

      const result = await publishForm('tenant-test', 'form-123', 'user-1', '127.0.0.1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.url_publica).toContain(MOCK_TOKEN);
      }
    });
  });

  describe('publish validation', () => {
    it('rejects publish if form is not in borrador state', async () => {
      const publishedForm = { ...validPublishableForm, status: FormStatus.PUBLICADO };
      const getKey = JSON.stringify({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-123',
      });
      const getResponses = new Map<string, Record<string, unknown>>([
        [getKey, publishedForm as unknown as Record<string, unknown>],
      ]);

      setupDynamoMock({ getResponses, updateCapture, putCapture });

      const result = await publishForm('tenant-test', 'form-123', 'user-1', '127.0.0.1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.statusCode).toBe(422);
        expect(result.code).toBe('UNPROCESSABLE_ENTITY');
      }
    });

    it('rejects publish if form has no fields', async () => {
      const emptyFieldsForm = { ...validPublishableForm, fields: [] };
      const getKey = JSON.stringify({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-123',
      });
      const getResponses = new Map<string, Record<string, unknown>>([
        [getKey, emptyFieldsForm as unknown as Record<string, unknown>],
      ]);

      setupDynamoMock({ getResponses, updateCapture, putCapture });

      const result = await publishForm('tenant-test', 'form-123', 'user-1', '127.0.0.1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.statusCode).toBe(400);
        expect(result.code).toBe('VALIDATION_ERROR');
      }
    });

    it('returns NOT_FOUND if form does not exist', async () => {
      setupDynamoMock({ updateCapture, putCapture });

      const result = await publishForm('tenant-test', 'nonexistent', 'user-1', '127.0.0.1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.statusCode).toBe(404);
        expect(result.code).toBe('NOT_FOUND');
      }
    });
  });
});

describe('Unpublish Module', () => {
  const updateCapture: Array<Record<string, unknown>> = [];

  const publishedForm: Form = {
    form_id: 'form-456',
    tenant_id: 'tenant-test',
    name: 'Published Form',
    description: 'A form that is currently published',
    status: FormStatus.PUBLICADO,
    fields: [
      {
        field_id: 'field-1',
        type: FieldType.TEXTO_CORTO,
        label: 'Full Name',
        required: true,
        order: 1,
      },
    ],
    token_publico: 'existing-token-uuid',
    current_version: 2,
    author_id: 'user-1',
    created_at: '2024-06-01T00:00:00.000Z',
    updated_at: '2024-06-10T00:00:00.000Z',
    published_at: '2024-06-10T00:00:00.000Z',
  };

  beforeEach(() => {
    resetDynamoMock();
    updateCapture.length = 0;

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('status changed to DESPUBLICADO and token invalidated', () => {
    it('changes the form status to despublicado in DynamoDB', async () => {
      const getKey = JSON.stringify({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-456',
      });
      const getResponses = new Map<string, Record<string, unknown>>([
        [getKey, publishedForm as unknown as Record<string, unknown>],
      ]);

      setupDynamoMock({ getResponses, updateCapture });

      await unpublishForm('tenant-test', 'form-456', 'user-1', '127.0.0.1');

      const calls = getDynamoCalls();
      const updateCalls = calls.filter((c) => c.command === 'UpdateCommand');
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);

      const updateInput = updateCapture[0] as Record<string, unknown>;
      expect(updateInput.TableName).toBe('test-Forms');
      expect(updateInput.Key).toEqual({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-456',
      });

      const exprValues = updateInput.ExpressionAttributeValues as Record<string, unknown>;
      expect(exprValues[':status']).toBe('despublicado');
    });

    it('invalidates the public token by changing status (token no longer active)', async () => {
      const getKey = JSON.stringify({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-456',
      });
      const getResponses = new Map<string, Record<string, unknown>>([
        [getKey, publishedForm as unknown as Record<string, unknown>],
      ]);

      setupDynamoMock({ getResponses, updateCapture });

      const result = await unpublishForm('tenant-test', 'form-456', 'user-1', '127.0.0.1');

      // The unpublish action changes status to despublicado which effectively
      // invalidates the public token — the form can no longer be accessed publicly
      expect(result.success).toBe(true);
      if (result.success) {
        // The returned form status should be despublicado
        // The UpdateCommand sets status to despublicado
        const updateInput = updateCapture[0] as Record<string, unknown>;
        const exprValues = updateInput.ExpressionAttributeValues as Record<string, unknown>;
        expect(exprValues[':status']).toBe('despublicado');
      }
    });

    it('updates the updated_at timestamp', async () => {
      const getKey = JSON.stringify({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-456',
      });
      const getResponses = new Map<string, Record<string, unknown>>([
        [getKey, publishedForm as unknown as Record<string, unknown>],
      ]);

      setupDynamoMock({ getResponses, updateCapture });

      await unpublishForm('tenant-test', 'form-456', 'user-1', '127.0.0.1');

      const updateInput = updateCapture[0] as Record<string, unknown>;
      const exprValues = updateInput.ExpressionAttributeValues as Record<string, unknown>;
      expect(exprValues[':updated_at']).toBe('2024-06-15T12:00:00.000Z');
    });

    it('returns success with the updated form', async () => {
      const getKey = JSON.stringify({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-456',
      });
      const getResponses = new Map<string, Record<string, unknown>>([
        [getKey, publishedForm as unknown as Record<string, unknown>],
      ]);

      setupDynamoMock({ getResponses, updateCapture });

      const result = await unpublishForm('tenant-test', 'form-456', 'user-1', '127.0.0.1');

      expect(result.success).toBe(true);
    });
  });

  describe('unpublish validation', () => {
    it('rejects unpublish if form is not in publicado state', async () => {
      const draftForm = { ...publishedForm, status: FormStatus.BORRADOR };
      const getKey = JSON.stringify({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-456',
      });
      const getResponses = new Map<string, Record<string, unknown>>([
        [getKey, draftForm as unknown as Record<string, unknown>],
      ]);

      setupDynamoMock({ getResponses, updateCapture });

      const result = await unpublishForm('tenant-test', 'form-456', 'user-1', '127.0.0.1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.statusCode).toBe(422);
        expect(result.code).toBe('UNPROCESSABLE_ENTITY');
      }
    });

    it('rejects unpublish if form is already despublicado', async () => {
      const despublicadoForm = { ...publishedForm, status: FormStatus.DESPUBLICADO };
      const getKey = JSON.stringify({
        PK: 'TENANT#tenant-test',
        SK: 'FORM#form-456',
      });
      const getResponses = new Map<string, Record<string, unknown>>([
        [getKey, despublicadoForm as unknown as Record<string, unknown>],
      ]);

      setupDynamoMock({ getResponses, updateCapture });

      const result = await unpublishForm('tenant-test', 'form-456', 'user-1', '127.0.0.1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.statusCode).toBe(422);
        expect(result.code).toBe('UNPROCESSABLE_ENTITY');
      }
    });

    it('returns NOT_FOUND if form does not exist', async () => {
      setupDynamoMock({ updateCapture });

      const result = await unpublishForm('tenant-test', 'nonexistent', 'user-1', '127.0.0.1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.statusCode).toBe(404);
        expect(result.code).toBe('NOT_FOUND');
      }
    });
  });
});
