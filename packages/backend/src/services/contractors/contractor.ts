/**
 * Contractor business logic: CRUD, worker assignment/removal, compliance status calculation.
 *
 * Requirements: 17.4
 */

import { v4 as uuidv4 } from 'uuid';
import { PutCommand, GetCommand, QueryCommand, DeleteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, getTableName } from '../../shared/dynamo-client.js';
import { CertificationStatus } from '../../shared/types/common.js';
import type {
  Contractor,
  ContractorWorker,
  ContractorComplianceStatus,
  CreateContractorRequest,
  UpdateContractorRequest,
} from './types.js';
import { ContractorStatus } from './types.js';

const CONTRACTORS_TABLE = 'Contractors';
const CONTRACTOR_WORKERS_TABLE = 'ContractorWorkers';
const CERTIFICATIONS_TABLE = 'Certifications';
const WORKERS_TABLE = 'Workers';

/**
 * Creates a new contractor.
 */
export async function createContractor(
  tenantId: string,
  input: CreateContractorRequest,
  createdBy: string
): Promise<Contractor> {
  const now = new Date().toISOString();
  const contractorId = uuidv4();

  const contractor: Contractor = {
    contractor_id: contractorId,
    tenant_id: tenantId,
    company_name: input.company_name,
    contact_name: input.contact_name,
    contact_email: input.contact_email,
    contact_phone: input.contact_phone,
    license_number: input.license_number,
    status: ContractorStatus.ACTIVE,
    created_at: now,
    updated_at: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(CONTRACTORS_TABLE),
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `CONTRACTOR#${contractorId}`,
        GSI1PK: `TENANT#${tenantId}`,
        GSI1SK: `STATUS#${ContractorStatus.ACTIVE}#${now}`,
        ...contractor,
      },
    })
  );

  return contractor;
}

/**
 * Gets a contractor by ID.
 */
export async function getContractor(
  tenantId: string,
  contractorId: string
): Promise<Contractor | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: getTableName(CONTRACTORS_TABLE),
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `CONTRACTOR#${contractorId}`,
      },
    })
  );

  return (result.Item as Contractor) ?? null;
}

/**
 * A contractor list row enriched with the join columns the Contractors list
 * page renders: phone, worker count, and compliance percentage.
 */
export type ContractorListRow = Contractor & {
  total_workers: number;
  compliance_percent: number;
};

/**
 * Lists contractors for a tenant.
 *
 * Each returned row is enriched with `total_workers` and `compliance_percent`
 * (computed from the contractor's assigned workers' certification states) so
 * the Contractors list page's Workers/Compliance columns show real joined
 * values rather than blank cells. `contact_phone` is already stored on the
 * record and is returned as-is.
 *
 * `total` is derived from a separate `Select: 'COUNT'` query so the list
 * header count stays accurate across pages, not just the current page.
 */
export async function listContractors(
  tenantId: string,
  limit = 20,
  cursor?: string
): Promise<{ contractors: ContractorListRow[]; total: number; nextCursor?: string }> {
  const [result, countResult] = await Promise.all([
    docClient.send(
      new QueryCommand({
        TableName: getTableName(CONTRACTORS_TABLE),
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: {
          '#pk': 'PK',
          '#sk': 'SK',
        },
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':prefix': 'CONTRACTOR#',
        },
        Limit: limit,
        ExclusiveStartKey: cursor ? JSON.parse(Buffer.from(cursor, 'base64').toString()) : undefined,
      })
    ),
    docClient.send(
      new QueryCommand({
        TableName: getTableName(CONTRACTORS_TABLE),
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: {
          '#pk': 'PK',
          '#sk': 'SK',
        },
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}`,
          ':prefix': 'CONTRACTOR#',
        },
        Select: 'COUNT',
      })
    ),
  ]);

  const rawContractors = (result.Items ?? []) as Contractor[];

  // Enrich each row with worker-count + compliance percentage. calculateComplianceStatus
  // already computes both from the contractor's assigned workers' certifications, so we
  // reuse it rather than re-querying the join tables here.
  const contractors: ContractorListRow[] = await Promise.all(
    rawContractors.map(async (contractor) => {
      const compliance = await calculateComplianceStatus(tenantId, contractor.contractor_id);
      return {
        ...contractor,
        total_workers: compliance.total_workers,
        compliance_percent: compliance.compliance_percentage,
      };
    })
  );

  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return { contractors, total: countResult.Count ?? contractors.length, nextCursor };
}

/**
 * Updates a contractor.
 */
export async function updateContractor(
  tenantId: string,
  contractorId: string,
  input: UpdateContractorRequest
): Promise<Contractor | null> {
  const existing = await getContractor(tenantId, contractorId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updated: Contractor = {
    ...existing,
    ...Object.fromEntries(Object.entries(input).filter(([_, v]) => v !== undefined)),
    updated_at: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(CONTRACTORS_TABLE),
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `CONTRACTOR#${contractorId}`,
        GSI1PK: `TENANT#${tenantId}`,
        GSI1SK: `STATUS#${updated.status}#${updated.created_at}`,
        ...updated,
      },
    })
  );

  return updated;
}

/**
 * Assigns a worker to a contractor.
 */
export async function assignWorker(
  tenantId: string,
  contractorId: string,
  workerId: string,
  assignedBy: string
): Promise<ContractorWorker> {
  const now = new Date().toISOString();

  const assignment: ContractorWorker = {
    contractor_id: contractorId,
    worker_id: workerId,
    tenant_id: tenantId,
    assigned_at: now,
    assigned_by: assignedBy,
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(CONTRACTOR_WORKERS_TABLE),
      Item: {
        PK: `TENANT#${tenantId}#CONTRACTOR#${contractorId}`,
        SK: `WORKER#${workerId}`,
        GSI1PK: `TENANT#${tenantId}#WORKER#${workerId}`,
        GSI1SK: `CONTRACTOR#${contractorId}`,
        ...assignment,
      },
    })
  );

  return assignment;
}

/**
 * Removes a worker from a contractor.
 */
export async function removeWorker(
  tenantId: string,
  contractorId: string,
  workerId: string
): Promise<boolean> {
  try {
    await docClient.send(
      new DeleteCommand({
        TableName: getTableName(CONTRACTOR_WORKERS_TABLE),
        Key: {
          PK: `TENANT#${tenantId}#CONTRACTOR#${contractorId}`,
          SK: `WORKER#${workerId}`,
        },
        ConditionExpression: 'attribute_exists(PK)',
      })
    );
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw error;
  }
}

/**
 * Lists workers assigned to a contractor.
 */
export async function listContractorWorkers(
  tenantId: string,
  contractorId: string,
  limit = 50,
  cursor?: string
): Promise<{ workers: ContractorWorker[]; nextCursor?: string }> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: getTableName(CONTRACTOR_WORKERS_TABLE),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: {
        '#pk': 'PK',
        '#sk': 'SK',
      },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}#CONTRACTOR#${contractorId}`,
        ':prefix': 'WORKER#',
      },
      Limit: limit,
      ExclusiveStartKey: cursor ? JSON.parse(Buffer.from(cursor, 'base64').toString()) : undefined,
    })
  );

  const workers = (result.Items ?? []) as ContractorWorker[];
  const nextCursor = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return { workers, nextCursor };
}

/**
 * Calculates compliance status for a contractor based on their workers' certifications.
 */
export async function calculateComplianceStatus(
  tenantId: string,
  contractorId: string
): Promise<ContractorComplianceStatus> {
  // Get all workers for this contractor
  const { workers } = await listContractorWorkers(tenantId, contractorId, 1000);

  let compliantWorkers = 0;
  let nonCompliantWorkers = 0;
  let expiredCertifications = 0;

  for (const worker of workers) {
    // Query certifications for each worker
    const certResult = await docClient.send(
      new QueryCommand({
        TableName: getTableName(CERTIFICATIONS_TABLE),
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: {
          '#pk': 'PK',
          '#sk': 'SK',
        },
        ExpressionAttributeValues: {
          ':pk': `WORKER#${worker.worker_id}`,
          ':prefix': 'CERT#',
        },
      })
    );

    const certs = certResult.Items ?? [];
    const hasExpired = certs.some(
      (c) => (c as Record<string, unknown>)['validation_status'] === CertificationStatus.EXPIRED
    );
    const allValid = certs.length > 0 && certs.every(
      (c) => (c as Record<string, unknown>)['validation_status'] === CertificationStatus.VALIDATED
    );

    if (hasExpired) {
      nonCompliantWorkers++;
      expiredCertifications += certs.filter(
        (c) => (c as Record<string, unknown>)['validation_status'] === CertificationStatus.EXPIRED
      ).length;
    } else if (allValid) {
      compliantWorkers++;
    } else {
      nonCompliantWorkers++;
    }
  }

  const totalWorkers = workers.length;
  const compliancePercentage = totalWorkers > 0
    ? Math.round((compliantWorkers / totalWorkers) * 100)
    : 100;

  return {
    contractor_id: contractorId,
    tenant_id: tenantId,
    total_workers: totalWorkers,
    compliant_workers: compliantWorkers,
    non_compliant_workers: nonCompliantWorkers,
    expired_certifications: expiredCertifications,
    compliance_percentage: compliancePercentage,
    last_calculated_at: new Date().toISOString(),
  };
}
