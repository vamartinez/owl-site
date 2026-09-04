// Feature: document-explorer-backend, Properties 2, 15, 16: Aggregator scoping and degradation

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { Role } from '../../../../shared/types/common.js';
import { normalizeDocument, SOURCE_TABLES } from '../../aggregator.js';
import type { SourceTableConfig, DocumentCategory, UnifiedDocument } from '../../types.js';
import type { AuthenticatedUser } from '../../../../shared/auth-middleware.js';

// ─── Mock DynamoDB client ────────────────────────────────────────────────────

const mockSend = vi.fn();

vi.mock('../../../../shared/dynamo-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  getTableName: (name: string) => `test-${name}`,
}));

// ─── Helpers / Arbitraries ───────────────────────────────────────────────────

const CATEGORIES: DocumentCategory[] = [
  'reports',
  'forms',
  'certifications',
  'incidents',
  'safety_evidence',
];

/** Arbitrary for a non-empty alphanumeric string (useful for IDs, names). */
const nonEmptyAlphaArb = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);

/** Arbitrary for a site ID. */
const siteIdArb = fc.uuid();

/** Arbitrary for a tenant ID. */
const tenantIdArb = fc.uuid();

/** Arbitrary for generating a raw DynamoDB record matching a given source table config. */
function rawRecordArb(config: SourceTableConfig): fc.Arbitrary<Record<string, unknown>> {
  return fc.record({
    [config.fieldMap.id]: fc.uuid(),
    [config.fieldMap.name]: nonEmptyAlphaArb,
    [config.fieldMap.mimeType]: fc.constantFrom(
      'application/pdf',
      'image/jpeg',
      'image/png',
      'text/plain',
    ),
    [config.fieldMap.fileSize]: fc.integer({ min: 1, max: 10_000_000 }),
    [config.fieldMap.createdAt]: fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }).map((d) => d.toISOString()),
    [config.fieldMap.siteName]: nonEmptyAlphaArb,
    [config.fieldMap.siteId]: siteIdArb,
    [config.fieldMap.tenantId]: tenantIdArb,
    [config.fieldMap.s3Key]: fc.string({ minLength: 5, maxLength: 100 }),
    [config.fieldMap.sha256Hash]: fc.option(fc.hexaString({ minLength: 64, maxLength: 64 }), { nil: undefined }),
  });
}

/** Generate a UnifiedDocument-shaped object with specific siteId and tenantId */
function unifiedDocArb(opts?: { siteId?: string; tenantId?: string }): fc.Arbitrary<UnifiedDocument> {
  return fc.record({
    id: fc.uuid(),
    name: nonEmptyAlphaArb,
    category: fc.constantFrom(...CATEGORIES),
    mimeType: fc.constantFrom('application/pdf', 'image/jpeg', 'image/png'),
    fileSize: fc.integer({ min: 1, max: 10_000_000 }),
    createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2025-12-31') }).map((d) => d.toISOString()),
    siteName: nonEmptyAlphaArb,
    siteId: opts?.siteId ? fc.constant(opts.siteId) : siteIdArb,
    tenantId: opts?.tenantId ? fc.constant(opts.tenantId) : tenantIdArb,
    s3Key: fc.string({ minLength: 5, maxLength: 100 }),
    sha256Hash: fc.option(fc.hexaString({ minLength: 64, maxLength: 64 }), { nil: null }),
    folderPath: fc.constant([] as string[]),
  });
}

// ─── Property 2: Role-based document scoping ─────────────────────────────────

describe('Property 2: Role-based document scoping', () => {
  // **Validates: Requirements 2.4, 2.5, 2.6, 2.7**

  beforeEach(() => {
    mockSend.mockReset();
  });

  it('site_admin/supervisor users only receive documents matching their assigned_sites', async () => {
    const { aggregateDocuments } = await import('../../aggregator.js');

    await fc.assert(
      fc.asyncProperty(
        // Generate 2-4 assigned site IDs for the user
        fc.array(siteIdArb, { minLength: 2, maxLength: 4 }),
        // Generate extra site IDs not in assigned_sites
        fc.array(siteIdArb, { minLength: 1, maxLength: 3 }),
        tenantIdArb,
        fc.constantFrom(Role.SITE_ADMIN, Role.SUPERVISOR),
        async (assignedSites, otherSites, tenantId, role) => {
          // Create docs: some from assigned sites, some from other sites
          const assignedDocs = assignedSites.map((siteId, i) => ({
            id: `assigned-${i}`,
            name: `Doc ${i}`,
            category: 'reports' as DocumentCategory,
            mimeType: 'application/pdf',
            fileSize: 1000,
            createdAt: '2024-01-15T10:00:00Z',
            siteName: `Site ${i}`,
            siteId,
            tenantId,
            s3Key: `key-${i}`,
            sha256Hash: null,
            folderPath: [],
          }));

          const otherDocs = otherSites.map((siteId, i) => ({
            id: `other-${i}`,
            name: `Other Doc ${i}`,
            category: 'forms' as DocumentCategory,
            mimeType: 'application/pdf',
            fileSize: 500,
            createdAt: '2024-02-10T10:00:00Z',
            siteName: `Other Site ${i}`,
            siteId,
            tenantId,
            s3Key: `other-key-${i}`,
            sha256Hash: null,
            folderPath: [],
          }));

          const allDocs = [...assignedDocs, ...otherDocs];

          // Mock DynamoDB to return all docs from the first source and empty from others
          mockSend.mockImplementation(() => {
            return Promise.resolve({ Items: allDocs.map((doc) => docToRawRecord(doc, SOURCE_TABLES[0]!)) });
          });

          const user: AuthenticatedUser = {
            user_id: 'user-1',
            tenant_id: tenantId,
            role,
            assigned_sites: assignedSites,
          };

          const result = await aggregateDocuments(user);
          const assignedSiteSet = new Set(assignedSites);

          // All returned documents must have siteId in assigned_sites
          for (const doc of result.documents) {
            expect(assignedSiteSet.has(doc.siteId)).toBe(true);
          }

          // No document from other sites should be present
          for (const doc of result.documents) {
            expect(otherSites.includes(doc.siteId)).toBe(false);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('tenant_admin/cso users receive all documents within their tenant without site filtering', async () => {
    const { aggregateDocuments } = await import('../../aggregator.js');

    await fc.assert(
      fc.asyncProperty(
        fc.array(siteIdArb, { minLength: 2, maxLength: 5 }),
        tenantIdArb,
        fc.constantFrom(Role.TENANT_ADMIN, Role.CSO),
        async (siteIds, tenantId, role) => {
          // Create docs across multiple sites in the same tenant
          const docs = siteIds.map((siteId, i) => ({
            id: `doc-${i}`,
            name: `Tenant Doc ${i}`,
            category: 'certifications' as DocumentCategory,
            mimeType: 'application/pdf',
            fileSize: 2000,
            createdAt: '2024-03-20T10:00:00Z',
            siteName: `Site ${i}`,
            siteId,
            tenantId,
            s3Key: `tenant-key-${i}`,
            sha256Hash: null,
            folderPath: [],
          }));

          // Mock DynamoDB to return all docs
          mockSend.mockImplementation(() =>
            Promise.resolve({ Items: docs.map((doc) => docToRawRecord(doc, SOURCE_TABLES[0]!)) }),
          );

          const user: AuthenticatedUser = {
            user_id: 'user-2',
            tenant_id: tenantId,
            role,
            assigned_sites: [siteIds[0]!], // Even with assigned_sites, tenant_admin/cso should not be filtered
          };

          const result = await aggregateDocuments(user);

          // All documents from the tenant should be returned (no site filtering)
          // Since mock returns same docs for all 5 tables, we get docs * 5
          // But the key point: no site-based filtering applied
          const returnedSiteIds = new Set(result.documents.map((d) => d.siteId));
          const expectedSiteIds = new Set(siteIds);

          // Every site's documents should be present (no filtering)
          for (const siteId of expectedSiteIds) {
            expect(returnedSiteIds.has(siteId)).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('platform_admin users receive all documents without filtering', async () => {
    const { aggregateDocuments } = await import('../../aggregator.js');

    await fc.assert(
      fc.asyncProperty(
        fc.array(siteIdArb, { minLength: 2, maxLength: 5 }),
        fc.array(tenantIdArb, { minLength: 1, maxLength: 3 }),
        async (siteIds, tenantIds) => {
          // Create docs across multiple tenants and sites
          const docs = siteIds.map((siteId, i) => ({
            id: `pa-doc-${i}`,
            name: `PA Doc ${i}`,
            category: 'incidents' as DocumentCategory,
            mimeType: 'application/pdf',
            fileSize: 3000,
            createdAt: '2024-04-10T10:00:00Z',
            siteName: `Site ${i}`,
            siteId,
            tenantId: tenantIds[i % tenantIds.length]!,
            s3Key: `pa-key-${i}`,
            sha256Hash: null,
            folderPath: [],
          }));

          mockSend.mockImplementation(() =>
            Promise.resolve({ Items: docs.map((doc) => docToRawRecord(doc, SOURCE_TABLES[0]!)) }),
          );

          const user: AuthenticatedUser = {
            user_id: 'user-3',
            tenant_id: tenantIds[0]!,
            role: Role.PLATFORM_ADMIN,
          };

          const result = await aggregateDocuments(user);

          // Platform admin should receive docs from ALL sites (no filtering)
          const returnedSiteIds = new Set(result.documents.map((d) => d.siteId));
          for (const siteId of siteIds) {
            expect(returnedSiteIds.has(siteId)).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ─── Property 15: Source document normalization ──────────────────────────────

describe('Property 15: Source document normalization', () => {
  // **Validates: Requirements 11.2, 11.3**

  it('normalizeDocument maps all field names correctly for every source table', () => {
    fc.assert(
      fc.property(
        // Pick a random source table config
        fc.constantFrom(...SOURCE_TABLES),
        // Then generate a raw record matching that config
        fc.constantFrom(...SOURCE_TABLES).chain((config) => rawRecordArb(config).map((raw) => ({ raw, config }))),
        (_unusedConfig, { raw, config }) => {
          const result = normalizeDocument(raw, config);

          // All required fields should be present
          expect(result.id).toBe(String(raw[config.fieldMap.id] ?? ''));
          expect(result.name).toBe(String(raw[config.fieldMap.name] ?? ''));
          expect(result.category).toBe(config.category);
          expect(result.mimeType).toBe(String(raw[config.fieldMap.mimeType] ?? 'application/octet-stream'));
          expect(result.fileSize).toBe(Number(raw[config.fieldMap.fileSize] ?? 0));
          expect(result.createdAt).toBe(String(raw[config.fieldMap.createdAt] ?? expect.any(String)));
          expect(result.siteName).toBe(String(raw[config.fieldMap.siteName] ?? ''));
          expect(result.siteId).toBe(String(raw[config.fieldMap.siteId] ?? ''));
          expect(result.tenantId).toBe(String(raw[config.fieldMap.tenantId] ?? ''));
          expect(result.s3Key).toBe(String(raw[config.fieldMap.s3Key] ?? ''));
          expect(result.folderPath).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('category is deterministically derived from the source table name', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SOURCE_TABLES),
        (config) => {
          // Generate a minimal valid raw record
          const raw: Record<string, unknown> = {};
          for (const [_key, fieldName] of Object.entries(config.fieldMap)) {
            raw[fieldName] = 'test-value';
          }
          raw[config.fieldMap.fileSize] = 100;

          const result = normalizeDocument(raw, config);

          // Category should match the config's category (derived from table name)
          expect(result.category).toBe(config.category);

          // Verify category matches expected mapping
          const expectedCategoryMap: Record<string, DocumentCategory> = {
            Reports: 'reports',
            Forms: 'forms',
            Certifications: 'certifications',
            Incidents: 'incidents',
            SafetyEvidence: 'safety_evidence',
          };
          expect(result.category).toBe(expectedCategoryMap[config.tableName]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sha256Hash is correctly mapped when present and null when absent', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SOURCE_TABLES),
        fc.option(fc.hexaString({ minLength: 64, maxLength: 64 }), { nil: undefined }),
        (config, hashValue) => {
          const raw: Record<string, unknown> = {};
          for (const [_key, fieldName] of Object.entries(config.fieldMap)) {
            raw[fieldName] = 'test-value';
          }
          raw[config.fieldMap.fileSize] = 100;

          if (hashValue !== undefined) {
            raw[config.fieldMap.sha256Hash] = hashValue;
          } else {
            delete raw[config.fieldMap.sha256Hash];
            raw[config.fieldMap.sha256Hash] = undefined;
          }

          const result = normalizeDocument(raw, config);

          if (hashValue !== undefined) {
            expect(result.sha256Hash).toBe(hashValue);
          } else {
            // When sha256Hash field is null/undefined in raw, result should be null
            expect(result.sha256Hash).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('produces a valid UnifiedDocument with all required fields for any raw record', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SOURCE_TABLES).chain((config) => rawRecordArb(config).map((raw) => ({ raw, config }))),
        ({ raw, config }) => {
          const result = normalizeDocument(raw, config);

          // Check all required fields are present and of correct type
          expect(typeof result.id).toBe('string');
          expect(typeof result.name).toBe('string');
          expect(CATEGORIES).toContain(result.category);
          expect(typeof result.mimeType).toBe('string');
          expect(typeof result.fileSize).toBe('number');
          expect(typeof result.createdAt).toBe('string');
          expect(typeof result.siteName).toBe('string');
          expect(typeof result.siteId).toBe('string');
          expect(typeof result.tenantId).toBe('string');
          expect(typeof result.s3Key).toBe('string');
          expect(result.sha256Hash === null || typeof result.sha256Hash === 'string').toBe(true);
          expect(Array.isArray(result.folderPath)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 16: Graceful source degradation ────────────────────────────────

describe('Property 16: Graceful source degradation', () => {
  // **Validates: Requirements 11.4**

  beforeEach(() => {
    mockSend.mockReset();
  });

  it('when some sources fail, documents from successful sources are still returned', async () => {
    const { aggregateDocuments } = await import('../../aggregator.js');

    await fc.assert(
      fc.asyncProperty(
        // Generate a subset of table indices that will fail (at least 1 fails, at least 1 succeeds)
        fc.subarray([0, 1, 2, 3, 4], { minLength: 1, maxLength: 4 }),
        tenantIdArb,
        async (failingIndices, tenantId) => {
          // Ensure at least one source succeeds
          const successIndices = [0, 1, 2, 3, 4].filter((i) => !failingIndices.includes(i));
          if (successIndices.length === 0) return; // Skip if all would fail

          const failingSet = new Set(failingIndices);
          let callIndex = 0;

          // Create a doc per source table for simplicity
          const docsPerSource = SOURCE_TABLES.map((config, i) => ({
            [config.fieldMap.id]: `doc-${i}`,
            [config.fieldMap.name]: `Doc from ${config.tableName}`,
            [config.fieldMap.mimeType]: 'application/pdf',
            [config.fieldMap.fileSize]: 1000,
            [config.fieldMap.createdAt]: '2024-01-01T00:00:00Z',
            [config.fieldMap.siteName]: 'Main Site',
            [config.fieldMap.siteId]: 'site-1',
            [config.fieldMap.tenantId]: tenantId,
            [config.fieldMap.s3Key]: `key-${i}`,
            [config.fieldMap.sha256Hash]: null,
          }));

          mockSend.mockImplementation(() => {
            const idx = callIndex++;
            if (failingSet.has(idx)) {
              return Promise.reject(new Error(`Table ${SOURCE_TABLES[idx]?.tableName} unavailable`));
            }
            return Promise.resolve({ Items: [docsPerSource[idx]] });
          });

          const user: AuthenticatedUser = {
            user_id: 'user-test',
            tenant_id: tenantId,
            role: Role.TENANT_ADMIN,
          };

          const result = await aggregateDocuments(user);

          // Documents from successful sources should be returned
          expect(result.documents.length).toBe(successIndices.length);

          // unavailableSources should list exactly the failed table names
          const expectedUnavailable = failingIndices.map((i) => SOURCE_TABLES[i]!.tableName);
          expect(result.unavailableSources.sort()).toEqual(expectedUnavailable.sort());
        },
      ),
      { numRuns: 50 },
    );
  });

  it('unavailableSources lists exactly the table names that failed', async () => {
    const { aggregateDocuments } = await import('../../aggregator.js');

    await fc.assert(
      fc.asyncProperty(
        // Generate which tables fail (0-5 of them)
        fc.subarray([0, 1, 2, 3, 4], { minLength: 0, maxLength: 5 }),
        tenantIdArb,
        async (failingIndices, tenantId) => {
          const failingSet = new Set(failingIndices);
          let callIndex = 0;

          mockSend.mockImplementation(() => {
            const idx = callIndex++;
            if (failingSet.has(idx)) {
              return Promise.reject(new Error(`DynamoDB error for ${SOURCE_TABLES[idx]?.tableName}`));
            }
            return Promise.resolve({ Items: [] });
          });

          const user: AuthenticatedUser = {
            user_id: 'user-unavail',
            tenant_id: tenantId,
            role: Role.TENANT_ADMIN,
          };

          const result = await aggregateDocuments(user);

          // unavailableSources should contain exactly the failed tables
          expect(result.unavailableSources.length).toBe(failingIndices.length);
          const expectedNames = failingIndices.map((i) => SOURCE_TABLES[i]!.tableName);
          expect(result.unavailableSources.sort()).toEqual(expectedNames.sort());
        },
      ),
      { numRuns: 50 },
    );
  });

  it('count of returned documents equals sum of documents from successful sources only', async () => {
    const { aggregateDocuments } = await import('../../aggregator.js');

    await fc.assert(
      fc.asyncProperty(
        // Generate per-source doc counts (0-5 docs per source)
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 5, maxLength: 5 }),
        // Generate which tables fail
        fc.subarray([0, 1, 2, 3, 4], { minLength: 0, maxLength: 4 }),
        tenantIdArb,
        async (docCounts, failingIndices, tenantId) => {
          const failingSet = new Set(failingIndices);
          let callIndex = 0;

          mockSend.mockImplementation(() => {
            const idx = callIndex++;
            if (failingSet.has(idx)) {
              return Promise.reject(new Error('fail'));
            }
            const config = SOURCE_TABLES[idx]!;
            const items = Array.from({ length: docCounts[idx]! }, (_, j) => ({
              [config.fieldMap.id]: `doc-${idx}-${j}`,
              [config.fieldMap.name]: `Doc ${idx}-${j}`,
              [config.fieldMap.mimeType]: 'application/pdf',
              [config.fieldMap.fileSize]: 1000,
              [config.fieldMap.createdAt]: '2024-06-01T00:00:00Z',
              [config.fieldMap.siteName]: 'Site X',
              [config.fieldMap.siteId]: 'site-x',
              [config.fieldMap.tenantId]: tenantId,
              [config.fieldMap.s3Key]: `key-${idx}-${j}`,
              [config.fieldMap.sha256Hash]: null,
            }));
            return Promise.resolve({ Items: items });
          });

          const user: AuthenticatedUser = {
            user_id: 'user-count',
            tenant_id: tenantId,
            role: Role.TENANT_ADMIN,
          };

          const result = await aggregateDocuments(user);

          // Expected doc count = sum of docCounts for successful sources
          const expectedCount = docCounts.reduce((sum, count, idx) => {
            if (failingSet.has(idx)) return sum;
            return sum + count;
          }, 0);

          expect(result.documents.length).toBe(expectedCount);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ─── Utility: Convert a UnifiedDocument back to a raw DynamoDB-like record ───

function docToRawRecord(doc: UnifiedDocument, config: SourceTableConfig): Record<string, unknown> {
  return {
    [config.fieldMap.id]: doc.id,
    [config.fieldMap.name]: doc.name,
    [config.fieldMap.mimeType]: doc.mimeType,
    [config.fieldMap.fileSize]: doc.fileSize,
    [config.fieldMap.createdAt]: doc.createdAt,
    [config.fieldMap.siteName]: doc.siteName,
    [config.fieldMap.siteId]: doc.siteId,
    [config.fieldMap.tenantId]: doc.tenantId,
    [config.fieldMap.s3Key]: doc.s3Key,
    [config.fieldMap.sha256Hash]: doc.sha256Hash,
  };
}
