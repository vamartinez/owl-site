# Design Document: Platform Endpoint Tests

## Overview

This design defines a comprehensive test suite covering all platform API endpoints (excluding AI services: ai-orchestration, detection, scene-understanding, regulatory-mapping). The architecture uses vitest + fast-check, invoking Lambda handlers directly with mocked API Gateway events and mocked AWS SDK clients.

## Architecture

```
packages/backend/
├── src/services/{service}/__tests__/     ← Unit tests (per-module isolation)
├── tests/
│   ├── e2e/                              ← E2E handler tests (full handler path)
│   ├── properties/                       ← Property-based tests (fast-check)
│   └── helpers/                          ← Shared mock factories and fixtures
└── vitest.config.ts
```

### Test Layers

| Layer | Purpose | Location | Dependencies Mocked |
|-------|---------|----------|-------------------|
| Unit | Single module verification | `src/services/{service}/__tests__/` | All (DynamoDB, S3, SNS, auth) |
| E2E | Full handler path through routing + auth + validation + business logic | `tests/e2e/` | AWS SDK only (auth exercised via JWT decode path) |
| Property | Universal invariants across generated inputs | `tests/properties/` | AWS SDK only |

### Handler Invocation Pattern

E2E tests invoke handlers directly (no HTTP server, no deployed API):

```typescript
import { handler } from '../../src/services/identity/handler.js';

const event = createMockEvent({
  httpMethod: 'POST',
  resource: '/workers',
  body: { legal_name: 'Jane Doe', phone: '+14155551234', language_preference: 'en' },
  claims: { sub: 'user-1', 'custom:role': 'tenant_admin', 'custom:tenant_id': 'tenant-1' },
});

const response = await handler(event);
expect(response.statusCode).toBe(201);
```

## Components and Interfaces

### 1. Mock Event Factory (`tests/helpers/mock-event.ts`)

Generates valid `APIGatewayProxyEvent`-shaped objects:

```typescript
interface MockEventOptions {
  httpMethod: string;
  resource: string;
  path?: string;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  claims?: Record<string, string | string[]>;  // Cognito authorizer claims
  noAuth?: boolean;  // Omit Authorization header and claims
}

function createMockEvent(options: MockEventOptions): APIGatewayProxyEvent;
```

When `claims` is provided, the factory populates `requestContext.authorizer.claims` (simulating Cognito authorizer). When `noAuth` is true, no Authorization header or claims are included, causing the auth middleware to return 401.

### 2. Authenticated User Factory (`tests/helpers/mock-user.ts`)

Generates user claim objects:

```typescript
interface MockUserOptions {
  user_id?: string;
  tenant_id?: string;
  role?: string;
  email?: string;
  assigned_sites?: string[];
}

function createMockClaims(options?: MockUserOptions): Record<string, string>;
```

Default values produce a `tenant_admin` user for `tenant-test`.

### 3. DynamoDB Mock (`tests/helpers/mock-dynamo.ts`)

Records invocations and returns configurable responses:

```typescript
interface DynamoMockConfig {
  getResponses?: Map<string, Record<string, unknown>>;
  queryResponses?: Map<string, Record<string, unknown>[]>;
  putCapture?: Array<Record<string, unknown>>;
  updateCapture?: Array<Record<string, unknown>>;
  deleteCapture?: Array<Record<string, unknown>>;
}

function setupDynamoMock(config?: DynamoMockConfig): void;
function getDynamoCalls(): { command: string; input: unknown }[];
function resetDynamoMock(): void;
```

Uses `vi.mock('@aws-sdk/lib-dynamodb')` to intercept all DynamoDB DocumentClient commands.

### 4. S3 Mock (`tests/helpers/mock-s3.ts`)

```typescript
function setupS3Mock(options?: { presignedUrl?: string }): void;
function getS3Calls(): { command: string; input: unknown }[];
```

Mocks `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.

### 5. Auth Middleware Mock (`tests/helpers/mock-auth.ts`)

For unit tests that need to bypass or control auth:

```typescript
function mockAuthSuccess(user?: Partial<AuthenticatedUser>): void;
function mockAuthFailure(): void;
function resetAuthMock(): void;
```

### API Gateway Response Shape

All handlers return:

```typescript
interface ApiGatewayResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;  // JSON-serialized
}
```

Success responses: `{ ...payload }` (varies per endpoint)
Error responses: `{ code: string; message: string; request_id: string; timestamp: string; details?: Record<string, unknown> }`

### Role Hierarchy for RBAC Testing

```
platform_admin > tenant_admin > site_admin > supervisor/cso > gate_operator > worker
```

Permissions are defined in `src/shared/rbac.ts` via the `PERMISSION_MATRIX`.

## Data Models

### Mock Event Structure

```typescript
{
  httpMethod: string;
  resource: string;           // e.g., '/workers/{id}'
  path: string;               // e.g., '/workers/abc-123'
  pathParameters: Record<string, string> | null;
  queryStringParameters: Record<string, string> | null;
  headers: Record<string, string>;
  body: string | null;        // JSON-serialized
  requestContext: {
    requestId: string;
    authorizer?: {
      claims?: Record<string, string>;
    };
  };
}
```

### Test Data Generators (fast-check arbitraries)

```typescript
// Valid worker payload
const arbValidWorker: fc.Arbitrary<WorkerPayload>;

// Arbitrary subset of updatable fields
const arbUpdateFields: fc.Arbitrary<Partial<WorkerUpdate>>;

// Arbitrary role (both valid and invalid)
const arbRole: fc.Arbitrary<string>;

// Arbitrary valid role from defined set
const arbValidRole: fc.Arbitrary<Role>;

// Arbitrary tenant ID
const arbTenantId: fc.Arbitrary<string>;

// Arbitrary UUID
const arbUuid: fc.Arbitrary<string>;

// Arbitrary API path (valid and invalid)
const arbApiPath: fc.Arbitrary<string>;

// Arbitrary HTTP method
const arbHttpMethod: fc.Arbitrary<string>;
```

## Error Handling

### Error Response Codes by Category

| Scenario | Status | Code |
|----------|--------|------|
| Missing/invalid auth header | 401 | UNAUTHORIZED |
| Insufficient role permissions | 403 | FORBIDDEN |
| Resource not found | 404 | NOT_FOUND |
| Validation failure | 400 | BAD_REQUEST |
| Unsupported route | 400 | BAD_REQUEST |
| Invalid state transition | 422 | UNPROCESSABLE_ENTITY |
| Conflict (duplicate, max attempts) | 409 | CONFLICT |
| Internal error | 500 | INTERNAL_ERROR |

### Testing Error Paths

Each E2E test suite includes negative tests for:
1. Missing authentication → 401
2. Insufficient role → 403
3. Invalid body → 400
4. Non-existent resource → 404
5. Unsupported route → 400

## Testing Strategy

### Unit Tests

Unit tests are placed in `src/services/{service}/__tests__/` and test individual modules in complete isolation:
- All AWS SDK calls mocked via `vi.mock`
- Auth middleware mocked to return a configured user
- Focus on: DynamoDB command construction, response mapping, validation logic, business rules

### E2E Tests

E2E tests are placed in `tests/e2e/` and test the full handler path:
- Handler invoked directly with mock API Gateway events (no HTTP server)
- AWS SDK mocked at the module level (DynamoDB, S3, SNS, SQS)
- Auth exercised via Cognito authorizer claims in `requestContext.authorizer.claims`
- Verifies: routing, auth enforcement, request validation, response shapes, error codes

### Property-Based Tests

Property tests are placed in `tests/properties/` and verify universal invariants:
- Uses fast-check for arbitrary input generation
- Minimum 100 iterations per property
- AWS SDK mocked
- Focus on: validation robustness, RBAC correctness, tenant isolation, handler crash safety

### Test Execution

```bash
# Run all tests
npm run test

# Run only property tests
npm run test:properties

# Run specific service E2E
npx vitest run tests/e2e/identity-service.e2e.test.ts
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Partial update only writes specified fields

*For any* valid subset of updatable fields provided to a worker or certification update operation, the resulting DynamoDB UpdateExpression SHALL contain only the specified fields and no others.

**Validates: Requirements 1.3, 1.5**

### Property 2: Resource creation invariants

*For any* valid creation request (worker, site, certification, form, incident, access token, scan session, override), the persisted record SHALL always contain: a generated UUID identifier, a `created_at` timestamp, and a partition key prefixed with the requesting tenant's ID.

**Validates: Requirements 1.4, 3.1, 5.1, 5.2, 5.3, 5.6, 7.1, 7.5, 9.1**

### Property 3: Input validation rejects malformed requests

*For any* request body that violates schema constraints (missing required fields, wrong types, empty required strings, values outside allowed ranges), the handler SHALL return a 400 response with code `BAD_REQUEST` and descriptive error details without throwing an unhandled exception.

**Validates: Requirements 1.6, 9.5, 17.1, 17.2, 17.3**

### Property 4: Missing authentication returns 401

*For any* endpoint that requires authentication (all except /leads and /public/*), a request without a valid Authorization header or Cognito authorizer claims SHALL receive a 401 response with code `UNAUTHORIZED`.

**Validates: Requirements 2.10, 6.9, 12.4, 16.4**

### Property 5: Policy version auto-increment

*For any* policy with N existing versions, creating a new version SHALL produce a version record with version_number equal to N + 1.

**Validates: Requirements 3.3**

### Property 6: Effective-policies aggregation correctness

*For any* site with a set of assigned policies having mixed statuses (active, draft, archived), the effective-policies endpoint SHALL return only those policies with status `active` that are assigned to the requested site.

**Validates: Requirements 3.4**

### Property 7: Policy creation always produces a draft version

*For any* valid policy creation request, the system SHALL persist both a policy record and an accompanying version record with status `draft`.

**Validates: Requirements 3.2**

### Property 8: Incident state machine valid transitions only

*For any* incident in a given state, only transitions defined in the state machine SHALL succeed. All invalid transitions SHALL be rejected with a 422 response.

**Validates: Requirements 9.2, 10.5, 10.6**

### Property 9: Regulatory engine flagging

*For any* incident matching regulatory reporting criteria (fatality, hospitalization, dangerous occurrence), the regulatory engine SHALL flag the incident with the appropriate regulatory classification and deadline.

**Validates: Requirements 9.3**

### Property 10: Timeline chronological ordering

*For any* sequence of timeline events appended to an incident, the sort keys SHALL maintain strictly ascending chronological order.

**Validates: Requirements 9.4**

### Property 11: Form publish creates version and public token

*For any* form in DRAFT or DESPUBLICADO state that is published, the system SHALL create a version record with incremented version number AND generate a public access token.

**Validates: Requirements 7.2**

### Property 12: Form duplication preserves fields with new identity

*For any* duplicated form, the resulting form SHALL contain all field definitions from the original but have a distinct form ID, a fresh `created_at` timestamp, and status `DRAFT`.

**Validates: Requirements 7.4**

### Property 13: Sanitizer detects bot-like submissions

*For any* form submission exhibiting bot-like characteristics (empty User-Agent, honeypot field filled, sub-second completion time), the sanitizer SHALL flag the submission as suspicious.

**Validates: Requirements 7.7**

### Property 14: CSV export round-trip correctness

*For any* non-empty set of form responses, the exported CSV SHALL contain one header row matching the form's field definitions and one data row per response with values matching the stored answers.

**Validates: Requirements 7.8**

### Property 15: Audit entry completeness

*For any* auditable action (form CRUD, document access, incident changes), the persisted audit log entry SHALL contain: actor (user_id), action type, entity reference (entity ID), and ISO-8601 timestamp.

**Validates: Requirements 7.9, 14.8**

### Property 16: Document search results match query

*For any* search query executed against the document service, all returned results SHALL contain at least one match for the query terms in name or metadata fields.

**Validates: Requirements 14.2**

### Property 17: Document metadata completeness

*For any* document record returned by the metadata handler, the response SHALL include all required fields: id, name, type, size, created_at, and updated_at.

**Validates: Requirements 14.3**

### Property 18: Preferences round-trip

*For any* valid organization-mode preference value written via PUT, a subsequent GET for the same user SHALL return the same preference value.

**Validates: Requirements 14.7**

### Property 19: Tenant isolation guarantee

*For any* resource belonging to tenant-A, a request authenticated as tenant-B SHALL either receive a 404 (not found) or a 403 (forbidden) response, never the resource data. Additionally, listing resources as tenant-A SHALL return only tenant-A's records.

**Validates: Requirements 18.1, 18.2, 18.3**

### Property 20: Unsupported routes return consistent error

*For any* combination of HTTP method and path not defined in a handler's routing logic, the handler SHALL return a 400 response with message containing "Unsupported route".

**Validates: Requirements 19.1, 19.2**

### Property 21: Handler robustness under arbitrary input

*For any* arbitrary request body (random strings, nested objects, arrays, nulls) and arbitrary path parameter values, handlers SHALL never throw an unhandled exception and SHALL always return a well-formed `ApiGatewayResponse` object with a valid statusCode (100-599), headers object, and JSON-parseable body string.

**Validates: Requirements 21.1, 21.2**

### Property 22: RBAC correctness for defined roles only

*For any* arbitrary string used as a role value, only the 7 defined roles (platform_admin, tenant_admin, site_admin, supervisor, cso, gate_operator, worker) SHALL pass RBAC permission checks. All other values SHALL result in permission denial.

**Validates: Requirements 21.3**

### Property 23: Non-existent resource returns 404

*For any* GET or PATCH request targeting a resource ID that does not exist in the data store, the handler SHALL return a 404 response with code `NOT_FOUND`.

**Validates: Requirements 17.4**
