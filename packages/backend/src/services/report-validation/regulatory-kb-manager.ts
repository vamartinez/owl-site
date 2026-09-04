/**
 * Regulatory Knowledge Base Manager — versioned, clause-structured OHSR KB.
 *
 * Source of truth for effective-dated regulatory versions and their clauses
 * (design.md). The Bedrock/keyword vector KB is re-synced from this table via
 * triggerKBSync after each publish.
 *
 * Requirements: 7.1-7.9
 */

import { GetCommand, PutCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { createLogger } from '../../shared/logger.js';
import { triggerKBSync } from './kb-manager.js';
import {
  REGULATORY_CLAUSES_TABLE,
  REGULATORY_VERSIONS_TABLE,
  REGULATORY_VERSIONS_PK,
  MAX_REGULATION_TEXT_CHARS,
  MAX_CHANGE_SUMMARY_CHARS,
  MAX_APPLICABILITY_CATEGORIES,
  type RegulatoryClause,
  type RegulatoryVersion,
} from './worksafebc-types.js';

const logger = createLogger('regulatory-kb-manager');

/** 50MB total upload cap (Requirement 7 — bounded publish). */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export class RegulatoryKBError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'RegulatoryKBError';
  }
}

export interface PublishVersionInput {
  effective_date: string; // YYYY-MM-DD
  published_by: string;
  change_summary: string;
  clauses: Array<Omit<RegulatoryClause, 'version_id' | 'effective_date' | 'last_updated_at' | 'published_by' | 'change_summary'>>;
}

/** Zero-pad a sequential integer to 6 digits for lexicographic version order. */
function padVersion(n: number): string {
  return String(n).padStart(6, '0');
}

/** Read the latest published version record, or null if none. */
export async function getLatestVersion(): Promise<RegulatoryVersion | null> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: getTableName(REGULATORY_VERSIONS_TABLE),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': REGULATORY_VERSIONS_PK },
      ScanIndexForward: false, // highest version_id first (lexicographic)
      Limit: 1,
    })
  );
  return (res.Items?.[0] as RegulatoryVersion | undefined) ?? null;
}

/**
 * Resolve the active version as of a date: latest version whose effective_date
 * <= asOfDate (Requirement 7.4). Deterministic. Returns null if none.
 */
export async function getActiveVersion(asOfDate: string): Promise<RegulatoryVersion | null> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: getTableName(REGULATORY_VERSIONS_TABLE),
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: 'effective_date <= :asOf',
      ExpressionAttributeValues: { ':pk': REGULATORY_VERSIONS_PK, ':asOf': asOfDate },
      ScanIndexForward: false,
    })
  );
  const items = (res.Items ?? []) as RegulatoryVersion[];
  // Items come back highest-version first; the first passing the filter is the
  // most recent effective version. (effective_date monotonic with version_id
  // is enforced at publish time by the ordering check below.)
  return items.length ? items[0]! : null;
}

/** List clauses for a version via GSI1, optionally filtered by category. */
export async function getClausesForVersion(
  versionId: string,
  categories?: string[]
): Promise<RegulatoryClause[]> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: getTableName(REGULATORY_CLAUSES_TABLE),
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :v',
      ExpressionAttributeValues: { ':v': `VERSION#${versionId}` },
    })
  );
  let clauses = (res.Items ?? []) as RegulatoryClause[];
  if (categories && categories.length > 0) {
    const set = new Set(categories);
    clauses = clauses.filter((c) =>
      (c.applicability_categories ?? []).some((cat) => set.has(cat))
    );
  }
  return clauses;
}

/** Validate a single clause has all required fields (Requirement 7.8). */
function validateClause(c: PublishVersionInput['clauses'][number], idx: number): void {
  const missing = (['part_number', 'section', 'clause', 'regulation_text'] as const).find(
    (k) => !c[k as keyof typeof c]
  );
  if (missing) {
    throw new RegulatoryKBError(`clause[${idx}] missing required field '${missing}'`, missing);
  }
  if ((c.regulation_text?.length ?? 0) > MAX_REGULATION_TEXT_CHARS) {
    throw new RegulatoryKBError(
      `clause[${idx}] regulation_text exceeds ${MAX_REGULATION_TEXT_CHARS} chars`,
      'regulation_text'
    );
  }
  if ((c.applicability_categories?.length ?? 0) > MAX_APPLICABILITY_CATEGORIES) {
    throw new RegulatoryKBError(
      `clause[${idx}] has more than ${MAX_APPLICABILITY_CATEGORIES} applicability_categories`,
      'applicability_categories'
    );
  }
}

/**
 * Publish a new regulatory version + its clauses. Rejects if effective_date
 * is not strictly after the current latest version's, or any clause is
 * invalid (Requirement 7.8). Re-syncs the vector KB after success (7.9).
 */
export async function publishRegulatoryVersion(
  input: PublishVersionInput
): Promise<RegulatoryVersion> {
  if (!input.effective_date || !/^\d{4}-\d{2}-\d{2}$/.test(input.effective_date)) {
    throw new RegulatoryKBError('effective_date must be YYYY-MM-DD', 'effective_date');
  }
  if ((input.change_summary?.length ?? 0) > MAX_CHANGE_SUMMARY_CHARS) {
    throw new RegulatoryKBError(
      `change_summary exceeds ${MAX_CHANGE_SUMMARY_CHARS} chars`,
      'change_summary'
    );
  }
  if (!input.clauses?.length) {
    throw new RegulatoryKBError('at least one clause is required', 'clauses');
  }
  input.clauses.forEach(validateClause);

  // Rough size guard (Requirement 7 — 50MB total).
  const approxBytes = Buffer.byteLength(JSON.stringify(input.clauses), 'utf8');
  if (approxBytes > MAX_UPLOAD_BYTES) {
    throw new RegulatoryKBError('clause payload exceeds 50MB', 'clauses');
  }

  // Ordering: effective_date must be strictly after the latest (Requirement 7.8).
  const latest = await getLatestVersion();
  if (latest && input.effective_date <= latest.effective_date) {
    throw new RegulatoryKBError(
      `effective_date ${input.effective_date} must be after the latest version's ${latest.effective_date}`,
      'effective_date'
    );
  }

  const nextSeq = latest ? parseInt(latest.version_id, 10) + 1 : 1;
  const versionId = padVersion(nextSeq);
  const now = new Date().toISOString();

  // Write clauses in batches of 25 (BatchWrite limit).
  const clauseItems = input.clauses.map((c) => ({
    PK: `PART#${c.part_number}`,
    SK: `VERSION#${versionId}#SECTION#${c.section}#CLAUSE#${c.clause}`,
    GSI1PK: `VERSION#${versionId}`,
    GSI1SK: `PART#${c.part_number}#SECTION#${c.section}#CLAUSE#${c.clause}`,
    part_number: c.part_number,
    section: c.section,
    clause: c.clause,
    version_id: versionId,
    effective_date: input.effective_date,
    regulation_text: c.regulation_text,
    applicability_categories: c.applicability_categories ?? [],
    last_updated_at: now,
    published_by: input.published_by,
    change_summary: input.change_summary,
  }));

  const table = getTableName(REGULATORY_CLAUSES_TABLE);
  for (let i = 0; i < clauseItems.length; i += 25) {
    const batch = clauseItems.slice(i, i + 25);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: { [table]: batch.map((Item) => ({ PutRequest: { Item } })) },
      })
    );
  }

  const version: RegulatoryVersion = {
    version_id: versionId,
    effective_date: input.effective_date,
    published_by: input.published_by,
    published_at: now,
    change_summary: input.change_summary,
    clause_count: input.clauses.length,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(REGULATORY_VERSIONS_TABLE),
      Item: { PK: REGULATORY_VERSIONS_PK, SK: `VERSION#${versionId}`, ...version },
    })
  );

  // Re-sync vector KB from the new clause set (Requirement 7.9).
  await triggerKBSync();

  logger.info('Published regulatory version', {
    version_id: versionId,
    clause_count: version.clause_count,
    effective_date: version.effective_date,
  });
  return version;
}

/** List all published versions, newest first. */
export async function listVersions(): Promise<RegulatoryVersion[]> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: getTableName(REGULATORY_VERSIONS_TABLE),
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': REGULATORY_VERSIONS_PK },
      ScanIndexForward: false,
    })
  );
  return (res.Items ?? []) as RegulatoryVersion[];
}

/** Unused import guard for GetCommand (kept for future single-clause reads). */
void GetCommand;
