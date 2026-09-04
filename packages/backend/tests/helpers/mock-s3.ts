/**
 * Shared S3 mock helper for test suites.
 *
 * Mocks `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` via vi.mock,
 * intercepting all S3Client commands and getSignedUrl calls.
 *
 * Usage:
 *   import { setupS3Mock, getS3Calls } from '../helpers/mock-s3';
 *
 *   beforeEach(() => {
 *     setupS3Mock({ presignedUrl: 'https://example.com/signed' });
 *   });
 *
 * Requirements: 20.4
 */

import { vi } from 'vitest';

// ─── Internal State ──────────────────────────────────────────────────────────

interface S3Call {
  command: string;
  input: unknown;
}

let s3Calls: S3Call[] = [];
let mockSend: ReturnType<typeof vi.fn>;
let mockGetSignedUrl: ReturnType<typeof vi.fn>;

// ─── Mock Setup ──────────────────────────────────────────────────────────────

/**
 * Initialise (or re-initialise) the S3 and presigner mocks.
 *
 * @param options.presignedUrl - The URL that `getSignedUrl` will resolve to.
 *   Defaults to `'https://s3.amazonaws.com/test-bucket/presigned-url'`.
 */
export function setupS3Mock(options?: { presignedUrl?: string }): void {
  const presignedUrl =
    options?.presignedUrl ?? 'https://s3.amazonaws.com/test-bucket/presigned-url';

  // Reset call history
  s3Calls = [];

  // Create the mock send function that records calls
  mockSend = vi.fn().mockImplementation((command: unknown) => {
    // command is already the input object because our mock constructors just pass through
    return Promise.resolve({});
  });

  mockGetSignedUrl = vi.fn().mockResolvedValue(presignedUrl);

  // Mock @aws-sdk/client-s3
  vi.mock('@aws-sdk/client-s3', () => ({
    S3Client: vi.fn().mockImplementation(() => ({
      send: (command: unknown) => {
        // The command is the raw input from our mock constructors below
        const call = command as { _commandName?: string; [key: string]: unknown };
        const commandName = call._commandName ?? 'UnknownCommand';
        const { _commandName, ...input } = call;
        s3Calls.push({ command: commandName, input });
        return mockSend(command);
      },
    })),
    GetObjectCommand: vi.fn().mockImplementation((input: unknown) => ({
      ...((input as object) ?? {}),
      _commandName: 'GetObjectCommand',
    })),
    PutObjectCommand: vi.fn().mockImplementation((input: unknown) => ({
      ...((input as object) ?? {}),
      _commandName: 'PutObjectCommand',
    })),
    DeleteObjectCommand: vi.fn().mockImplementation((input: unknown) => ({
      ...((input as object) ?? {}),
      _commandName: 'DeleteObjectCommand',
    })),
    HeadObjectCommand: vi.fn().mockImplementation((input: unknown) => ({
      ...((input as object) ?? {}),
      _commandName: 'HeadObjectCommand',
    })),
    ListObjectsV2Command: vi.fn().mockImplementation((input: unknown) => ({
      ...((input as object) ?? {}),
      _commandName: 'ListObjectsV2Command',
    })),
  }));

  // Mock @aws-sdk/s3-request-presigner
  vi.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: (...args: unknown[]) => {
      // Record presigner calls as well
      s3Calls.push({ command: 'getSignedUrl', input: args });
      return mockGetSignedUrl(...args);
    },
  }));
}

// ─── Query Helpers ───────────────────────────────────────────────────────────

/**
 * Returns all S3-related calls recorded since the last `setupS3Mock()` call.
 * Each entry contains the command name and its input parameters.
 */
export function getS3Calls(): S3Call[] {
  return [...s3Calls];
}

/**
 * Resets the recorded S3 calls without re-initialising the mocks.
 */
export function resetS3Calls(): void {
  s3Calls = [];
}

/**
 * Provides direct access to the underlying mock functions for advanced assertions
 * (e.g. checking call arguments on `getSignedUrl`).
 */
export function getS3Mocks() {
  return {
    send: mockSend,
    getSignedUrl: mockGetSignedUrl,
  };
}
