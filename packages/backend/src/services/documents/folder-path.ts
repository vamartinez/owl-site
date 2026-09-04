/**
 * Virtual folder path computation for the Document Explorer service.
 *
 * Provides pure functions for computing folder paths from document metadata
 * and extracting folder/document listings at a given path level.
 *
 * Requirements: 3.1, 3.4, 3.5, 11.5
 */

import type { UnifiedDocument, OrganizationMode, FolderNode } from './types.js';

/**
 * Computes the virtual folder path for a document based on the organization mode.
 *
 * For 'category_site_year_month': returns [category, siteName, year, month]
 * For 'category_year_month_site': returns [category, year, month, siteName]
 *
 * Year is the 4-digit UTC full year. Month is zero-padded UTC month (01-12).
 * This is a pure function — no I/O, deterministic.
 */
export function computeFolderPath(
  doc: { category: string; siteName: string; createdAt: string },
  mode: OrganizationMode
): string[] {
  const date = new Date(doc.createdAt);
  const year = date.getUTCFullYear().toString();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');

  if (mode === 'category_site_year_month') {
    return [doc.category, doc.siteName, year, month];
  }

  // category_year_month_site
  return [doc.category, year, month, doc.siteName];
}

/**
 * Extracts sub-folders and documents at a specific path level from a document set.
 *
 * Given a list of documents (each with a pre-computed folderPath) and a targetPath,
 * returns:
 * - folders: distinct next-level path segments with documentCount (number of docs in that subtree),
 *   lastUpdated (max createdAt in the subtree), and childFolderCount (distinct sub-segments below).
 * - documentsAtPath: documents whose folderPath length exactly equals the targetPath length
 *   (i.e., they live at this level, not deeper).
 *
 * A document is considered under this path if its folderPath starts with all targetPath segments.
 */
export function getItemsAtPath(
  documents: UnifiedDocument[],
  targetPath: string[]
): { folders: FolderNode[]; documentsAtPath: UnifiedDocument[] } {
  const depth = targetPath.length;

  // Track folder metadata: documentCount, lastUpdated, and child segments for childFolderCount
  const foldersMap = new Map<
    string,
    { count: number; lastUpdated: string; childSegments: Set<string> }
  >();
  const documentsAtPath: UnifiedDocument[] = [];

  for (const doc of documents) {
    // Check if this document's folderPath starts with the targetPath
    if (doc.folderPath.length < depth) continue;

    let pathMatches = true;
    for (let i = 0; i < depth; i++) {
      if (doc.folderPath[i] !== targetPath[i]) {
        pathMatches = false;
        break;
      }
    }
    if (!pathMatches) continue;

    if (doc.folderPath.length === depth) {
      // Document lives exactly at this path level
      documentsAtPath.push(doc);
    } else {
      // Document is deeper — contributes to a sub-folder
      const folderName = doc.folderPath[depth]!;
      const existing = foldersMap.get(folderName);

      if (existing) {
        existing.count++;
        // Update lastUpdated if this doc is newer
        if (doc.createdAt > existing.lastUpdated) {
          existing.lastUpdated = doc.createdAt;
        }
        // Track child segments (segments at depth+1) for childFolderCount
        if (doc.folderPath.length > depth + 1) {
          existing.childSegments.add(doc.folderPath[depth + 1]!);
        }
      } else {
        const childSegments = new Set<string>();
        if (doc.folderPath.length > depth + 1) {
          childSegments.add(doc.folderPath[depth + 1]!);
        }
        foldersMap.set(folderName, {
          count: 1,
          lastUpdated: doc.createdAt,
          childSegments,
        });
      }
    }
  }

  const folders: FolderNode[] = Array.from(foldersMap.entries()).map(
    ([name, { count, lastUpdated, childSegments }]) => ({
      id: [...targetPath, name].join('/'),
      name,
      path: [...targetPath, name],
      childFolderCount: childSegments.size,
      documentCount: count,
      lastUpdated,
    })
  );

  return { folders, documentsAtPath };
}
