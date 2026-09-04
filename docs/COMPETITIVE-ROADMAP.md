# Competitive Roadmap — Multi-Province & Integrations

Context: competitive/pricing analysis (2026-09-04). Landing-page pricing (#1),
AI-cost packaging (#2) and self-serve trial CTA (#3) are DONE and shipped in
`packages/landing-page`. Below are the two engineering items.

## #4 Multi-province regulatory decoupling — STATUS: scaffold shipped

Done this pass (behavior-preserving, 59/59 regulatory-mapping tests green):
- `packages/backend/src/services/regulatory-mapping/jurisdiction-registry.ts`
  — generic `JurisdictionRule` + `JurisdictionRuleSet`, a `JURISDICTIONS`
  registry keyed by `jurisdiction_id`, `getJurisdiction(id)` with safe
  fallback to `DEFAULT_JURISDICTION_ID` (= WorkSafeBC).
- `mapper.ts` `buildRegulatoryMappingPrompt(sceneType, jurisdictionId?)` now
  resolves the ruleset via the registry and injects `display_name` +
  province-specific context instead of hard-coded "WorkSafeBC".

Remaining to actually support a 2nd province:
1. ~~Decide target~~ DONE — **Ontario O. Reg. 213/91** authored & registered
   (`ontario-oreg-213-91-rules.ts`, id `ontario-oreg-213-91`), 15 tests green,
   detection/scene vocab at parity with BC (parity test enforces it).
2. ~~Author `<province>-rules.ts`~~ DONE for Ontario.
3. ~~Register it in `JURISDICTIONS`~~ DONE.
4. ~~Thread the site's `jurisdiction_id` through the mapper~~ DONE — the
   mapper now reads the Policy's free-text `jurisdiction` (DynamoDB Policies
   table) via `fetchPolicyJurisdiction`, maps it to a registry id with
   `resolveJurisdictionId` (BC/Ontario labels + canonical ids; unknown ->
   default BC), passes it into `buildRegulatoryMappingPrompt` and writes it as
   the output `jurisdiction_id`. 78 tests green. A site set to an Ontario
   jurisdiction label on its policy now runs O. Reg. 213/91 rules LIVE.
5. STILL TODO — admin-portal UI to set a site/policy jurisdiction from a
   dropdown of `listJurisdictions()` (today it's the free-text policy field;
   labels like 'Ontario' / 'BC' resolve correctly, arbitrary text falls back
   to BC). Backend accepts it already.
6. STILL TODO — property tests across all registered jurisdictions.

NOTE (how the AI uses these rules): rules are STATIC TypeScript compiled into
the Lambda bundle, injected into the model's system prompt by code
(`buildRegulatoryContext`) — NOT stored in S3 and NOT retrieved via RAG. This
is deliberately deterministic/audit-grade for COR. `report-validation` uses an
in-memory keyword corpus (`regulatory-corpus.ts`), also not S3. Moving to an
S3/embeddings knowledge base would be separate net-new work.

## #5 Procore / Autodesk integration — STATUS: needs its own spec

Net-new engineering (NOT a same-turn edit). Table-stakes for enterprise.
Scope for a `.kiro/specs/construction-platform-integrations`:
- OAuth2 app registration per provider (Procore, Autodesk Construction Cloud).
- Sync direction: pull projects/sites + workers; push findings/incidents.
- New Lambda service + SQS for async sync; CDK stack additions
  (secrets for provider creds, EventBridge schedule for polling).
- Webhook receiver for provider-side changes.
- Field mapping: our Site <-> provider Project; our Worker <-> provider roster.
- Rate-limit + retry against provider APIs.
