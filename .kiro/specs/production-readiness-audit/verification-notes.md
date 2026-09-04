# Verification Notes — Re-audit after Kiro's implementation pass (2026-09-04)

These notes are an independent, live re-test of `.kiro/specs/production-readiness-audit/` after Kiro implemented most of `tasks.md` (61/65 subtasks marked `[x]` at the time of this re-test; the remainder are `[-]`/`[ ]`, see below). Kept as a separate file, same convention as `admin-portal-audit-fixes/verification-notes.md`, so it doesn't collide with Kiro's own edits to `tasks.md`. Everything below was re-tested live against `localhost:3000`/`localhost:3001` (dev servers proxying the real `dev` API) **and, for Bug 1 specifically, against the actual deployed CloudFront domains** (`https://d3c5s45mr3ipu.cloudfront.net` Admin Portal, `https://d74qdewg51t95.cloudfront.net` Landing Page, resolved via `aws cloudformation describe-stacks`) — not inferred from reading the diff. A separate UI/UX design pass (not part of the original bug audit) is also included at the end, per explicit request.

## ⚠️ Priority note from Product Owner (2026-09-04): Landing Page / leads fix is DEFERRED, not urgent

The Landing Page CloudFront `webAclId` deploy blocker and the stale landing-page bundle redeploy (both under "Bug 1: Landing Page" below) are **explicitly deprioritized to just before public launch**, per Product Owner direction — there is no real traffic hitting the live Landing Page yet, so the silent-failure impact described below is theoretical until then, not an active incident. **Do not spend implementation time on the Landing Page / CloudFront WebACL / leads-form portion of Bug 1 now.** The Admin Portal side of Bug 1 (the `/api/*` proxy, already confirmed working) and the zero-data discrepancy noted under it are unrelated and still in scope, since the Admin Portal is already in active use.

**Revised near-term priority order**, replacing anything below that implies Bug 1's Landing Page half is next:
1. Close out Task 7.5 (run `reset-dev-data` against `dev`) and Task 12.4 (verify Safety AI's full pipeline with a real jobsite photo) — both already in progress.
2. Reopen and actually fix Task 7.2 (Contractors list join columns — marked `[x]` but confirmed still broken live).
3. Investigate the Admin Portal dashboard zero-data discrepancy and the Users & Roles role-mismatch (Vic shown as `worker` in the table vs. `Platform Admin` in the header) — both documented below.
4. Begin implementation of `.kiro/specs/worker-self-checkin` (the product's actual "killer workflow," 71 tasks) and `.kiro/specs/ai-provider-migration` (Bedrock → Anthropic Claude API, 48 tasks).
5. **Revisit the Landing Page CloudFront/leads fix as a pre-launch checklist item**, not before.

## Summary table

| Bug (bugfix.md #) | Status | Evidence |
|---|---|---|
| 1 — Leads/Admin Portal can't reach API | 🔴 **Landing Page: CONFIRMED still broken in production, in a WORSE, silent way (see below). Admin Portal: `/api/*` proxy CONFIRMED working live.** | tested against real domains, see below |
| 2 — Reports 400 on every load | ✅ **Fixed** | `/reports` now loads a proper empty state, no error |
| 3 — Site Profile blank name/N/A stats | ✅ **Fixed** | name, address, 100% compliance all render |
| 4 — Users & Roles always empty | ✅ **Fixed** (new discrepancy found, see below) | Vic + Heidi now listed |
| 5 — Dashboard trend chart empty | ❌ **Still broken** | chart still shows no line despite 86% compliance KPI |
| 6 — Certifications "Unknown" chart | 🟡 **Partially fixed** | label now real (`site_ready_bc`), bar still doesn't render |
| 7 — Sites list blank join columns | 🟡 **Partially fixed** | Workers/Compliance now real; Contractor still blank (may be genuinely empty) |
| 8 — Contractors list blank join columns | ⚠️ **Marked `[x]` in tasks.md but NOT actually fixed live** | see below — same false-positive pattern `verification-notes.md` in the prior spec already documented once |
| 9 — Safety AI has no upload entry point | ✅ **Fixed** | full "New Scan" page exists, wired to a real endpoint |
| 10/11 — Site Access has no site selector / worker self-checkin | ❌ **Still open** (expected — scoped as follow-up spec) | unchanged from original audit |
| 12 — Formularios module in Spanish | ✅ **Fixed** | now fully English |
| 13 — Dev data hygiene / quoted names | ❌ **Still open** (expected — Task 7.5 in progress) | duplicate junk data unchanged; `"Test"` name still visible |

## Bug 1 (leads / Admin Portal API connectivity): tested against the REAL deployed CloudFront domains — critical new finding

Obtained the real domains via `aws cloudformation describe-stacks --stack-name dev-ComplianceHostingStack`:
- Admin Portal: `https://d3c5s45mr3ipu.cloudfront.net`
- Landing Page: `https://d74qdewg51t95.cloudfront.net`

### Admin Portal: `/api/*` proxy is live and genuinely working

Logged in at the real domain, opened `/dashboard`, and captured network traffic: `GET /api/dashboard/kpis`, `/api/dashboard/risks`, `/api/dashboard/blocked-access`, `/api/dashboard/expiring-certs`, `/api/dashboard/recent-activity` **all returned real `200` responses from the real domain** — the CloudFront `/api/*` behavior (Fix B) is deployed and functioning for this distribution. Good news, confirmed.

**New discrepancy found, not yet explained:** the deployed dashboard shows **0 Active Workers / 0% Site Compliance / all zeros**, while `localhost:3000` (proxying the same `dev` API Gateway) shows **7 workers / 86% compliance** for the same tenant/login. CloudFront caching is ruled out — `hosting-stack.ts` explicitly sets `cachePolicy: CACHING_DISABLED` on the `/api/*` behavior. Needs investigation: possibly a different `TABLE_PREFIX`/environment the deployed Lambda resolves to, or tenant-scoping differing between this session's login and how it's evaluated per-request. Also confirmed the deployed Admin Portal bundle is **stale relative to local source** — it still shows "Dashboard Ejecutivo" and "Formularios" (Spanish), meaning the JS bundle itself hasn't been rebuilt/redeployed since Kiro's i18n and other frontend fixes landed, even though the *infrastructure* fix (CloudFront behavior) is live.

### Landing Page: CONFIRMED still broken — and now failing silently with a FALSE "success" message

This is the most important finding of this re-audit. Submitted the real Landing Page contact form at the real domain (`https://d74qdewg51t95.cloudfront.net`) and it showed **"Thank you! We'll be in touch within 24 hours."** — looks fixed. It is not. Captured the actual network request: `POST https://d74qdewg51t95.cloudfront.net/leads` (note: **no `/api` prefix**) → `200`. Reproduced independently with `curl`:

```
curl -X POST https://d74qdewg51t95.cloudfront.net/leads -d '{...}'
→ HTTP 200, Content-Type: text/html, body: the Landing Page's own <html>...index.html</html>
```

**What's actually happening:** the deployed Landing Page bundle is still the OLD build — it predates Kiro's `apiUrl = import.meta.env.VITE_API_URL || '/api'` fallback fix, so it's still running `apiUrl = ... || ''`, meaning it calls bare `/leads`, not `/api/leads`. CloudFront's default (non-API) behavior serves that against the S3 static origin; POST isn't a valid static-site request, so CloudFront's own SPA-routing `errorResponses` (403/404 → `/index.html`, **with the response code overridden to 200** for client-side routing to work) kicks in and returns the Landing Page's own HTML — with a 200 status. `ContactForm.tsx`'s `handleSubmit` only checks `response.ok` (true for any 2xx) before showing the success state; it never verifies the response is actually JSON or contains `{success: true}`. **Result: every lead submitted through the real production Landing Page right now is silently discarded while the visitor sees a genuine-looking "Thank you" confirmation.** This is worse than the original bug (which at least surfaced an honest error) — it's now a silent data-loss bug that looks like it works, and it would not be caught by anyone just glancing at the site.

Even a fresh rebuild of `landing-page` alone would not fully fix this today: retested `POST /api/leads` directly on this same real domain and it **also** returns the SPA HTML (200, `text/html`) — the CloudFront `/api/*` behavior is **not live for the Landing Page distribution**, unlike Admin Portal's. Checked why:

```
aws cloudformation describe-stacks --stack-name dev-ComplianceHostingStack
→ StackStatus: UPDATE_ROLLBACK_COMPLETE, LastUpdated: 2026-09-04T01:37:37Z

aws cloudformation describe-stack-events --stack-name dev-ComplianceHostingStack
→ LandingPageCDN7DA9333C  UPDATE_FAILED
  "Invalid request provided: You can't remove or replace the web ACL for your
   distribution. Distributions with a pricing plan subscription must have a
   web ACL resource." (CloudFront, HandlerErrorCode: InvalidRequest)
→ AdminPortalCDN870976E4  UPDATE_FAILED  "Resource update cancelled" (sibling failure)
```

**Root cause of the deploy failure:** `hosting-stack.ts` only sets `webAclId` on a distribution when a CDK context value is passed at deploy time (`cdk deploy -c webAclId=<arn>` — see lines ~42-44, ~136, ~164). The automated deploy command (`pnpm deploy:dev` → `cdk deploy --all --context environment=dev`) never passes `webAclId`, so the generated template omits it. The **live** `LandingPageCDN` distribution currently has a Web ACL attached (out-of-band, likely from an earlier manual association or a CloudFront pricing-plan requirement), and CloudFront's API rejects any update that would remove it from a distribution enrolled in that pricing plan. The whole stack rolled back as a unit, which is why `AdminPortalCDN` shows `UPDATE_FAILED` too — but Admin Portal's `/api/*` behavior was evidently already present from an earlier, successful deploy, so its rollback target still has it working; Landing Page's was not, so its rollback target does not.

**Two separate things need to happen, in order, before Landing Page leads work in production:**
1. Find the current WAF Web ACL ARN actually attached to `LandingPageCDN` (check the AWS Console → CloudFront → that distribution → General tab, or `aws wafv2 list-web-acls --scope CLOUDFRONT` if IAM permits — the CLI identity used in this session lacks `cloudfront:ListDistributions`/similar list permissions to look it up directly) and either (a) pass it via `cdk deploy -c webAclId=<arn>` every time, or — better, so this can't be forgotten — (b) have `hosting-stack.ts` look it up itself (e.g. hardcode the known ARN as a fallback constant, or resolve it via an SSM parameter / cross-stack reference) so a plain `pnpm deploy:dev` always includes it.
2. Once the CloudFormation update succeeds, rebuild and redeploy the `landing-page` static bundle itself (`pnpm build:landing` with a real `VITE_API_URL` injected, then re-upload to the `LandingPageBucket` S3 bucket) — the currently-deployed bundle predates the `|| '/api'` fallback fix and will keep calling bare `/leads` until it's rebuilt.

**Also recommended regardless of the above:** `ContactForm.tsx`'s success check should not trust `response.ok` alone — parse the JSON body and confirm `body.success === true` (or check `Content-Type: application/json`) before showing the success state, as defense-in-depth against exactly this class of CloudFront-fallback masking. This same review should be applied to any other POST call in the codebase that could hit a CloudFront SPA-fallback distribution.

## Bug 4 (Users & Roles): fixed, but surfaced a new discrepancy worth a follow-up

`/admin` now correctly lists both platform users ("2 users in the platform": Vic, Heidi) instead of showing zero — the Cognito `Filter` fix worked. However: **the table shows Vic's Role as `worker`**, while the app header (top-right) shows "Vic / Platform Admin" for the same logged-in session. This is a new, previously-unseen discrepancy — either the Users & Roles table is reading the wrong attribute/mapping the role incorrectly, or the header is using a different (possibly stale/cached) source of truth than what Cognito actually has for this user. Needs its own investigation; not covered by the original spec since the original bug was "list is empty," not "role shown is wrong."

## Bug 8 (Contractors list): tasks.md says `[x]` done — live re-test says it isn't

`tasks.md` line for 7.2 ("Extend `listContractors`... to include phone/worker-count/compliance per row") is checked off. Live re-test of `/contractors` right now shows **identical behavior to the original audit**: Phone, Workers, and Compliance columns all show "—" for all 4 rows. Compare to Bug 7 (Sites list, task 7.1), which uses the same pattern and **is** now showing real `Workers: 0` / `Compliance: 100%` values live — so the sibling fix (7.1) demonstrably works when deployed, but 7.2 does not, despite an identical checkbox state. This is the same "looks fixed in source, not actually working live" pattern `admin-portal-audit-fixes/verification-notes.md` already documented once for this codebase (that time it was a missing CDK route; this time the cause hasn't been diagnosed yet — could be a stale deploy of just this one Lambda, a bug specific to `contractor.ts`'s implementation, or a frontend read of the wrong response field). **Recommend reopening 7.2** rather than trusting the checkbox — re-check the actual `listContractors` response body via network inspection before assuming it's a deploy issue like Bug 1.

## Bug 9 (Safety AI upload): fixed and well-built; full AI pipeline not exercised

`/safety-ai` now has a prominent "New Scan" button leading to a complete upload page: site selector (required), Trade/Project Phase fields, drag-and-drop + file picker + camera capture, "Upload & Analyze" action. Tested with a synthetic 1×1 test image (no real jobsite photo was available this session): the app correctly rejected it client→server with `API Error [422]: UNPROCESSABLE_ENTITY` and a clean "Could not start analysis / Try Again" error state — confirming the endpoint is real and wired end-to-end, not a stub, and that server-side image validation (minimum 640×480 per the UI copy) works. **Full success-path verification (real photo → real AI finding with detection data) still needs to happen with an actual jobsite photo** — this matches `tasks.md` 12.4 already being marked `[-]` in-progress, not done.

## Bug 13 (data hygiene): unchanged, expected — Task 7.5 in progress

Sites/Workers/Contractors lists still show the same duplicate junk data as the original audit ("Test Site Alpha Updated" ×6, "John Test Worker" ×5, "Updated Contractor Inc" ×4). The reset script itself (Task 7.4) is done, but running it against `dev` (Task 7.5) is marked in-progress and hasn't completed as of this re-test. The worker whose name renders with literal quote marks (`"Test"`) still shows that way on the Worker detail page — expected, since Task 7.3's fix (input trimming) only applies to new create/update requests going forward, not a backfill of existing dirty records; that record will only get cleaned up once the reset script (7.5) actually runs.

---

## UI/UX Design Review (new — not part of the original functional audit, requested this pass)

A full visual/UX pass was done across every page of both apps (Admin Portal + Landing Page), independent of the functional re-test above. Ranked by impact on perceived product quality for a prospective BC construction customer evaluating the product:

1. **Primary-action buttons are systematically low-contrast/pale** — "Check In" (Site Access), "Upload & Analyze" (Safety AI), "Download" (Documents) all render in a muted light-blue that reads as *disabled*, even when they're fully functional. This is the single highest-impact fix: a working button that looks broken is nearly as damaging to trust as one that actually is broken.
2. **Three inconsistent loading-state patterns** across the app — skeleton bars (Dashboard, Incidents), a plain spinner (Documents), plain text "Loading..." (Reports, seen during this re-test). Standardize on the skeleton-bar pattern everywhere.
3. **Empty states are inconsistent in quality** — Reports' "No reports yet" (icon + headline + helper copy + prominent CTA), confirmed live in this re-test, is the best in the app and should be the template applied everywhere else (Site Access, Worker detail currently feel bare by comparison).
4. **Landing Page has no persistent header/nav** — no logo or nav links stay visible once a visitor scrolls past the hero; only the footer has links back to Pricing/Testimonials/Contact.
5. **"Dashboard Ejecutivo" is still Spanish** in an otherwise now-fully-English app (confirmed live: the page title itself, separate from the already-fixed Formularios module).
6. **Landing Page hero-to-features transition is an abrupt hard color cut** (dark blue gradient straight to white, no divider/fade) — reads as two unrelated sections stacked together.
7. Smaller items: pricing page's two side-tier "Get in Touch" buttons are pale-gray next to the middle tier's solid-blue button (looks disabled, not "secondary"); testimonial cards truncate mid-word ("VP of Safety, Builders," with a trailing comma and nothing after — same pattern as the Site Profile address's trailing comma found in the functional re-test, likely one shared "city, province" template bug); native `<input type="date">` fields on Documents visually clash with the custom-styled dropdowns next to them; Sites list uses a blank cell for "no data" while Contractors list uses an em-dash "—" for the same concept, one page apart.

Positives worth preserving: the rounded-square tinted-background icon style is consistent between Dashboard KPI cards and Landing Page feature cards (the two apps do share a visual language at that level); status/role pills use a consistent green/blue/purple system app-wide; the new Safety AI "New Scan" page is the best-composed form in the portal.

---

# Task 7.5 — Run reset-dev-data against `dev` & confirm clean Sites/Contractors/Workers lists (Requirements 6.1–6.4)

**Date:** Task 7.5 execution. **Scope:** run `packages/backend/scripts/reset-dev-data.ts` (built by Task 7.4) against `dev`, first dry-run then live, and confirm the Sites/Contractors/Workers lists show clean, realistic, non-duplicated demo data.

## Verdict: BLOCKED on IAM data-plane permissions — could NOT run live (not fabricated). Script logic, environment guard, and dry-run flag verified correct at source + execution level.

## Environment / access summary

- AWS creds ARE present this session: IAM user `parrot-cli-mac`, account `699499736404`, region `us-east-1` (same identity Task 1/2 used for CloudFormation/CDK deploy).
- **Critical limitation:** this identity has CDK/CloudFormation deploy perms but **no DynamoDB data-plane permissions**. Every DynamoDB call the reset script needs is explicitly denied by IAM:
  - `aws dynamodb list-tables` → `AccessDeniedException` (`dynamodb:ListTables`).
  - `aws dynamodb describe-table --table-name dev-Sites` → `AccessDeniedException` (`dynamodb:DescribeTable`).
  - `aws dynamodb query --table-name dev-Sites ...` → `AccessDeniedException` (`dynamodb:Query`).
- Consistent with all prior tasks: no `platform_admin`/authenticated Cognito session is mintable here (IAM lacks `cognito-idp` admin actions, no `TEST_AUTH_TOKEN`), so the Admin Portal Sites/Contractors/Workers lists also could NOT be loaded live to visually confirm the reseeded data.

## What was actually executed

1. **Unit tests for the safety-critical logic — PASS (9/9).** `npx vitest run tests/unit/reset-dev-data.test.ts`: the environment guard (`isDevEnvironment`) permits ONLY `dev` and refuses prod/staging/unset/`DEV`/`dev `/`development`; dry-run detection (`isDryRun`) is exact-match (`--dry-run` only, not substrings). These are the two behaviors that make the script safe against a shared env, and both are pinned green.

2. **Dry-run executed via `pnpm reset:dev-data:dry-run` (`ENVIRONMENT=dev ... --dry-run`).** Result:
   - The esbuild bundle built clean (`dist/scripts/reset-dev-data.cjs`, 16.4kb).
   - **The environment guard passed correctly** and the script entered dry-run mode, printing `=== reset-dev-data (DRY RUN — no writes/deletes) === / Environment: dev / Demo tenant: demo-tenant` — proving the guard accepts `dev` and the dry-run branch is wired.
   - It then failed at the FIRST real AWS call — `discoverChildOwnerIds()` → `Query` on `dev-Workers` → `AccessDeniedException` (`dynamodb:Query` not authorized for `parrot-cli-mac`). Dry-run still performs read Queries to enumerate what WOULD be deleted, so it cannot complete without data-plane read access.

## Source-level correctness review of the script (what could be verified without live access)

The script is well-formed and its assumptions match the consuming code, so once run by an identity with DynamoDB access it should produce correct, clean demo data:

- **Environment guard is correct and fail-closed:** `assertDevEnvironment()` `process.exit(1)`s unless `ENVIRONMENT==='dev'` (exact match); refuses prod/unset/typos. Confirmed by unit tests + the live dry-run entering dev mode only.
- **Dry-run is genuinely non-destructive:** every `DeleteCommand`/`PutCommand` is guarded by `if (!DRY_RUN)`; dry-run logs `[dry-run] would delete/seed …` and writes nothing.
- **Scoped to a clearly-labeled demo tenant only:** all clears/seeds are keyed to `PK = TENANT#demo-tenant` (and per-worker/per-contractor child partitions derived from it), so it can never touch a real customer tenant. Sites are labeled `Demo — …`.
- **Clear-before-seed prevents duplication:** `clearWorkerCertifications` + `clearContractorWorkers` (children) run before `clearTenantPartition` wipes Workers/Contractors/Sites/ScanSessions, then `seedDemoData` inserts a fixed small set (3 sites, 2 contractors, 10 workers, varied cert states, 7 days of mixed allowed/denied ScanSessions). Re-running is idempotent (clears the prior seed first) → no duplicated rows, satisfying "non-duplicated" (Req 6.3). It also removes throwaway test leads (`Verify Co`/`Post Deploy Co`/`X`).
- **Seed shape matches the list/compliance consumers (verified against source):**
  - Sites carry `contractor_name`; `shared/site-compliance.ts::computeSiteCompliance` reads `contractor ?? contractor_name` → the Sites list's contractor column will populate (Req 6.1).
  - ScanSessions are written under `PK = TENANT#demo-tenant` with `site_id`, `worker_id`, `result: 'allowed'|'denied'` — exactly what `computeSiteCompliance` queries (KeyCondition on `PK`, filter on `site_id`, `compliancePercent = round(allowed/total*100)`, distinct `worker_id` = `activeWorkers`) → Sites/Contractors list worker-count + compliance columns (Task 7.1/7.2, Req 6.1/6.2) will show realistic non-trivial numbers, and the 7-day mixed allowed/denied spread feeds the Dashboard Compliance Trend chart (Task 6).
  - Worker `legal_name`/`preferred_name` values are clean, realistic human names (no quotes/whitespace pollution), consistent with the Task 7.3 sanitizer → Workers list shows sanitized names (Req 6.3).

## What remains to be done (for an operator with DynamoDB access)

Run once the reset script is executed by an identity that has `dynamodb:Query`/`PutItem`/`DeleteItem` on the `dev-*` tables (e.g. a CI role or an engineer's dev role), NOT the current deploy-only `parrot-cli-mac`:

1. `cd packages/backend && pnpm reset:dev-data:dry-run` → review the `[dry-run] would delete/seed` output.
2. `pnpm reset:dev-data` (real run) → expect it to report clearing any prior demo rows then seeding 3 sites / 2 contractors / 10 workers / certifications / ~30 scan sessions.
3. Log in to the Admin Portal (`dev`) as an admin for `demo-tenant` and confirm:
   - **Sites** list shows the 3 `Demo — …` sites with populated worker-count + compliance columns (not N/A), and correct contractor names.
   - **Contractors** list shows 2 contractors with phone + worker-count + compliance, and an accurate total header count.
   - **Workers** list shows 10 clean, realistically-named workers with no duplicates and no quote/whitespace artifacts.

**Bottom line:** the reset script from Task 7.4 is correct — its `dev`-only guard and `--dry-run` flag both work (verified by unit tests and by a live dry-run that entered dev/dry-run mode before hitting the permissions wall), and its seed shape is confirmed at source to feed the Task 7.1/7.2 list-aggregation columns. The one thing Task 7.5 asks for that could NOT be done — running it live and visually confirming the reseeded lists — is blocked purely by the current IAM identity lacking DynamoDB data-plane permissions and no authenticated Admin Portal session, not by any defect in the script. No results were fabricated.
