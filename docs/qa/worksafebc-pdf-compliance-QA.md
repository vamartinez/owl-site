# QA Check-in — WorkSafeBC PDF Compliance Agent (scoped)

Branch: `feat/worksafebc-pdf-compliance-qa`
Spec: `.kiro/specs/worksafebc-pdf-compliance-agent` — 32/56 tasks done.

## What this build is
An AI pipeline to upload construction safety PDFs and get a structured
WorkSafeBC OHSR compliance report. Extends the `report-validation` service
(new routes, tables, SQS consumers, and a WorkSafeBC validation engine).

## Scope of THIS QA pass — test these
1. **Upload + categorize** — `/worksafebc` → "Analizar documento" → pick a PDF
   (≤50MB) → choose a category → analysis starts.
2. **Live progress** — session detail shows 4 stages (carga, extracción,
   análisis, reporte), polled every 3s.
3. **Report** — compliance level, executive summary, findings with
   severity/type filter + sort, recommendations.
4. **Re-analyze** — creates a new session linked to the same document group.
5. **History** — `/worksafebc` list, filter by category / compliance level.
6. **Regulatory KB admin** (platform_admin) — `/worksafebc/regulatory-kb`,
   publish a version, see it listed.
7. **RBAC** — upload is allowed for platform_admin, tenant_admin, site_admin,
   supervisor, cso; denied for gate_operator, worker.
8. **JSON export** — `GET /worksafebc-agent/sessions/{id}/report/export?format=json`.
9. **Notifications** — on a terminal state (completado/fallida/timeout) a bell
   notification is emitted via the platform events topic and the session's
   `notification_delivered` flag is set.
10. **Timeout watchdog** — a session stuck >10 min in a non-terminal state is
    transitioned to `timeout` by a scheduled Lambda (1-min cadence).

## OUT OF SCOPE — do NOT file these as bugs
- **PDF export is JSON-only** (product decision: HTML + client print-to-PDF).
  `format=pdf` intentionally returns 400.
- **Compliance-level rule assumes Requirement 4.9** (design.md recommendation),
  not 3.6. Validate against 4.9.
- **Notification channel is the in-platform bell only** (no SES email in v1).

## Pre-req: deploy (owner does this)
1. Put `OLLAMA_API_KEY` in Secrets Manager (secret `dev-ollama-api-key`) — the
   AI analysis step fails without it.
2. `pnpm build:backend && pnpm build:portal`
3. `pnpm deploy:dev`  (creates the 3 tables, the pdf-compliance queue/DLQ/topic,
   the 2 consumer Lambdas, and the 8 `/worksafebc-agent/*` routes)
4. Seed at least one regulatory version (below) BEFORE analyzing — otherwise the
   analysis runs with no OHSR grounding.

## Seed a test regulatory version
As a platform_admin, POST `/worksafebc-agent/regulatory-versions` (or use the
KB admin page, pasting the `clauses` array). Example body:
see `docs/qa/worksafebc-seed-version.json`.

## Known non-blocking test artifacts
- `forms-sanitizer.property.test.ts` is a pre-existing flaky property test
  (passes in isolation); unrelated to this feature.
- `decision-engine` and `policy-sites-crud.e2e` failures are pre-existing local
  AWS-credential issues (`dynamodb:Query` denied for the local IAM user).
