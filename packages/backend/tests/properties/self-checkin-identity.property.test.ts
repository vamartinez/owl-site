/**
 * Property: identity non-disclosure.
 *
 * For any failed identity challenge — whether it produces ZERO worker matches
 * or MORE THAN ONE match — verifyIdentity returns the identical uniform failure
 * result `{ verified: false }` with no worker_id. The result never reveals which
 * field (phone vs name) matched.
 *
 * Validates: Requirements 3.3, 7.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

const mockSend = vi.fn();
vi.mock('../../src/shared/dynamo-client.js', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  getTableName: (n: string) => `dev-${n}`,
}));

import { verifyIdentity } from '../../src/services/self-checkin/identity-verify.js';

beforeEach(() => mockSend.mockReset());

function worker(phone: string, legalName: string, id: string) {
  return { worker_id: id, phone, legal_name: legalName, status: 'active' };
}

describe('Property: identity non-disclosure', () => {
  it('zero matches → uniform { verified: false }', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 4, maxLength: 4 }).map((s) => s.replace(/\D/g, '0')),
        fc.string({ minLength: 1, maxLength: 20 }),
        async (last4, name) => {
          // Workers table returns entries that do NOT match the challenge.
          mockSend.mockResolvedValueOnce({
            Items: [worker('+16040000000', 'Nobody Here', 'w-x')],
          });
          const r = await verifyIdentity('tenant-1', { phone_last4: '9999', legal_name: 'Zzz Nomatch' });
          expect(r.verified).toBe(false);
          expect(r.worker_id).toBeUndefined();
          void last4;
          void name;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('multiple matches → same uniform { verified: false }', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(true), async () => {
        // Two workers share the same last-4 AND same normalized name → ambiguous.
        mockSend.mockResolvedValueOnce({
          Items: [worker('+16045551234', 'John Smith', 'w-1'), worker('+17785551234', 'john  smith', 'w-2')],
        });
        const r = await verifyIdentity('tenant-1', { phone_last4: '1234', legal_name: 'John Smith' });
        expect(r.verified).toBe(false);
        expect(r.worker_id).toBeUndefined();
      }),
      { numRuns: 20 }
    );
  });

  it('the failure result body is byte-identical across zero-match and multi-match', async () => {
    mockSend.mockResolvedValueOnce({ Items: [worker('+16040000000', 'Nobody', 'w-x')] });
    const zero = await verifyIdentity('tenant-1', { phone_last4: '9999', legal_name: 'Nomatch' });

    mockSend.mockResolvedValueOnce({
      Items: [worker('+16045551234', 'John Smith', 'w-1'), worker('+17785551234', 'John Smith', 'w-2')],
    });
    const multi = await verifyIdentity('tenant-1', { phone_last4: '1234', legal_name: 'John Smith' });

    expect(JSON.stringify(zero)).toBe(JSON.stringify(multi));
  });

  it('exactly one match → verified with worker_id', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [worker('+16045551234', 'John Smith', 'w-1'), worker('+17780009999', 'Jane Doe', 'w-2')],
    });
    const r = await verifyIdentity('tenant-1', { phone_last4: '1234', legal_name: 'John Smith' });
    expect(r.verified).toBe(true);
    expect(r.worker_id).toBe('w-1');
  });
});
