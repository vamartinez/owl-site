#!/usr/bin/env bash
#
# smoke-test-deploy.sh — Post-deploy smoke test for the deployed frontends.
#
# Verifies that the REAL deployed CloudFront distributions can actually reach
# the API (not serve the SPA index.html), which is the exact "looks fine in
# local dev, silently broken in every real deploy" failure class this repo hit
# before. Run this AFTER `cdk deploy` + the frontend build/upload.
#
# It checks:
#   1. Landing Page leads endpoint through CloudFront:
#        POST https://<landing-cdn>/api/leads  -> expects 201 + JSON
#   2. One Admin Portal API call through CloudFront:
#        GET  https://<admin-cdn>/api/sites     -> expects JSON (not text/html)
#      - If ADMIN_TOKEN is set, sends it as Authorization and expects 200.
#      - If not set, expects 401 JSON (proves the request reached API Gateway's
#        Cognito authorizer, not the S3/SPA origin) and logs that the
#        authenticated path was not exercised.
#
# The core assertion for every check: the response must NOT be the SPA
# index.html (content-type text/html / an HTML body). Getting HTML back is the
# signature of the bug this fix closes.
#
# Usage:
#   ENVIRONMENT=dev AWS_REGION=us-east-1 ./smoke-test-deploy.sh
#   LANDING_URL=https://d74qdewg51t95.cloudfront.net \
#     ADMIN_URL=https://d3c5s45mr3ipu.cloudfront.net \
#     ADMIN_TOKEN=<idToken> ./smoke-test-deploy.sh
#
# Exit code 0 = all reachable; non-zero = at least one check failed.

set -uo pipefail

ENVIRONMENT="${ENVIRONMENT:-dev}"
AWS_REGION="${AWS_REGION:-us-east-1}"
PREFIX=""
if [ "$ENVIRONMENT" != "prod" ]; then PREFIX="${ENVIRONMENT}-"; fi

fail_count=0
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
info()  { printf '\033[36m%s\033[0m\n' "$*"; }

resolve_export() {
  # $1 = CloudFormation export name
  aws cloudformation list-exports --region "$AWS_REGION" \
    --query "Exports[?Name=='$1'].Value | [0]" --output text 2>/dev/null
}

# ─── Resolve CloudFront URLs ────────────────────────────────────────────────
# HostingStack does not export its URLs (they are CfnOutputs without exportName),
# so prefer explicit env vars; fall back to describe-stacks output lookup.
LANDING_URL="${LANDING_URL:-}"
ADMIN_URL="${ADMIN_URL:-}"

lookup_stack_output() {
  # $1 = stack name, $2 = output key
  aws cloudformation describe-stacks --region "$AWS_REGION" --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue | [0]" --output text 2>/dev/null
}

if command -v aws >/dev/null 2>&1 && aws sts get-caller-identity >/dev/null 2>&1; then
  HOSTING_STACK="${PREFIX}ComplianceHostingStack"
  if [ -z "$LANDING_URL" ]; then
    v="$(lookup_stack_output "$HOSTING_STACK" LandingPageURL)"
    [ "$v" != "None" ] && LANDING_URL="$v"
  fi
  if [ -z "$ADMIN_URL" ]; then
    v="$(lookup_stack_output "$HOSTING_STACK" AdminPortalURL)"
    [ "$v" != "None" ] && ADMIN_URL="$v"
  fi
fi

if [ -z "$LANDING_URL" ] || [ -z "$ADMIN_URL" ]; then
  red "ERROR: Could not resolve CloudFront URLs."
  red "  Set LANDING_URL and ADMIN_URL env vars, or ensure AWS creds + stack ${PREFIX}ComplianceHostingStack exist."
  exit 2
fi

LANDING_URL="${LANDING_URL%/}"
ADMIN_URL="${ADMIN_URL%/}"
info "Landing Page: $LANDING_URL"
info "Admin Portal: $ADMIN_URL"
echo

is_html() {
  # $1 = content-type header value, $2 = body
  case "$1" in *text/html*) return 0;; esac
  case "$2" in *"<!DOCTYPE html"*|*"<!doctype html"*|*"<html"*) return 0;; esac
  return 1
}

# ─── Check 1: Landing Page leads through CloudFront ─────────────────────────
info "[1/2] POST ${LANDING_URL}/api/leads"
tmp_body="$(mktemp)"
payload='{"company_name":"Smoke Test Co","contact_name":"Smoke Bot","email":"smoke-test@example.com","message":"Post-deploy smoke test — verifying CloudFront reaches the leads API."}'
read -r code ctype < <(curl -s -o "$tmp_body" \
  -w '%{http_code} %{content_type}\n' \
  -X POST "${LANDING_URL}/api/leads" \
  -H 'Content-Type: application/json' \
  -d "$payload")
body="$(cat "$tmp_body")"; rm -f "$tmp_body"

if is_html "$ctype" "$body"; then
  red "  FAIL: got HTML (the SPA index) — request never reached the API. status=$code content-type=$ctype"
  fail_count=$((fail_count + 1))
elif [ "$code" = "201" ]; then
  green "  PASS: 201 Created, JSON response — leads API reachable through CloudFront."
else
  red "  FAIL: expected 201 JSON, got status=$code content-type=$ctype body=${body:0:200}"
  fail_count=$((fail_count + 1))
fi
echo

# ─── Check 2: Admin Portal API call through CloudFront ──────────────────────
info "[2/2] GET ${ADMIN_URL}/api/sites"
tmp_body="$(mktemp)"
auth_args=()
if [ -n "${ADMIN_TOKEN:-}" ]; then
  auth_args=(-H "Authorization: ${ADMIN_TOKEN}")
fi
read -r code ctype < <(curl -s -o "$tmp_body" \
  -w '%{http_code} %{content_type}\n' \
  "${auth_args[@]}" \
  "${ADMIN_URL}/api/sites")
body="$(cat "$tmp_body")"; rm -f "$tmp_body"

if is_html "$ctype" "$body"; then
  red "  FAIL: got HTML (the SPA index) — request never reached the API. status=$code content-type=$ctype"
  fail_count=$((fail_count + 1))
elif [ -n "${ADMIN_TOKEN:-}" ]; then
  if [ "$code" = "200" ]; then
    green "  PASS: 200 JSON with token — authenticated Admin Portal API reachable through CloudFront."
  else
    red "  FAIL: expected 200 JSON with token, got status=$code content-type=$ctype body=${body:0:200}"
    fail_count=$((fail_count + 1))
  fi
else
  if [ "$code" = "401" ] || [ "$code" = "403" ]; then
    green "  PASS: $code JSON (no token) — reached API Gateway authorizer, not the SPA origin."
    info  "  NOTE: authenticated path NOT exercised (no ADMIN_TOKEN). Set ADMIN_TOKEN to fully verify."
  else
    red "  FAIL: expected JSON 401/403 (or 200 with token), got status=$code content-type=$ctype body=${body:0:200}"
    fail_count=$((fail_count + 1))
  fi
fi
echo

# ─── Summary ────────────────────────────────────────────────────────────────
if [ "$fail_count" -eq 0 ]; then
  green "SMOKE TEST PASSED — deployed frontends can reach the API."
  exit 0
fi
red "SMOKE TEST FAILED — $fail_count check(s) could not reach the API."
exit 1
