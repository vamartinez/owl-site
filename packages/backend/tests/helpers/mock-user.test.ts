import { describe, it, expect } from 'vitest';
import { createMockClaims } from './mock-user.js';

describe('createMockClaims', () => {
  it('returns tenant_admin for tenant-test by default', () => {
    const claims = createMockClaims();

    expect(claims['sub']).toBe('user-test-1');
    expect(claims['custom:role']).toBe('tenant_admin');
    expect(claims['custom:tenant_id']).toBe('tenant-test');
    expect(claims['email']).toBe('admin@tenant-test.com');
    expect(claims['custom:assigned_sites']).toBeUndefined();
  });

  it('allows overriding role', () => {
    const claims = createMockClaims({ role: 'worker' });

    expect(claims['custom:role']).toBe('worker');
    expect(claims['custom:tenant_id']).toBe('tenant-test');
  });

  it('allows overriding tenant_id', () => {
    const claims = createMockClaims({ tenant_id: 'tenant-abc' });

    expect(claims['custom:tenant_id']).toBe('tenant-abc');
  });

  it('allows overriding user_id', () => {
    const claims = createMockClaims({ user_id: 'custom-user-99' });

    expect(claims['sub']).toBe('custom-user-99');
  });

  it('allows overriding email', () => {
    const claims = createMockClaims({ email: 'worker@example.com' });

    expect(claims['email']).toBe('worker@example.com');
  });

  it('serializes assigned_sites as comma-separated string', () => {
    const claims = createMockClaims({ assigned_sites: ['site-1', 'site-2', 'site-3'] });

    expect(claims['custom:assigned_sites']).toBe('site-1,site-2,site-3');
  });

  it('omits assigned_sites when array is empty', () => {
    const claims = createMockClaims({ assigned_sites: [] });

    expect(claims['custom:assigned_sites']).toBeUndefined();
  });

  it('supports all options together', () => {
    const claims = createMockClaims({
      user_id: 'u-42',
      tenant_id: 'tenant-xyz',
      role: 'site_admin',
      email: 'site@xyz.com',
      assigned_sites: ['site-a'],
    });

    expect(claims['sub']).toBe('u-42');
    expect(claims['custom:role']).toBe('site_admin');
    expect(claims['custom:tenant_id']).toBe('tenant-xyz');
    expect(claims['email']).toBe('site@xyz.com');
    expect(claims['custom:assigned_sites']).toBe('site-a');
  });
});
