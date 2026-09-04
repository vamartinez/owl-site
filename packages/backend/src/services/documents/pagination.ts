/**
 * Pagination utility for the Document Explorer service.
 * Provides generic array-based pagination with metadata.
 */

/**
 * Applies pagination to an array of items.
 * Clamps the page to valid range and returns the sliced data with metadata.
 */
export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): { data: T[]; total: number; page: number; pageSize: number; totalPages: number } {
  const total = items.length;
  const totalPages = Math.ceil(total / pageSize);
  const clampedPage = totalPages === 0 ? 1 : Math.max(1, Math.min(page, totalPages));
  const start = (clampedPage - 1) * pageSize;
  const data = items.slice(start, start + pageSize);

  return { data, total, page: clampedPage, pageSize, totalPages };
}
