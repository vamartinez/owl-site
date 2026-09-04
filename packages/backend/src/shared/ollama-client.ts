/**
 * Shared Ollama Cloud client bootstrap.
 *
 * This is the ONE place the OLLAMA_API_KEY is read and the ONE place an
 * `Ollama` client is constructed. Every migrated AI service
 * (detection, scene-understanding, regulatory-mapping, report-validation)
 * imports `getOllamaClient()` from here.
 *
 * Provider: Ollama Cloud (https://ollama.com) — cloud models run on Ollama's
 * managed infrastructure, billed against the account's plan (Free/Pro/Max),
 * NOT per token. Authenticated with the account owner's `OLLAMA_API_KEY`.
 *
 * Text services use `gpt-oss:120b-cloud`; the vision service (detection) uses
 * `qwen3.5:cloud` (the only class of model here that accepts image input).
 *
 * Design invariants (mirrors ai-provider-migration Requirement 3):
 *  - The key value is NEVER logged and NEVER included in an error message.
 *    Errors reference the secret by ARN/name only.
 *  - The key is obtained SOLELY from the Lambda env (CDK-resolved, strategy A)
 *    or from AWS Secrets Manager (strategy B, preferred) — and from no other
 *    source.
 *  - The client is memoized per warm Lambda container so the secret is read
 *    at most once per container lifetime.
 */

import { Ollama } from 'ollama';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

/** Ollama Cloud host. Cloud models are addressed as a remote Ollama host. */
export const OLLAMA_CLOUD_HOST = 'https://ollama.com';

/** Memoized client, reused across warm Lambda invocations. */
let cachedClient: Ollama | undefined;

/** Memoized Secrets Manager client (only constructed if strategy B is used). */
let secretsManagerClient: SecretsManagerClient | undefined;

function getSecretsManagerClient(): SecretsManagerClient {
  if (!secretsManagerClient) {
    secretsManagerClient = new SecretsManagerClient({});
  }
  return secretsManagerClient;
}

/**
 * Resolve the Ollama Cloud API key.
 *
 * Strategy A (env): CDK resolved the secret into `OLLAMA_API_KEY` at deploy
 *   time. Returned directly when present.
 * Strategy B (Secrets Manager, preferred): only the secret ARN/name is injected
 *   via `OLLAMA_API_KEY_SECRET_ARN`; the value is fetched at runtime.
 *
 * Throws a clear, secret-value-free error when neither is configured, or when
 * the secret exists but carries no value. The thrown message references the
 * secret by ARN/name only — never the key value.
 */
export async function resolveApiKey(): Promise<string> {
  // Strategy A: value already resolved into the environment by CDK.
  const envKey = process.env['OLLAMA_API_KEY'];
  if (envKey) {
    return envKey;
  }

  // Strategy B: fetch from Secrets Manager by ARN/name at runtime.
  const secretId = process.env['OLLAMA_API_KEY_SECRET_ARN'];
  if (!secretId) {
    throw new Error(
      'OLLAMA_API_KEY not configured: set the OLLAMA_API_KEY env var ' +
        '(strategy A) or the OLLAMA_API_KEY_SECRET_ARN env var pointing at ' +
        'the Secrets Manager secret (strategy B).'
    );
  }

  const out = await getSecretsManagerClient().send(
    new GetSecretValueCommand({ SecretId: secretId })
  );

  if (!out.SecretString) {
    // Reference the secret by ARN/name only — never the value.
    throw new Error(`OLLAMA_API_KEY secret has no value (secret: ${secretId})`);
  }

  return out.SecretString;
}

/**
 * Return a memoized Ollama Cloud client, constructing it (and reading the key)
 * at most once per warm Lambda container. The client targets the Ollama Cloud
 * host with a Bearer-token Authorization header.
 */
export async function getOllamaClient(): Promise<Ollama> {
  if (cachedClient) {
    return cachedClient;
  }
  const apiKey = await resolveApiKey();
  cachedClient = new Ollama({
    host: OLLAMA_CLOUD_HOST,
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return cachedClient;
}

/**
 * Test-only helper: reset the memoized client and Secrets Manager client so a
 * fresh resolution path can be exercised. Not used in production code paths.
 */
export function __resetOllamaClientForTests(): void {
  cachedClient = undefined;
  secretsManagerClient = undefined;
}
