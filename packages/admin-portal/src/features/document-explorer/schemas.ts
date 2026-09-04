import { z } from 'zod';

export const documentCategorySchema = z.enum([
  'reports', 'forms', 'certifications', 'incidents', 'safety_evidence',
]);

export const organizationModeSchema = z.enum([
  'category_site_year_month',
  'category_year_month_site',
]);

export const documentFiltersSchema = z.object({
  category: documentCategorySchema.nullable(),
  dateFrom: z.string().nullable(),
  dateTo: z.string().nullable(),
  siteId: z.string().nullable(),
});

export const downloadRequestSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1).max(50),
});

export const folderNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.array(z.string()),
  childFolderCount: z.number().int().min(0),
  documentCount: z.number().int().min(0),
  lastUpdated: z.string(),
});

export const documentSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category: documentCategorySchema,
  mimeType: z.string(),
  fileSize: z.number().int().positive(),
  createdAt: z.string(),
  siteName: z.string(),
  siteId: z.string(),
  folderPath: z.array(z.string()),
});

export const folderContentsResponseSchema = z.object({
  currentPath: z.array(z.string()),
  folders: z.array(folderNodeSchema),
  documents: z.array(documentSummarySchema),
  totalDocuments: z.number().int().min(0),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPages: z.number().int().min(0),
});
