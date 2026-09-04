/**
 * Zod validation schemas for the Access Service endpoints.
 */

import { z } from 'zod';

/**
 * Schema for POST /site-access/check-in request body.
 * Validates that workerId is a non-empty string.
 */
export const checkInSchema = z.object({
  workerId: z.string().min(1, 'workerId is required'),
});

export type CheckInRequest = z.infer<typeof checkInSchema>;
