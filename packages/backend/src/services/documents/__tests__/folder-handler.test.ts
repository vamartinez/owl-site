/**
 * Unit tests for folder-handler.ts
 * Tests: root path returns 5 category folders, nested navigation with both org modes,
 * pagination of documents within a folder, and empty folders return 200 with empty arrays.
 *
 * Validates: Requirements 3.1, 3.2, 3.4, 3.5, 3.8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthenticatedUser, ApiGatewayEvent } from '../../../shared/auth-middleware.js';
import type { UnifiedDocument } from '../types.js';

// ─── Mock the aggregator module ──────────────────────────────────────────────

const mockAggregateDocuments = vi.fn();

vi.mock('../aggregator.js', () => ({
  aggregateDocuments: (...args: unknown[]) => mockAggregateDocuments(...args),
}));

// ─── Import handler after mocks are set up ───────────────────────────────────

import { handleFolders } from '../folder-handler.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createUser(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    user_id: 'user-001',
    tenant_id: 'tenant-abc',
    role: 'tenant_admin' as AuthenticatedUser['role'],
    ...overrides,
  };
}

function createEvent(queryParams?: Record<string, string>): ApiGatewayEvent {
  return {
    headers: { Authorization: 'Bearer fake-token' },
    queryStringParameters: queryParams ?? {},
  } as unknown as ApiGatewayEvent;
}

function createDocument(overrides: Partial<UnifiedDocument>): UnifiedDocument {
  return {
    id: 'doc-001',
    name: 'Test Document',
    category: 'reports',
    mimeType: 'application/pdf',
    fileSize: 1024,
    createdAt: '2024-03-15T10:00:00Z',
    siteName: 'SiteA',
    siteId: 'site-001',
    tenantId: 'tenant-abc',
    s3Key: 'documents/doc-001.pdf',
    sha256Hash: 'abc123hash',
    folderPath: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('folder-handler: handleFolders', () => {
  const user = createUser();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Root path returns 5 category folders (Req 3.1, 3.2)', () => {
    it('returns root-level folders for 5 document categories when path is empty', async () => {
      // Provide one document per category
      const docs: UnifiedDocument[] = [
        createDocument({ id: 'r1', category: 'reports', siteName: 'SiteA', createdAt: '2024-01-10T00:00:00Z' }),
        createDocument({ id: 'f1', category: 'forms', siteName: 'SiteA', createdAt: '2024-02-10T00:00:00Z' }),
        createDocument({ id: 'c1', category: 'certifications', siteName: 'SiteA', createdAt: '2024-03-10T00:00:00Z' }),
        createDocument({ id: 'i1', category: 'incidents', siteName: 'SiteA', createdAt: '2024-04-10T00:00:00Z' }),
        createDocument({ id: 's1', category: 'safety_evidence', siteName: 'SiteA', createdAt: '2024-05-10T00:00:00Z' }),
      ];

      mockAggregateDocuments.mockResolvedValue({ documents: docs, unavailableSources: [] });

      const event = createEvent({});
      const response = await handleFolders(event, user);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.currentPath).toEqual([]);
      expect(body.folders).toHaveLength(5);

      const folderNames = body.folders.map((f: { name: string }) => f.name).sort();
      expect(folderNames).toEqual([
        'certifications',
        'forms',
        'incidents',
        'reports',
        'safety_evidence',
      ]);

      // Each folder should have documentCount of 1
      for (const folder of body.folders) {
        expect(folder.documentCount).toBe(1);
      }

      // No documents should be at root level
      expect(body.documents).toEqual([]);
      expect(body.totalDocuments).toBe(0);
    });

    it('returns root-level folders when path parameter is absent', async () => {
      const docs: UnifiedDocument[] = [
        createDocument({ id: 'r1', category: 'reports', createdAt: '2024-06-01T00:00:00Z' }),
      ];

      mockAggregateDocuments.mockResolvedValue({ documents: docs, unavailableSources: [] });

      // No queryStringParameters at all
      const event = { headers: {}, queryStringParameters: null } as unknown as ApiGatewayEvent;
      const response = await handleFolders(event, user);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.currentPath).toEqual([]);
      expect(body.folders).toHaveLength(1);
      expect(body.folders[0].name).toBe('reports');
    });
  });

  describe('Nested navigation with category_site_year_month mode (Req 3.4)', () => {
    it('navigates into reports/SiteA and shows year folders', async () => {
      const docs: UnifiedDocument[] = [
        createDocument({ id: 'r1', category: 'reports', siteName: 'SiteA', createdAt: '2024-01-15T00:00:00Z' }),
        createDocument({ id: 'r2', category: 'reports', siteName: 'SiteA', createdAt: '2024-03-20T00:00:00Z' }),
        createDocument({ id: 'r3', category: 'reports', siteName: 'SiteA', createdAt: '2023-06-10T00:00:00Z' }),
        createDocument({ id: 'r4', category: 'reports', siteName: 'SiteB', createdAt: '2024-01-10T00:00:00Z' }),
      ];

      mockAggregateDocuments.mockResolvedValue({ documents: docs, unavailableSources: [] });

      const event = createEvent({ path: 'reports/SiteA', org_mode: 'category_site_year_month' });
      const response = await handleFolders(event, user);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.currentPath).toEqual(['reports', 'SiteA']);
      // Should have 2 year folders: 2024 and 2023
      expect(body.folders).toHaveLength(2);

      const yearNames = body.folders.map((f: { name: string }) => f.name).sort();
      expect(yearNames).toEqual(['2023', '2024']);

      // 2024 folder should have 2 docs, 2023 folder should have 1
      const folder2024 = body.folders.find((f: { name: string }) => f.name === '2024');
      const folder2023 = body.folders.find((f: { name: string }) => f.name === '2023');
      expect(folder2024.documentCount).toBe(2);
      expect(folder2023.documentCount).toBe(1);

      // No documents at this level (they're in year/month sub-folders)
      expect(body.documents).toEqual([]);
    });

    it('navigates into reports/SiteA/2024/01 and returns documents at leaf level', async () => {
      const docs: UnifiedDocument[] = [
        createDocument({ id: 'r1', name: 'January Report', category: 'reports', siteName: 'SiteA', createdAt: '2024-01-15T10:00:00Z' }),
        createDocument({ id: 'r2', name: 'March Report', category: 'reports', siteName: 'SiteA', createdAt: '2024-03-20T10:00:00Z' }),
      ];

      mockAggregateDocuments.mockResolvedValue({ documents: docs, unavailableSources: [] });

      const event = createEvent({ path: 'reports/SiteA/2024/01', org_mode: 'category_site_year_month' });
      const response = await handleFolders(event, user);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.currentPath).toEqual(['reports', 'SiteA', '2024', '01']);
      expect(body.folders).toEqual([]);
      expect(body.documents).toHaveLength(1);
      expect(body.documents[0].name).toBe('January Report');
      expect(body.totalDocuments).toBe(1);
    });
  });

  describe('Nested navigation with category_year_month_site mode (Req 3.5)', () => {
    it('navigates into reports/2024/01 and shows site folders', async () => {
      const docs: UnifiedDocument[] = [
        createDocument({ id: 'r1', category: 'reports', siteName: 'SiteA', createdAt: '2024-01-15T00:00:00Z' }),
        createDocument({ id: 'r2', category: 'reports', siteName: 'SiteB', createdAt: '2024-01-20T00:00:00Z' }),
        createDocument({ id: 'r3', category: 'reports', siteName: 'SiteA', createdAt: '2024-02-10T00:00:00Z' }),
      ];

      mockAggregateDocuments.mockResolvedValue({ documents: docs, unavailableSources: [] });

      const event = createEvent({ path: 'reports/2024/01', org_mode: 'category_year_month_site' });
      const response = await handleFolders(event, user);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.currentPath).toEqual(['reports', '2024', '01']);
      // Should have 2 site folders: SiteA and SiteB
      expect(body.folders).toHaveLength(2);

      const siteNames = body.folders.map((f: { name: string }) => f.name).sort();
      expect(siteNames).toEqual(['SiteA', 'SiteB']);

      // Each site folder has 1 doc
      for (const folder of body.folders) {
        expect(folder.documentCount).toBe(1);
      }

      expect(body.documents).toEqual([]);
    });

    it('navigates into reports/2024/01/SiteA and returns documents at leaf level', async () => {
      const docs: UnifiedDocument[] = [
        createDocument({ id: 'r1', name: 'Site A Jan Report', category: 'reports', siteName: 'SiteA', createdAt: '2024-01-15T00:00:00Z' }),
        createDocument({ id: 'r2', name: 'Site B Jan Report', category: 'reports', siteName: 'SiteB', createdAt: '2024-01-20T00:00:00Z' }),
      ];

      mockAggregateDocuments.mockResolvedValue({ documents: docs, unavailableSources: [] });

      const event = createEvent({ path: 'reports/2024/01/SiteA', org_mode: 'category_year_month_site' });
      const response = await handleFolders(event, user);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.currentPath).toEqual(['reports', '2024', '01', 'SiteA']);
      expect(body.folders).toEqual([]);
      expect(body.documents).toHaveLength(1);
      expect(body.documents[0].name).toBe('Site A Jan Report');
      expect(body.totalDocuments).toBe(1);
    });
  });

  describe('Pagination of documents within a folder (Req 3.6)', () => {
    it('page=1&page_size=50 returns first 50 of 60 documents', async () => {
      // Create 60 documents all at the same leaf folder path
      const docs: UnifiedDocument[] = Array.from({ length: 60 }, (_, i) =>
        createDocument({
          id: `doc-${String(i).padStart(3, '0')}`,
          name: `Document ${i}`,
          category: 'reports',
          siteName: 'SiteA',
          createdAt: '2024-01-15T10:00:00Z',
        })
      );

      mockAggregateDocuments.mockResolvedValue({ documents: docs, unavailableSources: [] });

      const event = createEvent({
        path: 'reports/SiteA/2024/01',
        org_mode: 'category_site_year_month',
        page: '1',
        page_size: '50',
      });
      const response = await handleFolders(event, user);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.documents).toHaveLength(50);
      expect(body.totalDocuments).toBe(60);
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(50);
      expect(body.totalPages).toBe(2);
    });

    it('page=2&page_size=50 returns remaining 10 of 60 documents', async () => {
      const docs: UnifiedDocument[] = Array.from({ length: 60 }, (_, i) =>
        createDocument({
          id: `doc-${String(i).padStart(3, '0')}`,
          name: `Document ${i}`,
          category: 'reports',
          siteName: 'SiteA',
          createdAt: '2024-01-15T10:00:00Z',
        })
      );

      mockAggregateDocuments.mockResolvedValue({ documents: docs, unavailableSources: [] });

      const event = createEvent({
        path: 'reports/SiteA/2024/01',
        org_mode: 'category_site_year_month',
        page: '2',
        page_size: '50',
      });
      const response = await handleFolders(event, user);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.documents).toHaveLength(10);
      expect(body.totalDocuments).toBe(60);
      expect(body.page).toBe(2);
      expect(body.pageSize).toBe(50);
      expect(body.totalPages).toBe(2);
    });
  });

  describe('Empty folders return 200 with empty arrays (Req 3.8)', () => {
    it('returns 200 with empty folders and documents when no documents match the path', async () => {
      const docs: UnifiedDocument[] = [
        createDocument({ id: 'r1', category: 'reports', siteName: 'SiteA', createdAt: '2024-01-15T00:00:00Z' }),
      ];

      mockAggregateDocuments.mockResolvedValue({ documents: docs, unavailableSources: [] });

      // Navigate to a path that doesn't exist
      const event = createEvent({ path: 'incidents/SiteZ/2020/12', org_mode: 'category_site_year_month' });
      const response = await handleFolders(event, user);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.currentPath).toEqual(['incidents', 'SiteZ', '2020', '12']);
      expect(body.folders).toEqual([]);
      expect(body.documents).toEqual([]);
      expect(body.totalDocuments).toBe(0);
    });

    it('returns 200 with empty folders and documents when aggregator returns no documents', async () => {
      mockAggregateDocuments.mockResolvedValue({ documents: [], unavailableSources: [] });

      const event = createEvent({});
      const response = await handleFolders(event, user);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.currentPath).toEqual([]);
      expect(body.folders).toEqual([]);
      expect(body.documents).toEqual([]);
      expect(body.totalDocuments).toBe(0);
    });
  });

  describe('Response sanitization', () => {
    it('strips tenantId, s3Key, and sha256Hash from returned documents', async () => {
      const docs: UnifiedDocument[] = [
        createDocument({
          id: 'r1',
          category: 'reports',
          siteName: 'SiteA',
          createdAt: '2024-01-15T10:00:00Z',
          tenantId: 'secret-tenant',
          s3Key: 'secret/path.pdf',
          sha256Hash: 'secrethash123',
        }),
      ];

      mockAggregateDocuments.mockResolvedValue({ documents: docs, unavailableSources: [] });

      const event = createEvent({ path: 'reports/SiteA/2024/01', org_mode: 'category_site_year_month' });
      const response = await handleFolders(event, user);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.documents).toHaveLength(1);
      expect(body.documents[0]).not.toHaveProperty('tenantId');
      expect(body.documents[0]).not.toHaveProperty('s3Key');
      expect(body.documents[0]).not.toHaveProperty('sha256Hash');
    });
  });

  describe('Unavailable sources are reported', () => {
    it('includes unavailableSources in response when some sources failed', async () => {
      const docs: UnifiedDocument[] = [
        createDocument({ id: 'r1', category: 'reports', siteName: 'SiteA', createdAt: '2024-01-15T00:00:00Z' }),
      ];

      mockAggregateDocuments.mockResolvedValue({
        documents: docs,
        unavailableSources: ['Incidents', 'SafetyEvidence'],
      });

      const event = createEvent({});
      const response = await handleFolders(event, user);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.unavailableSources).toEqual(['Incidents', 'SafetyEvidence']);
    });

    it('does not include unavailableSources field when all sources are available', async () => {
      mockAggregateDocuments.mockResolvedValue({ documents: [], unavailableSources: [] });

      const event = createEvent({});
      const response = await handleFolders(event, user);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body).not.toHaveProperty('unavailableSources');
    });
  });
});
