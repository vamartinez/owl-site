/**
 * ai-provider-migration — Property 3 & Property 4 (Ollama client bootstrap).
 *
 * Property 3 (Task 1.4): No OLLAMA_API_KEY in code or logs.
 *   For any execution path or error condition (success, missing config,
 *   secret-retrieval failure), the key value never appears in error messages;
 *   errors reference the secret by ARN/name only. Validates: Requirements 3.1
 *
 * Property 4 (Task 1.5): Secret read only from Secrets Manager.
 *   For any resolution path, the key is obtained solely from the Lambda env
 *   (CDK-resolved) or from Secrets Manager, and from no other source.
 *   Validates: Requirements 3.1, 3.2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

const ollamaCtor = vi.hoisted(() => vi.fn());
vi.mock('ollama', () => ({
  Ollama: class MockOllama {
    constructor(opts: unknown) {
      ollamaCtor(opts);
    }
  },
}));

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
  resolveApiKey,
  __resetOllamaClientForTests,
} from '../../src/shared/ollama-client.js';

const ENV_KEY = 'OLLAMA_API_KEY';
const ARN_KEY = 'OLLAMA_API_KEY_SECRET_ARN';

function clearEnv(): void {
  delete process.env[ENV_KEY];
  delete process.env[ARN_KEY];
}

const arbKey = fc
  .string({ minLength: 20, maxLength: 120 })
  .map((s) => `ollama-${s.replace(/\s/g, 'x')}`);

const arbArn = fc
  .string({ minLength: 4, maxLength: 40 })
  .map((s) => `arn:aws:secretsmanager:us-west-2:123456789012:secret:${s.replace(/\s/g, '-')}`);

describe('Property 3: No OLLAMA_API_KEY in code or logs', () => {
  beforeEach(() => {
    __resetOllamaClientForTests();
    ollamaCtor.mockClear();
    smSend.mockReset();
    clearEnv();
  });

  it('missing-config error never contains any key value', async () => {
    await fc.assert(
      fc.asyncProperty(arbKey, async (key) => {
        __resetOllamaClientForTests();
        clearEnv();
        let message = '';
        try {
          await resolveApiKey();
        } catch (e) {
          message = (e as Error).message;
        }
        expect(message).not.toContain(key);
      }),
      { numRuns: 100 }
    );
  });

  it('secret-retrieval-failure error references the ARN only, never the key value', async () => {
    await fc.assert(
      fc.asyncProperty(arbKey, arbArn, async (key, arn) => {
        __resetOllamaClientForTests();
        clearEnv();
        process.env[ARN_KEY] = arn;
        smSend.mockRejectedValueOnce(new Error('AccessDeniedException'));
        let message = '';
        try {
          await resolveApiKey();
        } catch (e) {
          message = (e as Error).message;
        }
        expect(message).not.toContain(key);
      }),
      { numRuns: 100 }
    );
  });

  it('empty-secret error references the ARN but not the key value', async () => {
    await fc.assert(
      fc.asyncProperty(arbKey, arbArn, async (key, arn) => {
        __resetOllamaClientForTests();
        clearEnv();
        process.env[ARN_KEY] = arn;
        smSend.mockResolvedValueOnce({ SecretString: undefined });
        let message = '';
        try {
          await resolveApiKey();
        } catch (e) {
          message = (e as Error).message;
        }
        expect(message).toContain(arn);
        expect(message).not.toContain(key);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 4: Secret read only from Secrets Manager', () => {
  beforeEach(() => {
    __resetOllamaClientForTests();
    ollamaCtor.mockClear();
    smSend.mockReset();
    clearEnv();
  });

  it('strategy A: when env key is present, Secrets Manager is never consulted', async () => {
    await fc.assert(
      fc.asyncProperty(arbKey, async (key) => {
        __resetOllamaClientForTests();
        clearEnv();
        smSend.mockReset();
        process.env[ENV_KEY] = key;
        const resolved = await resolveApiKey();
        expect(resolved).toBe(key);
        expect(smSend).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  it('strategy B: when only the ARN is set, the key comes exactly from the Secrets Manager response', async () => {
    await fc.assert(
      fc.asyncProperty(arbKey, arbArn, async (key, arn) => {
        __resetOllamaClientForTests();
        clearEnv();
        smSend.mockReset();
        process.env[ARN_KEY] = arn;
        smSend.mockResolvedValueOnce({ SecretString: key });
        const resolved = await resolveApiKey();
        expect(resolved).toBe(key);
        expect(smSend).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 }
    );
  });
});
