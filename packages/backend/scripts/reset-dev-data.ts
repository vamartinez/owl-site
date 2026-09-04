/**
 * reset-dev-data.ts — clears and reseeds a small, clearly-labeled demo tenant's
 * data in the `dev` environment so the Admin Portal shows clean, realistic,
 * non-duplicated data for demos/pilots.
 *
 * Implements Task 7.4 of `production-readiness-audit`. Addresses Requirement
 * 6.3 (dev DB polluted by test-suite runs against shared tables).
 *
 * SAFETY (mandatory — this operates on a SHARED environment):
 *   - Refuses to run unless ENVIRONMENT=dev. It will NOT touch prod (or any
 *     non-dev environment), because a wrong-target destructive reseed is
 *     irreversible.
 *   - Supports `--dry-run`, which prints every item that WOULD be deleted (and
 *     what would be seeded) without writing or deleting anything.
 *
 * Usage:
 *   ENVIRONMENT=dev ts-node scripts/reset-dev-data.ts --dry-run
 *   ENVIRONMENT=dev ts-node scripts/reset-dev-data.ts
 *
 * The demo tenant is a fixed, clearly-labeled id (`demo-tenant`) so the reseed
 * only ever affects that tenant's partition and never a real customer tenant.
 */

import { randomUUID } from 'node:crypto';
import { QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../src/shared/dynamo-client.js';

// --- Configuration -----------------------------------------------------------

/** Clearly-labeled demo tenant; the reseed is scoped entirely to this id. */
const DEMO_TENANT_ID = 'demo-tenant';

/**
 * Company names created as throwaway lead records during Task 1/2 testing.
 * The script offers to clean these too (they pollute the leads list).
 */
const TEST_LEAD_COMPANY_NAMES = new Set(['Verify Co', 'Post Deploy Co', 'X']);

// --- Environment guard + arg parsing -----------------------------------------

/**
 * Pure guard predicate: the reseed may ONLY run against `dev`. Anything else
 * (prod, staging, unset, typo) is refused. Extracted as a pure function so the
 * guard can be unit-tested without invoking `process.exit`.
 */
export function isDevEnvironment(environment: string | undefined): boolean {
  return environment === 'dev';
}

/**
 * Pure dry-run detection from argv: true when `--dry-run` is present. Extracted
 * as a pure function so the dry-run branch can be unit-tested deterministically.
 */
export function isDryRun(argv: readonly string[]): boolean {
  return argv.includes('--dry-run');
}

const ENVIRONMENT = process.env['ENVIRONMENT'] ?? '';
const DRY_RUN = isDryRun(process.argv);

/**
 * Full table name for the demo reseed. Reuses the shared `getTableName`
 * (which reads `ENVIRONMENT` and applies the dev prefix), so this script can
 * never drift from the naming every service Lambda uses.
 */
function tableName(base: string): string {
  return getTableName(base);
}

function assertDevEnvironment(): void {
  if (!isDevEnvironment(ENVIRONMENT)) {
    console.error(
      `\nRefusing to run: this script only operates against ENVIRONMENT=dev.\n` +
        `Current ENVIRONMENT="${ENVIRONMENT || '(unset)'}".\n` +
        `This is a destructive, shared-environment operation; it will never run\n` +
        `against prod or any other environment.\n`
    );
    process.exit(1);
  }
}

// --- Logging helpers ---------------------------------------------------------

function logDelete(table: string, key: Record<string, unknown>, label?: string): void {
  const suffix = label ? ` (${label})` : '';
  console.log(`  ${DRY_RUN ? '[dry-run] would delete' : 'deleting'}: ${table} ${JSON.stringify(key)}${suffix}`);
}

function logSeed(table: string, label: string): void {
  console.log(`  ${DRY_RUN ? '[dry-run] would seed' : 'seeding'}: ${table} — ${label}`);
}

// --- Delete phase ------------------------------------------------------------

/**
 * Queries all items in the demo tenant's partition of a table (PK =
 * TENANT#{demo}) and deletes them. Used for tables partitioned directly by
 * tenant: Sites, Contractors, Workers, ScanSessions.
 */
async function clearTenantPartition(base: string): Promise<number> {
  const table = tableName(base);
  const pk = `TENANT#${DEMO_TENANT_ID}`;
  let cleared = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ExclusiveStartKey: lastKey,
      })
    );
    for (const item of res.Items ?? []) {
      const key = { PK: item['PK'], SK: item['SK'] };
      logDelete(table, key);
      if (!DRY_RUN) {
        await docClient.send(new DeleteCommand({ TableName: table, Key: key }));
      }
      cleared++;
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return cleared;
}

/**
 * Clears certifications for the demo tenant's workers. Certifications are
 * partitioned per-worker (PK = TENANT#{tenant}#WORKER#{worker}), so we clear
 * them by worker id.
 */
async function clearWorkerCertifications(workerIds: string[]): Promise<number> {
  const table = tableName('Certifications');
  let cleared = 0;

  for (const workerId of workerIds) {
    const pk = `TENANT#${DEMO_TENANT_ID}#WORKER#${workerId}`;
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await docClient.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          ExclusiveStartKey: lastKey,
        })
      );
      for (const item of res.Items ?? []) {
        const key = { PK: item['PK'], SK: item['SK'] };
        logDelete(table, key);
        if (!DRY_RUN) {
          await docClient.send(new DeleteCommand({ TableName: table, Key: key }));
        }
        cleared++;
      }
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
  }

  return cleared;
}

/**
 * Clears ContractorWorkers assignment rows for the demo tenant's contractors.
 * These are partitioned as PK = TENANT#{tenant}#CONTRACTOR#{contractor}.
 */
async function clearContractorWorkers(contractorIds: string[]): Promise<number> {
  const table = tableName('ContractorWorkers');
  let cleared = 0;

  for (const contractorId of contractorIds) {
    const pk = `TENANT#${DEMO_TENANT_ID}#CONTRACTOR#${contractorId}`;
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await docClient.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': pk },
          ExclusiveStartKey: lastKey,
        })
      );
      for (const item of res.Items ?? []) {
        const key = { PK: item['PK'], SK: item['SK'] };
        logDelete(table, key);
        if (!DRY_RUN) {
          await docClient.send(new DeleteCommand({ TableName: table, Key: key }));
        }
        cleared++;
      }
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
  }

  return cleared;
}

/**
 * Discovers existing demo-tenant worker ids and contractor ids so their
 * per-entity child rows (certifications, contractor-worker assignments) can be
 * cleared before the parent partitions are wiped.
 */
async function discoverChildOwnerIds(): Promise<{ workerIds: string[]; contractorIds: string[] }> {
  const workerIds: string[] = [];
  const contractorIds: string[] = [];
  const pk = `TENANT#${DEMO_TENANT_ID}`;

  const workersRes = await docClient.send(
    new QueryCommand({
      TableName: tableName('Workers'),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': pk, ':prefix': 'WORKER#' },
    })
  );
  for (const item of workersRes.Items ?? []) {
    if (item['worker_id']) workerIds.push(item['worker_id'] as string);
  }

  const contractorsRes = await docClient.send(
    new QueryCommand({
      TableName: tableName('Contractors'),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': pk, ':prefix': 'CONTRACTOR#' },
    })
  );
  for (const item of contractorsRes.Items ?? []) {
    if (item['contractor_id']) contractorIds.push(item['contractor_id'] as string);
  }

  return { workerIds, contractorIds };
}

/**
 * Removes the throwaway test lead records (by known company name) that were
 * created during Task 1/2 connectivity testing.
 */
async function clearTestLeads(): Promise<number> {
  const table = tableName('LeadCaptures');
  let cleared = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'LEADS' },
        ExclusiveStartKey: lastKey,
      })
    );
    for (const item of res.Items ?? []) {
      const company = item['company_name'] as string | undefined;
      if (company && TEST_LEAD_COMPANY_NAMES.has(company)) {
        const key = { PK: item['PK'], SK: item['SK'] };
        logDelete(table, key, `test lead "${company}"`);
        if (!DRY_RUN) {
          await docClient.send(new DeleteCommand({ TableName: table, Key: key }));
        }
        cleared++;
      }
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return cleared;
}

// --- Seed phase --------------------------------------------------------------

function isoDate(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;
}

async function put(base: string, item: Record<string, unknown>): Promise<void> {
  if (!DRY_RUN) {
    await docClient.send(new PutCommand({ TableName: tableName(base), Item: item }));
  }
}

interface SeedResult {
  siteIds: string[];
  contractorIds: string[];
  workerIds: string[];
  scanSessionCount: number;
  certCount: number;
}

async function seedDemoData(): Promise<SeedResult> {
  const now = new Date().toISOString();
  const pk = `TENANT#${DEMO_TENANT_ID}`;

  // --- Sites (2-3, clearly labeled) ---
  const sites = [
    { name: 'Demo — Downtown Tower', address: '100 Granville St, Vancouver, BC', contractor: 'Northwest Builders Ltd' },
    { name: 'Demo — Riverside Bridge', address: '2200 Marine Dr, Burnaby, BC', contractor: 'Coastal Infrastructure Co' },
    { name: 'Demo — Airport Expansion', address: '3211 Grant McConachie Way, Richmond, BC', contractor: 'Northwest Builders Ltd' },
  ];
  const siteIds: string[] = [];
  for (const s of sites) {
    const siteId = randomUUID();
    siteIds.push(siteId);
    logSeed('Sites', s.name);
    await put('Sites', {
      PK: pk,
      SK: `SITE#${siteId}`,
      GSI1PK: pk,
      GSI1SK: `SITE#${now}`,
      site_id: siteId,
      tenant_id: DEMO_TENANT_ID,
      name: s.name,
      address: s.address,
      timezone: 'America/Vancouver',
      status: 'active',
      // computeSiteCompliance reads `contractor`/`contractor_name` from the site record.
      contractor_name: s.contractor,
      created_at: now,
      updated_at: now,
    });
  }

  // --- Contractors (1-2) ---
  const contractors = [
    { company_name: 'Northwest Builders Ltd', contact_name: 'Sarah Chen', contact_email: 'sarah@nwbuilders.example', contact_phone: '+16045550101' },
    { company_name: 'Coastal Infrastructure Co', contact_name: 'Marcus Reid', contact_email: 'marcus@coastalinfra.example', contact_phone: '+16045550102' },
  ];
  const contractorIds: string[] = [];
  for (const c of contractors) {
    const contractorId = randomUUID();
    contractorIds.push(contractorId);
    logSeed('Contractors', c.company_name);
    await put('Contractors', {
      PK: pk,
      SK: `CONTRACTOR#${contractorId}`,
      GSI1PK: pk,
      GSI1SK: `STATUS#active#${now}`,
      contractor_id: contractorId,
      tenant_id: DEMO_TENANT_ID,
      company_name: c.company_name,
      contact_name: c.contact_name,
      contact_email: c.contact_email,
      contact_phone: c.contact_phone,
      status: 'active',
      created_at: now,
      updated_at: now,
    });
  }

  // --- Workers (~10) with varied certification states ---
  // cert state: 'valid' | 'expiring' (within 30d) | 'expired' | 'none'
  const workers: Array<{ legal_name: string; preferred_name?: string; phone: string; certState: 'valid' | 'expiring' | 'expired' | 'none' }> = [
    { legal_name: 'James Okafor', preferred_name: 'Jim', phone: '+16045551001', certState: 'valid' },
    { legal_name: 'Priya Sharma', phone: '+16045551002', certState: 'valid' },
    { legal_name: 'Liam Murphy', phone: '+16045551003', certState: 'expiring' },
    { legal_name: 'Wei Zhang', phone: '+16045551004', certState: 'valid' },
    { legal_name: 'Sofia Rossi', phone: '+16045551005', certState: 'expired' },
    { legal_name: 'Ahmed Hassan', phone: '+16045551006', certState: 'valid' },
    { legal_name: 'Emily Carter', preferred_name: 'Em', phone: '+16045551007', certState: 'expiring' },
    { legal_name: 'Diego Fernandez', phone: '+16045551008', certState: 'none' },
    { legal_name: 'Hannah Kim', phone: '+16045551009', certState: 'valid' },
    { legal_name: 'Noah Williams', phone: '+16045551010', certState: 'expired' },
  ];

  const certTypes = ['OSHA-30', 'First Aid', 'Fall Protection', 'WHMIS', 'Confined Space'];
  const issuers = ['BCCSA', 'WorkSafeBC', 'Red Cross', 'St. John Ambulance'];

  const workerIds: string[] = workers.map(() => randomUUID());
  let certCount = 0;

  // Persist workers + their certs.
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i]!;
    const workerId = workerIds[i]!;
    logSeed('Workers', `${w.legal_name} (cert: ${w.certState})`);
    await put('Workers', {
      PK: pk,
      SK: `WORKER#${workerId}`,
      GSI1PK: pk,
      GSI1SK: `WORKER#${now}`,
      worker_id: workerId,
      tenant_id: DEMO_TENANT_ID,
      legal_name: w.legal_name,
      preferred_name: w.preferred_name,
      phone: w.phone,
      language_preference: 'en',
      qr_identity_reference: randomUUID(),
      status: 'active',
      created_at: now,
      updated_at: now,
    });

    if (w.certState !== 'none') {
      const certId = randomUUID();
      // expiry + validation_status vary by state.
      let expiryDate: string;
      let validationStatus: string;
      if (w.certState === 'valid') {
        expiryDate = isoDate(365);
        validationStatus = 'validated';
      } else if (w.certState === 'expiring') {
        expiryDate = isoDate(15);
        validationStatus = 'validated';
      } else {
        // expired
        expiryDate = isoDate(-30);
        validationStatus = 'expired';
      }
      const certType = certTypes[i % certTypes.length]!;
      logSeed('Certifications', `${w.legal_name} — ${certType} (${w.certState})`);
      await put('Certifications', {
        PK: `TENANT#${DEMO_TENANT_ID}#WORKER#${workerId}`,
        SK: `CERT#${certId}`,
        GSI1PK: pk,
        GSI1SK: `CERT#${expiryDate}#${certId}`,
        certification_id: certId,
        worker_id: workerId,
        tenant_id: DEMO_TENANT_ID,
        certification_type: certType,
        issuer: issuers[i % issuers.length]!,
        issue_date: isoDate(-200),
        expiry_date: expiryDate,
        validation_status: validationStatus,
        created_at: now,
        updated_at: now,
      });
      certCount++;
    }
  }

  // --- Assign workers to contractors (split roughly evenly) ---
  for (let i = 0; i < workerIds.length; i++) {
    const contractorId = contractorIds[i % contractorIds.length]!;
    const workerId = workerIds[i]!;
    logSeed('ContractorWorkers', `worker ${i + 1} -> contractor ${(i % contractorIds.length) + 1}`);
    await put('ContractorWorkers', {
      PK: `TENANT#${DEMO_TENANT_ID}#CONTRACTOR#${contractorId}`,
      SK: `WORKER#${workerId}`,
      GSI1PK: `TENANT#${DEMO_TENANT_ID}#WORKER#${workerId}`,
      GSI1SK: `CONTRACTOR#${contractorId}`,
      contractor_id: contractorId,
      worker_id: workerId,
      tenant_id: DEMO_TENANT_ID,
      assigned_at: now,
      assigned_by: 'reset-dev-data-script',
    });
  }

  // --- ScanSessions across the last 7 days with mixed allowed/denied ---
  // Gives the Dashboard "Compliance Trend" chart a real, varied series.
  let scanSessionCount = 0;
  for (let day = 6; day >= 0; day--) {
    // Vary the number of scans and the allowed/denied mix per day so the trend
    // line isn't flat.
    const scansToday = 3 + ((day * 2) % 4); // 3..6 scans
    // deny ratio oscillates so compliance % varies day to day.
    const denyEvery = day % 2 === 0 ? 4 : 3;
    for (let n = 0; n < scansToday; n++) {
      const sessionId = randomUUID();
      const workerId = workerIds[(day + n) % workerIds.length]!;
      const siteId = siteIds[(day + n) % siteIds.length]!;
      const result = n % denyEvery === denyEvery - 1 ? 'denied' : 'allowed';
      // spread timestamps within the day
      const ts = new Date(Date.now() - day * 24 * 60 * 60 * 1000 - n * 60 * 60 * 1000).toISOString();
      logSeed('ScanSessions', `${result} on day -${day} (${ts})`);
      await put('ScanSessions', {
        PK: pk,
        SK: `SESSION#${sessionId}`,
        GSI1PK: `WORKER#${workerId}`,
        GSI1SK: `SESSION#${ts}`,
        GSI2PK: `SITE#${siteId}`,
        GSI2SK: `SESSION#${ts}`,
        GSI3PK: `TOKEN#${randomUUID()}`,
        GSI3SK: `SESSION#${ts}`,
        session_id: sessionId,
        tenant_id: DEMO_TENANT_ID,
        worker_id: workerId,
        site_id: siteId,
        timestamp: ts,
        scanner_type: 'qr',
        device_id: `demo-device-${(day + n) % 3}`,
        token_ref: randomUUID(),
        decision_ref: randomUUID(),
        result,
        replay_risk_flag: false,
      });
      scanSessionCount++;
    }
  }

  return { siteIds, contractorIds, workerIds, scanSessionCount, certCount };
}

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  assertDevEnvironment();

  console.log(
    `\n=== reset-dev-data (${DRY_RUN ? 'DRY RUN — no writes/deletes' : 'LIVE'}) ===\n` +
      `Environment: ${ENVIRONMENT}\n` +
      `Demo tenant: ${DEMO_TENANT_ID}\n`
  );

  // --- Clear phase (children first, then parent partitions) ---
  console.log('--- Clearing existing demo-tenant data ---');
  const { workerIds: existingWorkerIds, contractorIds: existingContractorIds } =
    await discoverChildOwnerIds();

  const clearedCerts = await clearWorkerCertifications(existingWorkerIds);
  const clearedAssignments = await clearContractorWorkers(existingContractorIds);
  const clearedWorkers = await clearTenantPartition('Workers');
  const clearedContractors = await clearTenantPartition('Contractors');
  const clearedSites = await clearTenantPartition('Sites');
  const clearedScans = await clearTenantPartition('ScanSessions');
  const clearedLeads = await clearTestLeads();

  console.log(
    `\nCleared (${DRY_RUN ? 'would clear' : 'cleared'}): ` +
      `${clearedSites} sites, ${clearedContractors} contractors, ${clearedWorkers} workers, ` +
      `${clearedCerts} certifications, ${clearedAssignments} assignments, ` +
      `${clearedScans} scan sessions, ${clearedLeads} test leads.\n`
  );

  // --- Seed phase ---
  console.log('--- Seeding demo-tenant data ---');
  const seeded = await seedDemoData();

  console.log(
    `\nSeeded (${DRY_RUN ? 'would seed' : 'seeded'}): ` +
      `${seeded.siteIds.length} sites, ${seeded.contractorIds.length} contractors, ` +
      `${seeded.workerIds.length} workers, ${seeded.certCount} certifications, ` +
      `${seeded.scanSessionCount} scan sessions (last 7 days, mixed allowed/denied).\n`
  );

  console.log(`=== Done${DRY_RUN ? ' (dry run — nothing was written)' : ''} ===\n`);
}

// Auto-run when executed as a script, but NOT when imported by a unit test
// (vitest sets VITEST=true), so the guard/dry-run helpers can be tested without
// this destructive routine firing against a real environment.
if (!process.env['VITEST']) {
  main().catch((err) => {
    console.error('reset-dev-data failed:', err);
    process.exit(1);
  });
}
