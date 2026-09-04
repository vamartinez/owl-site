/**
 * Unit tests for the response submission module (submitFormResponse).
 *
 * Validates that answers are persisted with a generated folio and timestamp.
 *
 * Requirements: 7.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FormStatus, FieldType, FOLIO_LENGTH } from '../types.js';

// Mock DynamoDB
vi.mock('../../../shared/dynamo-client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  getTableName: (name: string) => `test-${name}`,
}));

// Mock audit module
vi.mock('../audit.js', () => ({
  logAuditEntry: vi.fn().mockResolvedValue({
    entity_type: 'respuesta',
    entity_id: 'mock-id',
    action: 'respuesta_enviada',
    actor_id: 'mock-id',
    timestamp: '2024-01-01T00:00:00.000Z',
    ip_address: '127.0.0.1',
    metadata: {},
    tenant_id: 'tenant-1',
    expiresAt: 0,
  }),
}));

// Mock form-version module
vi.mock('../form-version.js', () => ({
  getFormVersion: vi.fn().mockResolvedValue(null),
}));

import { docClient } from '../../../shared/dynamo-client.js';
import { submitFormResponse, generateFolio } from '../form-response.js';

const mockSend = docClient.send as ReturnType<typeof vi.fn>;

describe('Response Submission Module — answers persisted with folio and timestamp (Req 7.5)', () => {
  const publishedForm = {
    form_id: 'form-resp-test',
    tenant_id: 'tenant-1',
    name: 'Test Form',
    status: FormStatus.PUBLICADO,
    fields: [
      {
        field_id: 'field-name',
        type: FieldType.TEXTO_CORTO,
        label: 'Nombre',
        required: true,
        order: 1,
      },
      {
        field_id: 'field-email',
        type: FieldType.TEXTO_CORTO,
        label: 'Email',
        required: false,
        order: 2,
      },
      {
        field_id: 'field-age',
        type: FieldType.NUMERO,
        label: 'Edad',
        required: false,
        order: 3,
      },
    ],
    token_publico: 'test-token-123',
    current_version: 3,
    author_id: 'author-1',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-02-01T00:00:00.000Z',
    published_at: '2024-02-01T00:00:00.000Z',
  };

  beforeEach(() => {
    mockSend.mockReset();
  });

  it('persists answers in DynamoDB with the submitted field values', async () => {
    mockSend.mockResolvedValueOnce({ Items: [publishedForm] }); // query form
    mockSend.mockResolvedValueOnce({}); // put response

    const answers = { 'field-name': 'Juan Pérez', 'field-email': 'juan@example.com', 'field-age': 25 };

    const result = await submitFormResponse(
      'test-token-123',
      { answers },
      '192.168.1.100',
      'Mozilla/5.0'
    );

    expect(result.success).toBe(true);

    // Verify the PutCommand was called (second send call)
    const putCall = mockSend.mock.calls[1]![0];
    const item = putCall.input.Item;

    // Answers are persisted (sanitized)
    expect(item.answers).toBeDefined();
    expect(item.answers['field-name']).toBe('Juan Pérez');
    expect(item.answers['field-email']).toBe('juan@example.com');
    expect(item.answers['field-age']).toBe(25);
  });

  it('persists a generated folio with the response record', async () => {
    mockSend.mockResolvedValueOnce({ Items: [publishedForm] });
    mockSend.mockResolvedValueOnce({});

    const result = await submitFormResponse(
      'test-token-123',
      { answers: { 'field-name': 'Maria' } },
      '10.0.0.1',
      'Chrome/120'
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    // Folio returned in the response
    expect(result.folio).toMatch(/^[A-Z0-9]{8}$/);
    expect(result.folio).toHaveLength(FOLIO_LENGTH);

    // Folio is also stored in the DynamoDB item
    const putCall = mockSend.mock.calls[1]![0];
    const item = putCall.input.Item;
    expect(item.folio).toBe(result.folio);
    expect(item.folio).toMatch(/^[A-Z0-9]{8}$/);
  });

  it('persists a submitted_at ISO 8601 timestamp with the response record', async () => {
    const beforeTime = new Date().toISOString();

    mockSend.mockResolvedValueOnce({ Items: [publishedForm] });
    mockSend.mockResolvedValueOnce({});

    await submitFormResponse(
      'test-token-123',
      { answers: { 'field-name': 'Carlos' } },
      '10.0.0.1',
      'Firefox/100'
    );

    const afterTime = new Date().toISOString();

    const putCall = mockSend.mock.calls[1]![0];
    const item = putCall.input.Item;

    // submitted_at is an ISO 8601 string
    expect(item.submitted_at).toBeDefined();
    expect(item.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // submitted_at falls within the test execution window
    expect(item.submitted_at >= beforeTime).toBe(true);
    expect(item.submitted_at <= afterTime).toBe(true);
  });

  it('persists answers, folio, and timestamp together in the same DynamoDB item', async () => {
    mockSend.mockResolvedValueOnce({ Items: [publishedForm] });
    mockSend.mockResolvedValueOnce({});

    const answers = { 'field-name': 'Ana López', 'field-age': 30 };

    const result = await submitFormResponse(
      'test-token-123',
      { answers },
      '172.16.0.1',
      'Safari/17'
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    const putCall = mockSend.mock.calls[1]![0];
    const item = putCall.input.Item;

    // All three are present in the same persisted item
    expect(item.answers).toBeDefined();
    expect(item.folio).toBeDefined();
    expect(item.submitted_at).toBeDefined();

    // Verify the item is written to the correct table
    expect(putCall.input.TableName).toBe('test-FormResponses');

    // Verify answers match what was submitted (after sanitization)
    expect(item.answers['field-name']).toBe('Ana López');
    expect(item.answers['field-age']).toBe(30);

    // Folio is a valid alphanumeric string
    expect(item.folio).toMatch(/^[A-Z0-9]{8}$/);

    // Timestamp is ISO 8601
    expect(item.submitted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('generates a unique folio for each submission', async () => {
    const folios: string[] = [];

    for (let i = 0; i < 5; i++) {
      mockSend.mockResolvedValueOnce({ Items: [publishedForm] });
      mockSend.mockResolvedValueOnce({});

      const result = await submitFormResponse(
        'test-token-123',
        { answers: { 'field-name': `User ${i}` } },
        '10.0.0.1',
        'Bot/1.0'
      );

      if (result.success) {
        folios.push(result.folio);
      }
    }

    // All folios should be unique
    const uniqueFolios = new Set(folios);
    expect(uniqueFolios.size).toBe(folios.length);
  });

  it('persists the response_id (UUID) alongside answers, folio, and timestamp', async () => {
    mockSend.mockResolvedValueOnce({ Items: [publishedForm] });
    mockSend.mockResolvedValueOnce({});

    const result = await submitFormResponse(
      'test-token-123',
      { answers: { 'field-name': 'Pedro' } },
      '10.0.0.1',
      'Chrome/120'
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    const putCall = mockSend.mock.calls[1]![0];
    const item = putCall.input.Item;

    // response_id is a UUID v4
    expect(item.response_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(item.response_id).toBe(result.response_id);
  });
});

describe('generateFolio — folio generation utility', () => {
  it('generates a folio of exactly FOLIO_LENGTH characters', () => {
    const folio = generateFolio();
    expect(folio).toHaveLength(FOLIO_LENGTH);
  });

  it('generates folios containing only uppercase letters and digits', () => {
    for (let i = 0; i < 50; i++) {
      const folio = generateFolio();
      expect(folio).toMatch(/^[A-Z0-9]+$/);
    }
  });

  it('generates distinct folios across multiple calls', () => {
    const folios = new Set<string>();
    for (let i = 0; i < 100; i++) {
      folios.add(generateFolio());
    }
    expect(folios.size).toBe(100);
  });
});
