/**
 * Unit tests for the shared Ollama Cloud client bootstrap.
 *
 * ai-provider-migration Task 1.3 (Ollama provider):
 *  - memoizes (constructs the client once across repeated calls)
 *  - reads the key from env when present (strategy A)
 *  - falls back to Secrets Manager when only the ARN is set (strategy B)
 *  - constructs the client against the Ollama Cloud host with a Bearer header
 *  - throws a clear, secret-value-free error when neither is configured
 *  - no code path includes the key value in an error message
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Track how many times the Ollama client is constructed and with what options.
const ollamaCtor = vi.hoisted(() => vi.fn());
vi.mock('ollama', () => ({
  Ollama: class MockOllama {
    opts: unknown;
    constructor(opts: unknown) {
      ollamaCtor(opts);
      this.opts = opts;
    }
  },
}));

// Mock Secrets Manager: send() returns whatever the test queues up.
const smSend = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = smSend;
  },
  GetSecretValueCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

import {
  getOllamaClient,
  resolveApiKey,
  OLLAMA_CLOUD_HOST,
  __resetOllamaClientForTests,
} from '../ollama-client.js';

const ENV_KEY = 'OLLAMA_API_KEY';
const ARN_KEY = 'OLLAMA_API_KEY_SECRET_ARN';
const REAL_KEY_VALUE = 'ollama-secret-value-should-never-leak';

describe('ollama-client bootstrap', () => {
  beforeEach(() => {
    __resetOllamaClientForTests();
    ollamaCtor.mockClear();
    smSend.mockReset();
    delete process.env[ENV_KEY];
    delete process.env[ARN_KEY];
  });

  afterEach(() => {
    delete process.env[ENV_KEY];
    delete process.env[ARN_KEY];
  });

  it('reads the key from the environment when present (strategy A)', async () => {
    process.env[ENV_KEY] = REAL_KEY_VALUE;
    const key = await resolveApiKey();
    expect(key).toBe(REAL_KEY_VALUE);
    expect(smSend).not.toHaveBeenCalled();
  });

  it('falls back to Secrets Manager when only the ARN is set (strategy B)', async () => {
    process.env[ARN_KEY] = 'arn:aws:secretsmanager:us-west-2:123:secret:dev-ollama-api-key';
    smSend.mockResolvedValue({ SecretString: REAL_KEY_VALUE });
    const key = await resolveApiKey();
    expect(key).toBe(REAL_KEY_VALUE);
    expect(smSend).toHaveBeenCalledTimes(1);
  });

  it('constructs the client against the Ollama Cloud host with a Bearer header', async () => {
    process.env[ENV_KEY] = REAL_KEY_VALUE;
    await getOllamaClient();
    expect(ollamaCtor).toHaveBeenCalledTimes(1);
    const opts = ollamaCtor.mock.calls[0][0] as { host: string; headers: Record<string, string> };
    expect(opts.host).toBe(OLLAMA_CLOUD_HOST);
    expect(opts.headers.Authorization).toBe(`Bearer ${REAL_KEY_VALUE}`);
  });

  it('memoizes the client across repeated calls', async () => {
    process.env[ENV_KEY] = REAL_KEY_VALUE;
    const a = await getOllamaClient();
    const b = await getOllamaClient();
    const c = await getOllamaClient();
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(ollamaCtor).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error when neither env nor ARN is configured', async () => {
    await expect(resolveApiKey()).rejects.toThrow(/OLLAMA_API_KEY not configured/);
  });

  it('throws when the secret exists but has no value, referencing it by ARN only', async () => {
    const arn = 'arn:aws:secretsmanager:us-west-2:123:secret:dev-ollama-api-key';
    process.env[ARN_KEY] = arn;
    smSend.mockResolvedValue({ SecretString: undefined });
    await expect(resolveApiKey()).rejects.toThrow(
      new RegExp(arn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
  });

  it('never includes the key value in any error path', async () => {
    let msg1 = '';
    try {
      await resolveApiKey();
    } catch (e) {
      msg1 = (e as Error).message;
    }
    expect(msg1).not.toContain(REAL_KEY_VALUE);

    __resetOllamaClientForTests();
    process.env[ARN_KEY] = 'arn:aws:secretsmanager:us-west-2:123:secret:dev-ollama-api-key';
    smSend.mockRejectedValue(new Error('AccessDeniedException: not authorized'));
    let msg2 = '';
    try {
      await resolveApiKey();
    } catch (e) {
      msg2 = (e as Error).message;
    }
    expect(msg2).not.toContain(REAL_KEY_VALUE);
  });
});
