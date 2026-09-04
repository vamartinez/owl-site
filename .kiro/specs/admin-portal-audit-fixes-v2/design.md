# Design — Admin Portal Audit Fixes V2

## Overview

This design addresses three residual issues from the original `admin-portal-audit-fixes` spec, as identified during independent verification:

1. **Report Validation 403** — The `report-validation` Lambda handler exists but has no CDK declaration or API Gateway resource tree. API Gateway returns 403 ("Missing Authentication Token") before any Lambda code executes.
2. **Contractors Total Count** — `listContractors` returns only `{ contractors, nextCursor }` with no `total`. The frontend fallback `data?.total || data?.contractors?.length` works only while tenants have < 1 page of contractors.
3. **Site Profile Detail bare `%`** — The Sites list page was fixed to show "N/A", but the Site Profile detail page (`SiteProfile.tsx:98`) still renders `{data.compliancePercent}%` without null guard.

## Architecture

### Fix 1: Report Validation Lambda + API Gateway Resources

Add to `packages/backend/infra/lib/api-stack.ts`:

1. **Lambda function declaration** for `report-validation` service:
   - Same pattern as other services (runtime, architecture, tracing, logRetention, sharedEnv)
   - Code from `dist/services/report-validation`
   - 512 MB memory (needs Bedrock/S3 for validation)
   - 29s timeout (API-facing)
   - Same concurrency as other API Lambdas

2. **IAM permissions**:
   - DynamoDB read/write to all tables (same pattern as other services)
   - S3 read/write to media bucket (upload-manager needs signed URLs)
   - Bedrock InvokeModel (for validation-engine AI scoring)
   - Add to `allFunctions` array so it inherits SNS publish and table grants

3. **API Gateway resource tree**:
   ```
   /report-validation
     /reports
       GET  → reportValidationIntegration (authorized)
       POST → reportValidationIntegration (authorized)
       /{id}
         GET  → reportValidationIntegration (authorized)
         /validate
           POST → reportValidationIntegration (authorized)
         /versions
           POST → reportValidationIntegration (authorized)
         /submit
           POST → reportValidationIntegration (authorized)
         /history
           GET  → reportValidationIntegration (authorized)
     /kb
       /documents
         GET    → reportValidationIntegration (authorized)
         POST   → reportValidationIntegration (authorized)
         /{id}
           DELETE → reportValidationIntegration (authorized)
   ```

4. **Wildcard invoke permission**: Already granted by the existing `for (const fn of allFunctions)` loop — just add the new function to `allFunctions`.

### Fix 2: Contractors Total Count

In `packages/backend/src/services/contractors/contractor.ts`, add a second `QueryCommand` with `Select: 'COUNT'` (no `Limit`) to compute the real total:

```typescript
export async function listContractors(
  tenantId: string,
  limit = 20,
  cursor?: string
): Promise<{ contractors: Contractor[]; total: number; nextCursor?: string }> {
  // Existing paginated query (unchanged)
  const result = await docClient.send(new QueryCommand({ ... }));

  // New: total count query (no Limit, Select: COUNT)
  const countResult = await docClient.send(
    new QueryCommand({
      TableName: getTableName(CONTRACTORS_TABLE),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':prefix': 'CONTRACTOR#',
      },
      Select: 'COUNT',
    })
  );

  return {
    contractors,
    total: countResult.Count ?? contractors.length,
    nextCursor,
  };
}
```

The frontend code `data?.total || data?.contractors?.length || 0` already prefers `total` when available — no frontend changes needed.

### Fix 3: Site Profile Detail Page

In `packages/admin-portal/src/pages/sites/SiteProfile.tsx`, add null guards for stat cards:

```typescript
// Line ~98: compliancePercent
<p className="text-xl font-bold text-gray-900">
  {data.compliancePercent != null ? `${data.compliancePercent}%` : 'N/A'}
</p>

// activeWorkers
<p className="text-xl font-bold text-gray-900">
  {data.activeWorkers ?? 'N/A'}
</p>

// contractor
<p className="text-xl font-bold text-gray-900">
  {data.contractor || 'N/A'}
</p>
```

## Testing Strategy

1. **CDK Synth**: Run `npx cdk synth` to verify the stack synthesizes without errors after adding the report-validation Lambda
2. **TypeScript Build**: Verify both admin-portal and backend compile without errors
3. **Unit Test**: Verify `listContractors` returns `total` field
4. **Visual Check**: Verify SiteProfile renders "N/A" for undefined compliancePercent

## Risks & Mitigations

- **CloudFormation 500-resource limit**: Adding ~15 new API Gateway resources. Current stack is close to limit (Document Service was already moved to a NestedStack). If limit is hit, report-validation can be moved to its own NestedStack following the same pattern as `DocumentServiceNestedStack`.
- **Bedrock permissions**: The report-validation handler uses Bedrock for AI scoring. May need `bedrock:InvokeModel` IAM permission added explicitly.
- **Concurrent DynamoDB query for total**: The `Select: 'COUNT'` query runs in parallel with the paginated query. For large tenants (>10k contractors), consider caching or using an atomic counter. For current scale, this is acceptable.
