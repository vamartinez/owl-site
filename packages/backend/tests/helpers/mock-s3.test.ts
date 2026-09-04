/**
 * Smoke tests for the shared S3 mock helper.
 * Validates that setupS3Mock, getS3Calls, and presigned URL configuration work correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setupS3Mock, getS3Calls, resetS3Calls, getS3Mocks } from './mock-s3';

describe('mock-s3 helper', () => {
  beforeEach(() => {
    setupS3Mock();
  });

  it('setupS3Mock initialises with default presigned URL', async () => {
    const { getSignedUrl } = getS3Mocks();
    const url = await getSignedUrl();
    expect(url).toBe('https://s3.amazonaws.com/test-bucket/presigned-url');
  });

  it('setupS3Mock accepts custom presigned URL', async () => {
    setupS3Mock({ presignedUrl: 'https://custom.example.com/file.pdf' });
    const { getSignedUrl } = getS3Mocks();
    const url = await getSignedUrl();
    expect(url).toBe('https://custom.example.com/file.pdf');
  });

  it('getS3Calls returns empty array initially', () => {
    expect(getS3Calls()).toEqual([]);
  });

  it('getS3Calls records S3Client.send invocations', async () => {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({});
    const cmd = new PutObjectCommand({ Bucket: 'my-bucket', Key: 'file.txt', Body: 'hello' });
    await (client as any).send(cmd);

    const calls = getS3Calls();
    expect(calls.length).toBe(1);
    expect(calls[0].command).toBe('PutObjectCommand');
    expect(calls[0].input).toMatchObject({ Bucket: 'my-bucket', Key: 'file.txt' });
  });

  it('getS3Calls records getSignedUrl invocations', async () => {
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    await getSignedUrl({} as any, {} as any);

    const calls = getS3Calls();
    expect(calls.some((c) => c.command === 'getSignedUrl')).toBe(true);
  });

  it('resetS3Calls clears recorded calls', async () => {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({});
    await (client as any).send(new GetObjectCommand({ Bucket: 'b', Key: 'k' }));
    expect(getS3Calls().length).toBeGreaterThan(0);

    resetS3Calls();
    expect(getS3Calls()).toEqual([]);
  });
});
