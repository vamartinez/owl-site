# Implementation Plan

## Overview

Three residual fixes from the admin-portal-audit-fixes verification: (1) wire report-validation Lambda into CDK/API Gateway, (2) add total count to contractors backend, (3) fix bare % on Site Profile detail page.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2", "3"] },
    { "id": 1, "tasks": ["4"] }
  ]
}
```

- Wave 0: All three fixes are independent and can run in parallel
- Wave 1: Verification runs after all fixes complete

## Tasks

### Fix 1: Report Validation Lambda + API Gateway

- [x] 1. Add report-validation Lambda and API Gateway resources to api-stack.ts
  - [x] 1.1 Add Lambda function declaration for report-validation service
    - Open `packages/backend/infra/lib/api-stack.ts`
    - Add a new Lambda function `reportValidationFn` after the existing function declarations (after `this.incidentServiceFn`)
    - Use this configuration:
      - `functionName`: `${prefix}report-validation`
      - `description`: 'Report Validation Service — upload, validate, submit reports and KB management'
      - `handler`: 'handler.handler'
      - `code`: lambda.Code.fromAsset('dist/services/report-validation')
      - `memorySize`: 512
      - `timeout`: cdk.Duration.seconds(29)
      - `environment`: sharedEnv
      - `reservedConcurrentExecutions`: concurrency.api
    - Same runtime, architecture, tracing, logRetention as other functions
    - Add to the `allFunctions` array so it inherits DynamoDB grants, SNS publish, and API Gateway invoke permission
    - Add S3 read/write grant: `props.mediaBucket.grantReadWrite(this.reportValidationFn)`
    - Add Bedrock InvokeModel permission via IAM policy statement (for AI validation scoring):
      ```
      this.reportValidationFn.addToRolePolicy(
        new cdk.aws_iam.PolicyStatement({
          actions: ['bedrock:InvokeModel'],
          resources: ['*'],
        })
      );
      ```
    - _Requirements: 1.2, 1.3_

  - [x] 1.2 Add API Gateway resource tree for /report-validation
    - Create a `LambdaIntegration` for `reportValidationFn`: `const reportValidationIntegration = new apigateway.LambdaIntegration(this.reportValidationFn, { allowTestInvoke: false });`
    - Add the resource tree with authorized methods:
      ```
      const reportValidation = this.api.root.addResource('report-validation');
      const rvReports = reportValidation.addResource('reports');
      rvReports.addMethod('GET', reportValidationIntegration, authorizedMethodOptions);
      rvReports.addMethod('POST', reportValidationIntegration, authorizedMethodOptions);
      const rvReportId = rvReports.addResource('{id}');
      rvReportId.addMethod('GET', reportValidationIntegration, authorizedMethodOptions);
      const rvValidate = rvReportId.addResource('validate');
      rvValidate.addMethod('POST', reportValidationIntegration, authorizedMethodOptions);
      const rvVersions = rvReportId.addResource('versions');
      rvVersions.addMethod('POST', reportValidationIntegration, authorizedMethodOptions);
      const rvSubmit = rvReportId.addResource('submit');
      rvSubmit.addMethod('POST', reportValidationIntegration, authorizedMethodOptions);
      const rvHistory = rvReportId.addResource('history');
      rvHistory.addMethod('GET', reportValidationIntegration, authorizedMethodOptions);
      const rvKb = reportValidation.addResource('kb');
      const rvKbDocs = rvKb.addResource('documents');
      rvKbDocs.addMethod('GET', reportValidationIntegration, authorizedMethodOptions);
      rvKbDocs.addMethod('POST', reportValidationIntegration, authorizedMethodOptions);
      const rvKbDocId = rvKbDocs.addResource('{id}');
      rvKbDocId.addMethod('DELETE', reportValidationIntegration, authorizedMethodOptions);
      ```
    - Place this section after the existing "API Routes: Reports" section
    - _Requirements: 1.1, 1.2_

  - [x] 1.3 Declare reportValidationFn as a class property on ApiStack
    - Add `public readonly reportValidationFn: lambda.Function;` to the class properties at the top of `ApiStack`
    - This follows the same pattern as other Lambda function properties (e.g., `this.decisionEngineFn`, `this.policyServiceFn`)
    - _Requirements: 1.2_

### Fix 2: Contractors Total Count

- [x] 2. Add total count to listContractors backend response
  - [x] 2.1 Add SELECT COUNT query to listContractors
    - Open `packages/backend/src/services/contractors/contractor.ts`
    - In the `listContractors` function, add a second `QueryCommand` with `Select: 'COUNT'` (no `Limit`) against the same partition key `TENANT#${tenantId}` and SK prefix `CONTRACTOR#`
    - Run both queries (paginated + count) concurrently using `Promise.all` for better performance
    - Return `{ contractors, total: countResult.Count ?? contractors.length, nextCursor }`
    - Update the return type to `Promise<{ contractors: Contractor[]; total: number; nextCursor?: string }>`
    - _Requirements: 2.1, 2.2, 4.2_

### Fix 3: Site Profile Detail Page

- [x] 3. Fix bare % and undefined display on SiteProfile detail page
  - [x] 3.1 Add null guards for compliancePercent, activeWorkers, and contractor stat cards
    - Open `packages/admin-portal/src/pages/sites/SiteProfile.tsx`
    - At line ~98, replace `{data.compliancePercent}%` with:
      `{data.compliancePercent != null ? `${data.compliancePercent}%` : 'N/A'}`
    - For `activeWorkers` stat card, add null guard: `{data.activeWorkers ?? 'N/A'}`
    - For `contractor` stat card, add null guard: `{data.contractor || 'N/A'}`
    - Update the `SiteDetail` interface to mark these fields as optional: `compliancePercent?: number; activeWorkers?: number; contractor?: string;`
    - _Requirements: 3.1, 3.2, 3.3, 4.3_

### Verification

- [x] 4. Verify all fixes compile and pass checks
  - [x] 4.1 Run TypeScript compilation for backend
    - Run `pnpm --filter backend tsc --noEmit` (or equivalent)
    - Verify no type errors introduced by the changes
    - _Requirements: 4.1_
  - [x] 4.2 Run TypeScript compilation for admin-portal
    - Run `pnpm --filter admin-portal tsc --noEmit` (or equivalent build check)
    - Verify SiteProfile and ContractorList compile without errors
    - _Requirements: 4.3_
  - [x] 4.3 Verify CDK synth succeeds (if cdk is available)
    - Run `npx cdk synth --quiet` in the backend/infra directory (or skip if CDK not installed locally)
    - Alternatively verify the api-stack.ts has no TypeScript errors
    - _Requirements: 1.2, 4.1_

## Notes

- The report-validation service already has a handler.ts that handles routing internally — no changes to that handler are needed
- After code changes, an actual `cdk deploy` is needed to apply API Gateway changes to the live environment
- The CloudFormation 500-resource limit may be a concern — if hit, consider moving report-validation to its own NestedStack
- The contractors `total` count uses a separate COUNT query which is cheap on DynamoDB (consumed RCU = 1 regardless of item count)
