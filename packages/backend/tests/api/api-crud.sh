#!/bin/bash
# API CRUD Integration Tests
# Usage: ./api-crud.sh
#
# Prerequisites:
# 1. Set API_URL and TOKEN environment variables:
#    export API_URL=https://qhk659i3s9.execute-api.us-east-1.amazonaws.com/dev
#    export TOKEN=$(get your Cognito ID token)
#
# 2. Make executable: chmod +x api-crud.sh
# 3. Run: ./api-crud.sh

set -e

API_URL="${API_URL:-https://qhk659i3s9.execute-api.us-east-1.amazonaws.com/dev}"
TOKEN="${TOKEN:-}"

if [ -z "$TOKEN" ]; then
  echo "ERROR: Set TOKEN environment variable with your Cognito ID token"
  echo "  export TOKEN=eyJraWQiOi..."
  exit 1
fi

PASS=0
FAIL=0
TOTAL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

test_endpoint() {
  local method=$1
  local path=$2
  local body=$3
  local expected_status=$4
  local description=$5
  TOTAL=$((TOTAL + 1))

  if [ -n "$body" ]; then
    response=$(curl -s -w "\n%{http_code}" -X "$method" \
      "$API_URL$path" \
      -H "Authorization: $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$body")
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" \
      "$API_URL$path" \
      -H "Authorization: $TOKEN" \
      -H "Content-Type: application/json")
  fi

  status_code=$(echo "$response" | tail -1)
  response_body=$(echo "$response" | sed '$d')

  if [ "$status_code" = "$expected_status" ]; then
    echo -e "${GREEN}✓ PASS${NC} [$status_code] $method $path — $description"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}✗ FAIL${NC} [$status_code] $method $path — $description (expected $expected_status)"
    echo "  Response: $(echo "$response_body" | head -c 200)"
    FAIL=$((FAIL + 1))
  fi

  # Return response body for chaining
  echo "$response_body" > /tmp/last_response.json
}

echo ""
echo "=========================================="
echo "  API CRUD Integration Tests"
echo "  URL: $API_URL"
echo "=========================================="
echo ""

# ─── SITES ─────────────────────────────────────────────────────────────────────
echo -e "${YELLOW}--- Sites ---${NC}"

test_endpoint "POST" "/sites" \
  '{"name":"Test Site Alpha","address":"123 Main St, Vancouver, BC","timezone":"America/Vancouver"}' \
  "201" "Create site"

SITE_ID=$(cat /tmp/last_response.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('site',{}).get('site_id',''))" 2>/dev/null || echo "")

test_endpoint "GET" "/sites" "" "200" "List sites"

if [ -n "$SITE_ID" ]; then
  test_endpoint "GET" "/sites/$SITE_ID" "" "200" "Get site by ID"
  test_endpoint "PATCH" "/sites/$SITE_ID" '{"name":"Test Site Alpha Updated"}' "200" "Update site"
fi

# ─── WORKERS ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}--- Workers ---${NC}"

test_endpoint "POST" "/workers" \
  '{"legal_name":"John Test Worker","preferred_name":"John","phone":"+16045551234","language_preference":"en"}' \
  "201" "Create worker"

WORKER_ID=$(cat /tmp/last_response.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('worker',{}).get('worker_id',''))" 2>/dev/null || echo "")

test_endpoint "GET" "/workers" "" "200" "List workers"

if [ -n "$WORKER_ID" ]; then
  test_endpoint "GET" "/workers/$WORKER_ID" "" "200" "Get worker by ID"
  test_endpoint "PATCH" "/workers/$WORKER_ID" '{"preferred_name":"Johnny"}' "200" "Update worker"
fi

# ─── POLICIES ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}--- Policies ---${NC}"

test_endpoint "POST" "/policies" \
  "{\"name\":\"Test Safety Policy\",\"description\":\"Test policy for integration tests\",\"site_id\":\"${SITE_ID:-00000000-0000-0000-0000-000000000001}\",\"jurisdiction\":\"British Columbia\",\"owner_type\":\"tenant\",\"owner_id\":\"00000000-0000-0000-0000-000000000001\"}" \
  "201" "Create policy"

POLICY_ID=$(cat /tmp/last_response.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('policy',{}).get('policy_id',''))" 2>/dev/null || echo "")

if [ -n "$POLICY_ID" ]; then
  test_endpoint "GET" "/policies/$POLICY_ID" "" "200" "Get policy by ID"

  test_endpoint "POST" "/policies/$POLICY_ID/versions" \
    '{"effective_from":"2025-01-01","rules":[{"rule_id":"rule-1","rule_type":"certification_required","description":"Fall protection required","conditions":{},"actions":{}}],"change_summary":"Initial version for testing"}' \
    "201" "Create policy version"
fi

# ─── CONTRACTORS ───────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}--- Contractors ---${NC}"

test_endpoint "POST" "/contractors" \
  '{"company_name":"Test Contractor Inc","contact_name":"Jane Doe","contact_email":"jane@testcontractor.com"}' \
  "201" "Create contractor"

CONTRACTOR_ID=$(cat /tmp/last_response.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('contractor',{}).get('contractor_id',''))" 2>/dev/null || echo "")

test_endpoint "GET" "/contractors" "" "200" "List contractors"

if [ -n "$CONTRACTOR_ID" ]; then
  test_endpoint "GET" "/contractors/$CONTRACTOR_ID" "" "200" "Get contractor by ID"
  test_endpoint "PATCH" "/contractors/$CONTRACTOR_ID" '{"company_name":"Updated Contractor Inc"}' "200" "Update contractor"

  if [ -n "$WORKER_ID" ]; then
    test_endpoint "POST" "/contractors/$CONTRACTOR_ID/workers" \
      "{\"worker_id\":\"$WORKER_ID\"}" \
      "201" "Assign worker to contractor"

    test_endpoint "GET" "/contractors/$CONTRACTOR_ID/workers" "" "200" "List contractor workers"
    test_endpoint "GET" "/contractors/$CONTRACTOR_ID/compliance" "" "200" "Get contractor compliance"
  fi
fi

# ─── FINDINGS ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}--- Findings ---${NC}"

test_endpoint "GET" "/findings" "" "200" "List findings"

# ─── REPORTS ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}--- Reports ---${NC}"

if [ -n "$SITE_ID" ]; then
  test_endpoint "GET" "/sites/$SITE_ID/daily-summary" "" "200" "Get daily summary"
fi

test_endpoint "POST" "/reports" \
  "{\"site_id\":\"${SITE_ID:-00000000-0000-0000-0000-000000000001}\",\"report_type\":\"daily_compliance_summary\",\"reporting_period_start\":\"2025-01-01T00:00:00Z\",\"reporting_period_end\":\"2025-01-02T00:00:00Z\"}" \
  "201" "Create report"

# ─── LEADS (Public — no auth) ─────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}--- Leads (Public) ---${NC}"

# Test without auth token
TOTAL=$((TOTAL + 1))
lead_response=$(curl -s -w "\n%{http_code}" -X POST \
  "$API_URL/leads" \
  -H "Content-Type: application/json" \
  -d '{"company_name":"Test Company","contact_name":"Bob Test","email":"bob@test.com","message":"Interested in the platform"}')
lead_status=$(echo "$lead_response" | tail -1)
if [ "$lead_status" = "201" ]; then
  echo -e "${GREEN}✓ PASS${NC} [201] POST /leads — Create lead (public, no auth)"
  PASS=$((PASS + 1))
else
  echo -e "${RED}✗ FAIL${NC} [$lead_status] POST /leads — Create lead (expected 201)"
  FAIL=$((FAIL + 1))
fi

# ─── SYNC ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}--- Sync ---${NC}"

test_endpoint "GET" "/sync/status?device_id=test-device-001" "" "200" "Get sync status"

# ─── SUMMARY ───────────────────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo -e "  Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, $TOTAL total"
echo "=========================================="
echo ""

if [ $FAIL -gt 0 ]; then
  exit 1
fi
