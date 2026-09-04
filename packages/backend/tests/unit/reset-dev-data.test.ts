/**
 * Unit tests for the reset-dev-data script's safety-critical logic:
 *   - the environment guard (MUST refuse anything but `dev`), and
 *   - dry-run detection from argv (the branch that suppresses all writes).
 *
 * These are the two behaviors that make the script safe to point at a shared
 * environment, so they are the ones worth pinning down with tests. The script
 * sets VITEST-aware auto-run suppression, so importing it here does NOT execute
 * the destructive routine.
 */

import { describe, it, expect } from 'vitest';
import { isDevEnvironment, isDryRun } from '../../scripts/reset-dev-data.js';

describe('reset-dev-data environment guard', () => {
  it('permits ONLY the dev environment', () => {
    expect(isDevEnvironment('dev')).toBe(true);
  });

  it('refuses prod', () => {
    expect(isDevEnvironment('prod')).toBe(false);
  });

  it('refuses staging / any other named environment', () => {
    expect(isDevEnvironment('staging')).toBe(false);
    expect(isDevEnvironment('production')).toBe(false);
    expect(isDevEnvironment('test')).toBe(false);
  });

  it('refuses an unset environment', () => {
    expect(isDevEnvironment(undefined)).toBe(false);
    expect(isDevEnvironment('')).toBe(false);
  });

  it('refuses a near-miss / typo of dev (exact match only)', () => {
    expect(isDevEnvironment('DEV')).toBe(false);
    expect(isDevEnvironment('dev ')).toBe(false);
    expect(isDevEnvironment('development')).toBe(false);
  });
});

describe('reset-dev-data dry-run detection', () => {
  it('is true when --dry-run is present', () => {
    expect(isDryRun(['node', 'reset-dev-data.cjs', '--dry-run'])).toBe(true);
  });

  it('is true regardless of flag position', () => {
    expect(isDryRun(['--dry-run', 'node', 'reset-dev-data.cjs'])).toBe(true);
  });

  it('is false when the flag is absent (i.e. a real, destructive run)', () => {
    expect(isDryRun(['node', 'reset-dev-data.cjs'])).toBe(false);
  });

  it('does not treat a partial/substring match as the flag', () => {
    expect(isDryRun(['node', 'reset-dev-data.cjs', '--dry-run-please'])).toBe(false);
    expect(isDryRun(['node', 'reset-dev-data.cjs', 'dry-run'])).toBe(false);
  });
});
