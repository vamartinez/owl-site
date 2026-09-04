# API Issues — Integration Test Results

## Test Results: 9/16 passing

### Passing ✓
- POST /sites (201)
- GET /sites (200)
- GET /sites/{id} (200)
- PATCH /sites/{id} (200)
- POST /policies (201)
- GET /policies/{id} (200)
- POST /policies/{id}/versions (201)
- GET /sites/{id}/daily-summary (200)
- GET /sync/status (200)

### Failing ✗

| Endpoint | Status | Issue | Fix Required |
|----------|--------|-------|--------------|
| POST /workers | 502 | Lambda crash — likely DynamoDB table name or env var issue | Check Lambda logs, fix table name |
| GET /workers | 400 | Handler missing `GET /workers` route (only has `GET /workers/{id}`) | Add list route to identity handler |
| POST /contractors | 400 | Contractors routed to Identity Lambda which doesn't handle `/contractors` | CDK routes to wrong Lambda OR add routes to identity handler |
| GET /contractors | 400 | Same as above | Same fix |
| GET /findings | 400 | AI Orchestration Lambda doesn't handle `GET /findings` | Add route to AI orchestration handler |
| POST /reports | 502 | Lambda crash — likely missing DynamoDB table or env var | Check Lambda logs |
| POST /leads | 401 | Routed to Identity Lambda (requires auth) instead of public handler | Fix CDK to use a Lambda without authorizer, or create dedicated leads Lambda |

## Root Causes

### 1. Missing list routes in handlers
The Identity Service handler has `GET /workers/{id}` but not `GET /workers` (list all workers).

### 2. CDK routing mismatch
- `/contractors` routes to Identity Service Lambda but that handler doesn't have contractor routes
- `/leads` routes to Identity Service Lambda with Cognito auth, but should be public
- `/findings` routes to AI Orchestration Lambda but that handler doesn't have findings list route

### 3. Lambda crashes (502)
- Workers POST: Likely `TABLE_PREFIX` env var not set, or DynamoDB table doesn't exist
- Reports POST: Same issue

## How to Debug 502 Errors

```bash
# Check Lambda env vars
aws lambda get-function-configuration --function-name dev-identity-service --region us-east-1 --query "Environment.Variables"

# Check Lambda logs
aws logs filter-log-events --log-group-name /aws/lambda/dev-identity-service --start-time $(date -v-5M +%s000) --region us-east-1 --query "events[].message" --output text

# List DynamoDB tables
aws dynamodb list-tables --region us-east-1 --query "TableNames[?contains(@, 'Worker')]"
```
