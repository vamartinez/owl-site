# API Routes → Lambda Mapping

## Overview

All API routes are defined in `packages/backend/infra/lib/api-stack.ts` and deployed via CDK.

Base URL: `https://{api-id}.execute-api.{region}.amazonaws.com/{stage}`

## Lambda Functions

| Lambda Name | Function | Handler Path |
|-------------|----------|--------------|
| `{prefix}policy-service` | Policy CRUD, version management | `src/services/policy/handler.ts` |
| `{prefix}identity-service` | Worker profiles, certifications | `src/services/identity/handler.ts` |
| `{prefix}access-service` | Token management, scan sessions | `src/services/access/handler.ts` |
| `{prefix}decision-engine` | Compliance decision evaluation | `src/services/decision-engine/handler.ts` |
| `{prefix}ai-orchestration` | Inspection, media, AI pipeline | `src/services/ai-orchestration/handler.ts` |
| `{prefix}detection-layer` | Object detection (Bedrock) | `src/services/detection/handler.ts` |
| `{prefix}scene-understanding` | Scene classification (Bedrock) | `src/services/scene-understanding/handler.ts` |
| `{prefix}regulatory-mapping` | Regulatory mapping (Bedrock) | `src/services/regulatory-mapping/handler.ts` |
| `{prefix}reporting-service` | Reports, daily summaries | `src/services/reporting/handler.ts` |
| `{prefix}notification-service` | Email (SES), SMS (SNS) | `src/services/notification/handler.ts` |
| `{prefix}sync-service` | Offline sync reconciliation | `src/services/sync/handler.ts` |

Where `{prefix}` = `dev-` for dev environment, empty for prod.

## Route → Lambda Mapping

### Workers (Identity Service Lambda)

| Method | Path | Auth |
|--------|------|------|
| POST | `/workers` | Cognito |
| GET | `/workers` | Cognito |
| GET | `/workers/{id}` | Cognito |
| PATCH | `/workers/{id}` | Cognito |
| GET | `/workers/{id}/status` | Cognito |
| POST | `/workers/{id}/certifications` | Cognito |
| GET | `/workers/{id}/certifications` | Cognito |
| PATCH | `/workers/{id}/certifications/{certId}` | Cognito |
| GET | `/workers/{id}/compliance-summary` | Cognito (→ Reporting Service) |

### Sites (Policy Service Lambda) ⚠️

| Method | Path | Auth | Note |
|--------|------|------|------|
| POST | `/sites` | Cognito | **Handler must support this route** |
| GET | `/sites` | Cognito | **Handler must support this route** |
| GET | `/sites/{id}` | Cognito | **Handler must support this route** |
| PATCH | `/sites/{id}` | Cognito | **Handler must support this route** |
| GET | `/sites/{id}/effective-policies` | Cognito | |
| GET | `/sites/{id}/daily-summary` | Cognito (→ Reporting Service) | |

> ⚠️ **Known Issue**: The Policy Service handler (`policy/handler.ts`) currently only handles `/policies` routes. The `/sites` routes are mapped to this Lambda but the handler returns "Unsupported route" for them. A Sites handler needs to be added.

### Policies (Policy Service Lambda)

| Method | Path | Auth |
|--------|------|------|
| POST | `/policies` | Cognito |
| GET | `/policies` | Cognito |
| GET | `/policies/{id}` | Cognito |
| POST | `/policies/{id}/versions` | Cognito |
| GET | `/policies/{id}/versions` | Cognito |
| GET | `/policies/{id}/versions/{versionId}` | Cognito |

### Access (Access Service Lambda)

| Method | Path | Auth |
|--------|------|------|
| POST | `/access/request` | Cognito |
| POST | `/access/scan` | Cognito |
| GET | `/access/decisions/{id}` | Cognito |
| POST | `/access/tokens` | Cognito |
| DELETE | `/access/tokens/{id}` | Cognito |
| POST | `/access/revalidate` | Cognito |
| POST | `/access/override` | Cognito |
| PATCH | `/access/override/{id}` | Cognito |

### Inspections (AI Orchestration Lambda)

| Method | Path | Auth |
|--------|------|------|
| POST | `/inspections` | Cognito |
| POST | `/inspections/{id}/media` | Cognito |
| POST | `/inspections/{id}/analyze` | Cognito |

### Findings (AI Orchestration Lambda)

| Method | Path | Auth |
|--------|------|------|
| GET | `/findings` | Cognito |
| GET | `/findings/{id}` | Cognito |
| POST | `/findings/{id}/review` | Cognito |

### Reports (Reporting Service Lambda)

| Method | Path | Auth |
|--------|------|------|
| POST | `/reports` | Cognito |
| GET | `/reports/{id}` | Cognito |
| GET | `/reports/{id}/export` | Cognito |

### Contractors (Identity Service Lambda)

| Method | Path | Auth |
|--------|------|------|
| POST | `/contractors` | Cognito |
| GET | `/contractors` | Cognito |
| GET | `/contractors/{id}` | Cognito |
| PATCH | `/contractors/{id}` | Cognito |
| GET | `/contractors/{id}/workers` | Cognito |
| POST | `/contractors/{id}/workers` | Cognito |
| DELETE | `/contractors/{id}/workers/{workerId}` | Cognito |
| GET | `/contractors/{id}/compliance` | Cognito |

### Sync (Sync Service Lambda)

| Method | Path | Auth |
|--------|------|------|
| POST | `/sync/sessions` | Cognito |
| POST | `/sync/media` | Cognito |
| GET | `/sync/status` | Cognito |

### Safety AI (AI Orchestration Lambda)

| Method | Path | Auth |
|--------|------|------|
| GET | `/safety-ai/findings` | Cognito |
| GET | `/safety-ai/findings/{id}` | Cognito |
| PATCH | `/safety-ai/findings/{id}/confirm` | Cognito |
| PATCH | `/safety-ai/findings/{id}/dismiss` | Cognito |
| GET | `/safety-ai/pending-review` | Cognito |
| GET | `/safety-ai/violations-by-rule` | Cognito |
| GET | `/safety-ai/corrective-actions` | Cognito |
| GET | `/safety-ai/pdf-reports` | Cognito |
| POST | `/safety-ai/pdf-reports/generate` | Cognito |
| POST | `/safety-ai/upload-evidence` | Cognito |

### Leads (Identity Service Lambda — Public)

| Method | Path | Auth |
|--------|------|------|
| POST | `/leads` | **None** (public) |

## Troubleshooting

### 501 Not Implemented
The Lambda was invoked but the handler doesn't recognize the route. Check that the handler's route matching logic includes the path being called.

### 403 on preflight (OPTIONS)
CORS is configured in `defaultCorsPreflightOptions`. If you get 403 on OPTIONS, the route doesn't exist in API Gateway (non-existent routes don't get CORS headers).

### "Authorization header requires Credential parameter"
The route doesn't exist in API Gateway. API Gateway defaults to IAM auth for unknown routes and rejects the Cognito token.

### How to check Lambda logs
```bash
aws logs filter-log-events \
  --log-group-name /aws/lambda/dev-policy-service \
  --start-time $(date -v-5M +%s000) \
  --region us-east-1 \
  --query "events[].message" \
  --output text
```
