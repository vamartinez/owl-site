# Competitive-Parity Punch List — Awaiting Product Owner Go/No-Go

> **Status: DECISION PENDING.** This is the consolidated competitive-parity punch list produced by Task 11 (subtasks 11.1–11.4) of the `production-readiness-audit` spec, combined with the three roadmap-scoped items from Requirement 9 (9.5 COR/D&A, 9.6 offline-first, 9.7 template library). It exists so the Product Owner can make a single **go/no-go decision per item** about which gaps become follow-up specs before the next customer-facing milestone.
>
> **No Requirement 9 implementation should start without sign-off on this list.** Several items (COR/D&A, offline-first architecture) are strategic scope decisions, not bugs, and committing engineering to them without a product call would be premature. The investigation work is complete; the build work is explicitly gated on the decisions at the bottom of this document.
>
> Findings below trace to the live/source verification captured in `verification-notes.md` (Tasks 11.1–11.4, 11.3, and 12.5). Requirement text is in `requirements.md` §Requirement 9.

## How to read this

Each item lists:
- **Req ref** — the Requirement 9 acceptance-criterion number.
- **Finding / verdict** — one line on what was actually found.
- **Type** — `Bug/Gap` (something broken or missing that we intended to have) vs `Strategic scope decision` (a product/GTM call, not a defect).
- **Effort** — rough T-shirt size (S / M / L).
- **Priority** — recommended `P0` / `P1` / `P2` / `Roadmap`.

Note on P0: nothing here is a P0 in the sense of "blocks the platform from functioning" — the P0 fixes in this audit are Requirements 1–8. Within the *competitive-parity* scope, the highest recommended priority is P1 (needed to not be disqualified in a competitive eval before the next customer-facing milestone).

## Prioritized punch list

| # | Req | Item | Finding / verdict | Type | Effort | Priority |
|---|-----|------|-------------------|------|--------|----------|
| 1 | 9.8 | Cert-expiry proactive alerting | Machinery exists (30/14/7-day templates + handler + SNS/SQS wiring) but is **never invoked**: the only publisher (`cert-expiry-checker`) is never deployed/scheduled, and its query scans already-expired certs instead of the 30-day-ahead window. Operationally display-only. | Bug/Gap | **S** | **P1** |
| 2 | 9.1 | Live "who's on site now" roster | `LiveAccess` view + `GET /site-access/live` **exist but are a dead scaffold**: no check-out event/endpoint, `ScanSession` has no check_in/out timestamps, `recordScanSession` never writes them, view is unlinked from nav. Roster query never populates. Repair, not net-new build. | Bug/Gap | **M** | **P1** |
| 3 | 9.4 | Corrective-action close-out loop | `/safety-ai/corrective-actions` is **read-only**: no assignment control, no due-date field (missing from backend model entirely), no status-transition-to-closed, no re-inspection close-out. A separate `enforcement` service has resolve/escalate logic but its routes are **not deployed**; two divergent `EnforcementAction` models exist, neither wired to UI. Needs architecture cleanup. | Bug/Gap | **L** | **P1** |
| 4 | 9.3 | Photo annotation / markup on findings | **Does not exist at all**: no annotation UI, no drawing library, no evidence-image rendering in the review flow, and the Finding data model has no markup field. The AI's own bounding-box coordinates aren't even propagated onto findings. Genuine net-new gap. | Bug/Gap | **L** | **P2** |
| 5 | 9.2 | Signature-capture field type | **Genuinely absent** — net-new feature: enum across FE/BE + canvas capture component + signature-image storage + validation. Form-builder supports arbitrary field types, so it slots into existing infrastructure. | Bug/Gap | **M** | **P2** |
| 6 | 9.7 | Customizable inspection template library | Lightweight **product/content** task, not engineering — form-builder already exists; this is authoring 5–10 pre-built BC-relevant starter templates. Improves new-tenant time-to-value. | Strategic scope decision (content) | **S** | **P2** |
| 7 | 9.5 | COR / Drug & Alcohol tracking depth | **Strategic BC go-to-market scope decision**, not a bug. Certifications module tracks generic type/issuer/expiry only. Needs a product call on whether COR audit support + D&A program tracking are in scope for the initial BC launch. | Strategic scope decision | **L** | **Roadmap** |
| 8 | 9.6 | Offline-first mobile capture | **Strategic architecture decision**, not a bug. Admin Portal is online-only; a `sync-service` exists but isn't exercised by the SPA. Note: the just-authored `worker-self-checkin` spec **explicitly scoped offline OUT** for the check-in decision (a stale-compliance safety hazard — deciding site access on stale data is worse than failing closed). | Strategic scope decision | **L** | **Roadmap** |

### Rationale for the ordering

- **P1 (items 1–3)** are the "you'd get disqualified in a competitive eval" gaps that are also *substantially built already* — they're wiring/repair/cleanup rather than greenfield, so the value-to-effort ratio is highest. Cert-expiry alerting (#1) is the single cheapest win (S): deploy an existing Lambda on a schedule + flip the query to a forward-looking window. Live roster (#2) is a headline emergency-muster feature that just needs the check-out half of the lifecycle wired. Corrective-action loop (#3) is a table-stakes "close the loop" capability all five competitors ship, but it's an L because of the two-divergent-models cleanup.
- **P2 (items 4–6)** are genuine net-new features (annotation, signature capture) plus a content task (templates). Valuable for parity but larger lift or lower urgency; sensible for the milestone *after* the P1 repairs land.
- **Roadmap (items 7–8)** are strategic decisions that shouldn't be built on spec authority alone — they need an explicit product/GTM call and, in the offline case, coordinate with a decision already made in `worker-self-checkin`.

## Decision needed from Product Owner (go/no-go per item)

Please give a go/no-go on each. "Go" = authorize a follow-up spec now, before the next customer-facing milestone. "No" = defer to roadmap / not now.

**Proposed to become follow-up specs now (recommend GO):**
1. **9.8 Cert-expiry alerting (P1, S)** — smallest, highest-confidence win. Recommend a tightly-scoped fix spec (or fold into a maintenance batch): deploy `cert-expiry-checker` as a scheduled Lambda + change its query to the 30-day-ahead window + per-worker/per-threshold dedupe. **Go / No-go?**
2. **9.1 Live on-site roster (P1, M)** — recommend a "wire up / repair existing" spec: add check-out event + endpoint, add check_in/out timestamps to `ScanSession`, populate them in `recordScanSession`, link the existing `LiveAccess` view into nav. **Go / No-go?**
3. **9.4 Corrective-action close-out loop (P1, L)** — recommend a spec that *first* resolves the architecture (reconcile the two `EnforcementAction` models, decide whether to deploy the `enforcement` service routes) then adds assignment + due date + status transitions + re-inspection close-out. **Go / No-go?**

**Proposed for the following milestone (recommend GO, but lower priority):**
4. **9.3 Photo annotation on findings (P2, L)** — net-new; also depends on findings actually rendering evidence images in the review flow (currently none do). **Go / No-go / defer to roadmap?**
5. **9.2 Signature-capture field type (P2, M)** — net-new form field type; slots into the existing form-builder. **Go / No-go / defer to roadmap?**
6. **9.7 Inspection template library (P2, S)** — content/product task, minimal engineering. Could be a content deliverable rather than a full spec. **Go / No-go / defer to roadmap?**

**Proposed to defer to roadmap (recommend NO for now — needs a strategic decision, not a build):**
7. **9.5 COR / D&A tracking depth (Roadmap, L)** — needs an explicit BC go-to-market scope call before any spec is authored. **Confirm defer, or elevate?**
8. **9.6 Offline-first mobile capture (Roadmap, L)** — needs an architecture decision; note `worker-self-checkin` already deliberately excluded offline for check-in on safety grounds, so any "go" here should be scoped to *other* capture flows, not check-in. **Confirm defer, or elevate?**

---

**Reminder:** Until the Product Owner signs off on the above, **no Requirement 9 item is to be implemented.** The audit's own P0/P1 bug fixes (Requirements 1–8) proceed independently of this decision; this list governs only the competitive-parity scope.

## Product Owner Decision (recorded)

**Decision date:** 2026-09-03 (recorded at sign-off)

The Product Owner reviewed this punch list and accepted its recommendations as-is. The go/no-go outcomes are recorded below.

### GO NOW — authorize follow-up specs immediately
- **9.8 Cert-expiry proactive alerting** (P1, S)
- **9.1 Live on-site roster** (P1, M)
- **9.4 Corrective-action close-out loop** (P1, L)

### GO NEXT MILESTONE — authorize as follow-up specs for the milestone after the P1 repairs land
- **9.3 Photo annotation on findings** (P2, L)
- **9.2 Signature-capture field type** (P2, M)
- **9.7 Inspection template library** (P2, S — may be a content deliverable rather than a full spec)

### DEFERRED TO ROADMAP — no spec authored yet; revisit with a strategic product/GTM/architecture decision
- **9.5 COR / Drug & Alcohol tracking depth**
- **9.6 Offline-first mobile capture** — note: `worker-self-checkin` already excluded offline for the check-in decision on safety grounds; any future offline work is scoped to OTHER capture flows.

**Note:** The three GO-NOW follow-up specs are authorized but **not yet authored** — creating them is separate future work, not part of this audit spec. This audit's own Requirement 1–8 fixes are unaffected.
