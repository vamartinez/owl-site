# Verification Notes (independent review — do not treat as part of design.md/tasks.md)

These notes were produced by re-reading the actual backend/frontend source and re-testing the live dev deployment at `localhost:3000`, in parallel with Kiro's implementation of this spec. They are kept in a separate file on purpose so they don't collide with Kiro's own edits to `design.md`/`tasks.md` (this repo has no git, so concurrent edits to the same file can't be safely merged or recovered). Read this alongside `design.md` before closing out tasks 6, 7, and 9 in `tasks.md`.

## ⚠️ Task 7 (Bug 5 — Reports 403) is marked `[x]` complete but is NOT actually fixed

`tasks.md` shows task 7 / 7.1 as done, based on robustifying role-claim resolution in `packages/backend/src/shared/auth-middleware.ts` (`custom:role` → `cognito:groups` fallback, debug logging). That change is harmless but **does not address the real root cause**, and re-testing confirms the bug is still present:

- `grep -n "report-validation" packages/backend/infra/lib/api-stack.ts` returns **nothing** — there is no Lambda function declaration and no `addResource('report-validation')` anywhere in the CDK stack. Only `/reports` exists, served by a different, unrelated Lambda (`reportingServiceFn`).
- The frontend calls `/api/report-validation/reports`, which has no matching API Gateway resource. AWS's default behavior for an unmatched REST API path (no custom domain) is `403` with `{"message":"Missing Authentication Token"}` — returned before any Lambda code, including `auth-middleware.ts`, ever executes. No amount of claims-resolution fixing can affect a request that never reaches the Lambda.
- Live re-test just now: `GET /reports` (via the Reports page) is still `403` with "No tienes permisos para realizar esta acción" (the frontend's generic 403 fallback message in `api-client.ts:80`, which masks the real cause).

**Recommended fix** (not yet done): add a Lambda function declaration for `packages/backend/src/services/report-validation/handler.ts` in `api-stack.ts` (same pattern as `reportingServiceFn`), plus the resource tree `report-validation` → `reports` (GET, POST) → `{id}` (GET) → `validate`/`versions`/`submit`/`history`, wired to the same Cognito authorizer used elsewhere, with whatever IAM permissions `upload-manager.ts`/`kb-manager.ts`/`text-extractor.ts` need. **Recommend reopening task 7 in `tasks.md`** (change back to `[ ]`) and adding this as its real fix — the current 7.1 can stay as-is, it's just insufficient on its own.

## Task 6 (Bug 4 — contractors count): fixed for today's data, but a latent bug remains

`ContractorList.tsx:115` now reads `data?.total || data?.contractors?.length || 0`, and live-tested it correctly shows "4 contractors registered" for the current test tenant. However `packages/backend/src/services/contractors/contractor.ts`'s `listContractors` still returns only `{ contractors, nextCursor }` — no `total` field at all, and the query is `Limit`-bounded (paginated).

This looks fixed only because the test tenant currently has fewer contractors than one page. Once a tenant has more contractors than the page size, the frontend fallback will silently display the **current page's row count** instead of the real total — a believable-looking but wrong number, which is arguably worse than the original "stuck at 0" bug because it won't look broken.

**Recommended follow-up** (not required to close task 6, but worth a fast-follow): add a second `QueryCommand` with `Select: 'COUNT'` (no `Limit`) against the same tenant partition key in `listContractors`, returned as `total`. The existing frontend code needs no further change — `data?.total || ...` will prefer the correct backend value automatically once it exists.

## Task 6/deployment note: code fixes to `api-stack.ts` need an actual deploy to take effect

Live-verified: Bug 6 (`/admin/users`)'s route was added to `infra/lib/api-stack.ts` and `src/services/identity/admin-users.ts` was created, but calling it against the live dev environment still returns **403** — identical symptom to Bug 5. This is expected: CDK source changes don't take effect until `pnpm --filter backend deploy:dev` (or `cdk deploy`) actually runs. Whoever picks up Bug 5's real fix (see above) will see the same "still 403 after the code looks right" result until a deploy happens — that's not a sign the fix is wrong, just that it's pending deployment. Worth deploying once both Bug 5 and Bug 6 are code-complete, then re-verifying both live in one pass.

## Task 9 (Bug 7 — check-in log): actually resolved, and better than the original design

The original `design.md` for this bug assumed the fix would be to populate `worker_name`/`site_name`/`reasons` on the record at write time (inside `recordScanSession(...)` in the check-in handler). Instead, `handleRecentCheckIns` was updated to resolve worker names, site names, and denial reasons **at read time** — batched `GetCommand` lookups by `worker_id`/`site_id`, plus a `DecisionRecords` lookup by `decision_ref` for denial reasons. This is arguably better than the originally-designed approach (no data ever goes stale if a worker/site is renamed later, and it required no change to the check-in write path at all).

Live re-test showed "Unknown Worker" / "Unknown Site" for the three existing test check-in entries — this is most likely because those specific entries reference a `worker_id`/`site_id` that doesn't resolve to a real record (e.g., manually-typed test input during earlier manual testing), which is the correct fallback behavior, not a remaining bug. To confirm with certainty, perform a fresh check-in using a real worker ID from the Workers list and check whether the new entry shows the real name.

## Bug 1 (certification document viewer): confirmed fully resolved

Not part of `admin-portal-audit-fixes`'s own fix list in the same way (this bug is really `.kiro/specs/certification-document-viewer`), but since it was bug 1 in this spec's bugfix.md too: verified live that `CertificationList.tsx` now renders the real `DocumentViewerModal`, `useDocumentUrl.ts` calls the real backend endpoint, and — read directly off the rendered `<iframe>`'s `src` via `javascript_tool` — the document comes from a genuine S3 signed URL (`...s3.us-east-1.amazonaws.com/certifications/.../sample.pdf`), not a bundled frontend placeholder. The visible "Sample PDF" content is the actual file that was uploaded for that test certification. No further action needed here.

## Bugs 2 and 3 (Site Profile crash / bare "%"): crash fixed, underlying data gap still open

`SiteProfile.tsx` now guards `(data.requiredCerts ?? [])` and `(data.recentActivity ?? [])` — the page no longer crashes to a blank screen. The Sites **list** page's compliance column now shows "N/A" instead of a bare "%". Live-verified both of these.

However, opening an actual site profile (e.g. `/sites/{id}`) still shows empty "Active Workers", "Compliance" (bare "%" again — this specific cell on the **detail** page, `SiteProfile.tsx` line ~98, wasn't given the same "N/A" guard the list page got), and "Contractor" stat cards, because the backend (`handleGetSite` in `packages/backend/src/services/policy/handler.ts`) still never computes/returns `activeWorkers`, `compliancePercent`, or `contractor` — it returns the raw DynamoDB site record as-is. A working per-site compliance calculation already exists and could be reused: the `bySite` loop in `handleComplianceSummary` (`packages/backend/src/services/reporting/handler.ts`, ~lines 824-848), which computes compliance percent from `ScanSessions` allowed/total ratio per site. Extracting that into a shared helper and calling it from `handleGetSite`/`handleListSites` would close this gap — and also fix the Site Profile page's own bare "%" the same way the list page was fixed.
