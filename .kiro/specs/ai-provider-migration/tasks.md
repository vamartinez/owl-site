# Implementation Plan: ai-provider-migration

## Overview

Implementation of the migration of every AI inference touchpoint off AWS Bedrock and onto the direct Anthropic Claude API (`@anthropic-ai/sdk`, `https://api.anthropic.com/v1/messages`), authenticated with the platform owner's own `ANTHROPIC_API_KEY`. The work is grounded in the two committed investigation artifacts in this spec directory: `bedrock-inventory.md` (the precise `file:line` touchpoint inventory) and `corpus-token-measurement.md` (the RAG-replacement sizing analysis).

The plan follows the design's central insight: the migration splits into **mechanical, same-shape transport swaps** (detection, scene-understanding, regulatory-mapping — low risk) and **one genuinely architectural change** (report-validation's RAG, which Bedrock bundled via `RetrieveAndGenerate` and the Anthropic Messages API does not). Around those sit the supporting plumbing: a single shared Anthropic client bootstrap, the first non-AWS secret in Secrets Manager, IAM/CDK cleanup, a no-regression accuracy harness, the operator token-measurement gate that finalizes the RAG approach, and the pre-emptive re-targeting of the not-yet-started `worksafebc-pdf-compliance-agent` spec.

The implementation follows the established project patterns: TypeScript throughout, CDK for infrastructure, Lambda handlers, and `fast-check` for property-based tests (the framework already used across the repo). The core discipline is **transport-only change with behavior preserved**: prompts, thresholds, category sets, parsers, and output contracts are untouched; only the client and the model-identifier form change.

This is a standalone spec authored for its own separate implementation pass. The final live-verification/cutover is an operator step and is explicitly **not** a completion gate this plan runs (see Task 12); the accuracy harness captures the Bedrock golden outputs before removal so the "before" side can be replayed.

## Tasks

- [ ] 1. Shared foundation — Anthropic SDK dependency and client bootstrap
  - [x] 1.1 Add the `@anthropic-ai/sdk` dependency to the backend package
    - Add `@anthropic-ai/sdk` (pinned version) to `packages/backend/package.json` dependencies
    - Add `@aws-sdk/client-secrets-manager` if not already present, for runtime secret retrieval
    - Confirm the install resolves and the package builds
    - _Requirements: 1.1, 3.2_

  - [x] 1.2 Create the shared Anthropic client module
    - Create `packages/backend/src/shared/anthropic-client.ts`
    - Implement `getAnthropicClient(): Promise<Anthropic>`, memoized across warm Lambda invocations (single cached client, single point where the key is read)
    - Implement `resolveApiKey()`: return `process.env.ANTHROPIC_API_KEY` when set (strategy A), otherwise read from Secrets Manager via `ANTHROPIC_API_KEY_SECRET_ARN` (strategy B, preferred)
    - Throw a clear error referencing the secret by ARN/name only when neither is configured; never include the key value in errors or logs
    - _Requirements: 3.1, 3.2_

  - [x] 1.3 Write unit tests for the client bootstrap
    - Assert `getAnthropicClient()` memoizes (constructs the client once across repeated calls)
    - Assert it reads the key from env when present, and falls back to Secrets Manager when only the ARN is set
    - Assert it throws a clear, secret-value-free error when neither env nor ARN is configured
    - Assert no code path includes the key value in an error message or log line
    - _Requirements: 3.1, 3.2_

  - [x] 1.4 Write property test for no-key-leak invariant
    - **Property 3: No ANTHROPIC_API_KEY in code or logs** — for any execution path or error condition (success, missing config, secret-retrieval failure), the key value never appears in error messages or captured log output; errors reference the secret by ARN/name only
    - **Validates: Requirements 3.1**

  - [x] 1.5 Write property test for secret-source invariant
    - **Property 4: Secret read only from Secrets Manager** — for any resolution path, the key is obtained solely from the Lambda env (CDK-resolved) or from Secrets Manager, and from no other source
    - **Validates: Requirements 3.1, 3.2**

- [ ] 2. CDK — Secrets Manager secret, grants, env injection, and Bedrock grant removal
  - [x] 2.1 Provision the Anthropic API key secret
    - In `packages/backend/infra/lib/api-stack.ts`, add a new `secretsmanager.Secret` (`AnthropicApiKey`, `secretName: ${prefix}anthropic-api-key`)
    - Set the value out-of-band (console/CLI) — never in code or committed
    - Note in a comment that this is the first non-AWS secret in the codebase
    - _Requirements: 3.1_

  - [x] 2.2 Grant secret read to the four migrated Lambdas
    - Apply `anthropicApiKey.grantRead(fn)` to the detection, scene-understanding, regulatory-mapping, and report-validation Lambdas
    - Confirm this grant is purely additive for detection/scene/regulatory (they have no Bedrock grant today)
    - _Requirements: 3.1_

  - [x] 2.3 Inject the secret into the four Lambda environments (strategy B preferred)
    - Add `ANTHROPIC_API_KEY_SECRET_ARN` (the secret ARN) to each of the four Lambdas via `fn.addEnvironment(...)`, keeping the raw key out of the environment
    - Record the choice of strategy B in a comment; strategy A (`sharedEnv` with resolved value) is the documented alternative
    - _Requirements: 3.2_

  - [x] 2.4 Remove the misplaced `bedrock:InvokeModel` grant
    - Delete the `bedrock:InvokeModel` policy statement on the report-validation Lambda (`api-stack.ts` ~1112-1119, `resources: ['*']`)
    - Confirm no other Lambda carries a Bedrock inference grant that this migration should touch
    - _Requirements: 3.3_

  - [x] 2.5 Confirm the CDK diff shows only the single Bedrock statement removed
    - Run `cdk diff` and confirm the only Bedrock-related removal is the single `bedrock:InvokeModel` statement
    - Confirm no Knowledge Base, data source, S3 Vectors bucket, or BDA project deletion appears (there are none to remove); investigate any unexpected removal before proceeding
    - _Requirements: 3.4_

  - [x] 2.6 Write property test for the infrastructure-removal invariant
    - **Property 6: Only the misplaced Bedrock grant is removed** — assert (against the synthesized template / diff fixture) that exactly one `bedrock:InvokeModel` statement is removed and no KB/S3-Vectors/BDA resource deletion is present
    - **Validates: Requirements 3.3, 3.4**

- [ ] 3. Checkpoint — Ensure foundation and CDK tests pass
  - Ensure the client bootstrap unit/property tests pass and the CDK synth/diff is clean; ask the user if questions arise.

- [ ] 4. Operator gate — finalize the RAG approach from the real corpus token measurement (PREREQUISITE)
  - [ ] 4.1 Provide the operator token-measurement runbook
    - Document the measurement methodology from `corpus-token-measurement.md` §2 as an operator-runnable runbook (enumerate corpus objects under the four category prefixes in the KB documents bucket, count only `synced` documents, extract text, count tokens per document with `messages.countTokens` using the validation model, sum across the corpus)
    - Note this requires live KB access and cannot be run in the sandbox
    - _Requirements: 6.1, 6.2_

  - [ ] 4.2 Record the measured numbers and apply the decision threshold
    - Record the real measured token totals back into `corpus-token-measurement.md`
    - Apply the §4.2 threshold: if the intended static-context subset exceeds ~150–180K tokens (no headroom for report text, prompt, and output within the 200K window), select the self-managed vector store; below that, the prompt-cached subset becomes viable (and additionally requires a product decision to narrow retrieval)
    - Finalize the RAG approach for Requirement 2 based on this evidence, confirming or overriding the provisional default
    - _Requirements: 6.3, 6.4_

  - [ ] 4.3 Publish the finalized RAG-approach decision to the design
    - Record the finalized approach (vector store default vs. prompt-cached subset) in `design.md` so the report-validation implementation (Task 8) and the re-targeting (Task 11) both build against the same decision
    - _Requirements: 6.4, 2.2, 2.3_

- [ ] 5. Migrate detection/detector.ts — vision (InvokeModel → messages.create)
  - [x] 5.1 Swap the vision transport to the Anthropic Messages API
    - In `detection/detector.ts`, replace `BedrockRuntimeClient` + `InvokeModelCommand` + `send` with `getAnthropicClient()` + `client.messages.create({...})`
    - Reuse the existing native image content block (`{ type: 'image', source: { type: 'base64', media_type, data } }`) verbatim
    - Drop `anthropic_version: 'bedrock-2023-05-31'`; use the un-prefixed model id `claude-3-5-sonnet-20241022`
    - Map `system`, `max_tokens`, `temperature` 1:1 from the model config (renamed to `ANTHROPIC_MODEL_CONFIG`); keep `buildDetectionPrompt` and the S3 fetch/resize unchanged
    - Read the response text from `msg.content` (the `{ type: 'text' }` block); keep `parseBedrockResponse` and `filterDetections` unchanged
    - Source `model_version` from `msg.model ?? ANTHROPIC_MODEL_CONFIG.modelId` on both success and failure-record paths
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 4.4_

  - [x] 5.2 Write unit tests for detection request shaping and parsing
    - Assert the `messages.create` argument omits `anthropic_version`, uses the un-prefixed model id, carries the 1:1 `system`/`max_tokens`/`temperature`, and reuses the native image block unchanged
    - Assert `parseBedrockResponse`/`filterDetections` produce identical structure from a captured Anthropic-shaped response, and that `model_version` is populated
    - _Requirements: 1.1, 1.5, 4.4_

- [ ] 6. Migrate scene-understanding/classifier.ts — text (InvokeModel → messages.create)
  - [x] 6.1 Swap the scene-classification transport to the Anthropic Messages API
    - In `scene-understanding/classifier.ts`, replace the Bedrock `InvokeModel` call with `client.messages.create({...})` inside the model-invoking branch only
    - Preserve the no-object short-circuit that skips the model call entirely when no construction-relevant objects are present
    - Drop `anthropic_version`; use the un-prefixed model id (`SCENE_ANTHROPIC_MODEL_CONFIG`, `claude-3-5-sonnet-20241022`); map `system`/`max_tokens`/`temperature` 1:1
    - Keep `buildSceneClassificationPrompt`, `parseBedrockSceneResponse`, and `normalizeClassification` (0.5 threshold, object rules) unchanged
    - Source `model_version` from `msg.model ?? SCENE_ANTHROPIC_MODEL_CONFIG.modelId` on success and failure paths
    - _Requirements: 1.2, 1.4, 1.5, 1.6, 4.4_

  - [x] 6.2 Write unit tests for scene request shaping, short-circuit, and parsing
    - Assert the no-object short-circuit still skips the model call entirely
    - Assert the `messages.create` argument omits `anthropic_version`, uses the un-prefixed model id, and carries the 1:1 params
    - Assert `parseBedrockSceneResponse`/`normalizeClassification` produce identical output and `model_version` is populated
    - _Requirements: 1.2, 1.5, 4.4_

- [ ] 7. Migrate regulatory-mapping/mapper.ts — text (InvokeModel → messages.create)
  - [x] 7.1 Swap the regulatory-mapping transport to the Anthropic Messages API
    - In `regulatory-mapping/mapper.ts`, replace the Bedrock `InvokeModel` call with `client.messages.create({...})` (this is the fourth `InvokeModel` touchpoint; it must not be left on Bedrock)
    - Drop `anthropic_version`; use the un-prefixed model id (`REGULATORY_ANTHROPIC_MODEL_CONFIG`, `claude-3-5-sonnet-20241022`); map `system`/`max_tokens`/`temperature` 1:1
    - Keep `buildRegulatoryMappingPrompt`, `parseBedrockRegulatoryResponse`, and `normalizeAllMappings` unchanged
    - Source `model_version` from `msg.model ?? REGULATORY_ANTHROPIC_MODEL_CONFIG.modelId` on success and on the failure-record fallback
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 4.4_

  - [ ] 7.2 (Optional) Apply prompt caching to the static WorkSafeBC rule context
    - Optionally move the static `worksafe-bc-rules.ts` context into a `system` content block with `cache_control: { type: 'ephemeral' }`, keeping the per-request dynamic instructions in a separate block
    - Ensure this is a transport-only optimization that does not change the assembled prompt content or the service's output
    - _Requirements: 1.7_

  - [x] 7.3 Write unit tests for regulatory-mapping request shaping and parsing
    - Assert the `messages.create` argument omits `anthropic_version`, uses the un-prefixed model id, and carries the 1:1 params
    - Assert `parseBedrockRegulatoryResponse`/`normalizeAllMappings` produce identical output and `model_version` is populated; if caching is applied, assert the assembled content is unchanged
    - _Requirements: 1.3, 1.5, 1.7, 4.4_

- [ ] 8. Migrate report-validation — replace Bedrock RAG with the finalized approach
  - [x] 8.1 Implement retrieval + generation in validation-engine.ts (vector-store default)
    - In `report-validation/validation-engine.ts`, replace the `RetrieveAndGenerateCommand` with a new internal `retrieveTopK(query, { k })` followed by a single `client.messages.create({...})` using the un-prefixed `claude-3-5-haiku-20241022` (the `us-west-2` ARN pin disappears)
    - Inject the retrieved top-k clauses as context via `buildRetrievalSystemPrompt(clauses)`; keep the user prompt (`buildComplianceAnalysisPrompt(extractedText)`) unchanged
    - Keep `parseValidationResponse` and `calculateComplianceScore` unchanged, operating on the returned text
    - If Task 4 finalized the prompt-cached-subset alternative instead, load the scoped static subset with `cache_control: { type: 'ephemeral' }` and skip the vector store; keep the parsers unchanged
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ] 8.2 Implement the self-managed vector store and CDK resources (vector-store default)
    - Stand up the vector store record shape `{ chunk_id, category, source_document_id, embedding, source_text }` keyed by the four category prefixes
    - Provision the vector store and its access grants as new, additive CDK resources in `api-stack.ts`, distinct from the removed Bedrock grant; grant access to the report-validation Lambda and the re-index path
    - This subtask is skipped if the prompt-cached-subset alternative was finalized in Task 4
    - _Requirements: 2.2, 3.5_

  - [x] 8.3 Re-target kb-manager.ts corpus sync
    - Under the vector-store default: replace the Bedrock `StartIngestionJobCommand` in `triggerKBSync()` with an embed/re-index job against the vector store; retain the S3 presigned-upload flow (`generateKBPresignedUploadUrl`) and the `kb-context-documents` DynamoDB metadata/`sync_status` handling
    - Under the prompt-cached-subset alternative: remove `kb-manager.ts` (the KB disappears; the static subset is bundled from a curated source)
    - _Requirements: 2.5_

  - [x] 8.4 Confirm and document the BDA text-extractor decision
    - Confirm `report-validation/text-extractor.ts`'s BDA OCR stays unchanged (it is a document-processing service, not a Claude inference call, and has no Anthropic equivalent)
    - Record the explicit "keep BDA, out of scope" decision (Requirement 2.6 option a) in the design/notes rather than silently assuming removal; leave the Bedrock-free `.docx` path unaffected
    - _Requirements: 2.6_

  - [x] 8.5 Write unit tests for the RAG replacement
    - Assert `retrieveTopK` returns k clauses and the generation call injects them; assert the generation call uses the un-prefixed haiku model id
    - Assert `parseValidationResponse`/`calculateComplianceScore` produce identical structure and scores from the same returned text as before
    - _Requirements: 2.1, 2.4_

- [ ] 9. Checkpoint — Ensure all per-service migration tests pass
  - Ensure the detection, scene, regulatory, and report-validation unit tests pass; ask the user if questions arise.

- [ ] 10. No-regression accuracy harness (before/after comparison)
  - [ ] 10.1 Assemble the fixed sample sets as committed fixtures
    - Commit a fixed set of representative construction-site photos (varied PPE presence, hazards, scene types) for detection/scene
    - Commit a fixed set of sample reports (varied compliance postures) for report-validation
    - _Requirements: 4.1_

  - [ ] 10.2 Capture the Bedrock golden outputs before removal
    - Run each service on the Bedrock path against the fixed sample sets and snapshot the structured outputs (detections + confidences, scene classifications, regulatory mappings + severity, compliance findings + scores) as golden fixtures, so the "before" side can be replayed after Bedrock is removed
    - _Requirements: 4.2_

  - [ ] 10.3 Build the dual-path comparison harness with a tolerance/blocking rule
    - Build a harness that runs the Anthropic path against the same fixed sets and compares structured outputs against the captured Bedrock golden outputs
    - Define the agreed tolerance up front (compare detection sets and score bands, not exact byte equality, given `temperature: 0.1` non-determinism)
    - Treat a material divergence (dropped detections, changed classifications, compliance scores shifted beyond tolerance) as a blocking defect surfaced by the harness, not accepted silently
    - Assert every finding still carries a populated `model_version` sourced from `msg.model`
    - _Requirements: 4.2, 4.3, 4.4_

- [ ] 11. Re-target the worksafebc-pdf-compliance-agent design (before its implementation)
  - [ ] 11.1 Update the worksafebc-pdf-compliance-agent design to the direct Anthropic API
    - Update `.kiro/specs/worksafebc-pdf-compliance-agent/design.md` so its architecture targets the direct Anthropic API instead of extending report-validation's Bedrock KB / `RetrieveAndGenerate` / BDA patterns
    - Mirror the RAG replacement approach finalized in Task 4 so the two specs stay architecturally consistent
    - Inherit the BDA text-extraction decision from Task 8.4 rather than assuming BDA-based extraction
    - Confirm this design update lands before any of that spec's 56 implementation tasks begins
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 12. Property tests for the design's Correctness Properties
  - [ ] 12.1 Write property test for output-contract preservation
    - **Property 1: Output-contract preservation across the provider swap** — for a generated space of mocked Anthropic responses (varied `content` block orderings and model ids), the migrated extraction path yields the same parsed structure the Bedrock path produced for the equivalent body, for detection/scene/regulatory/validation
    - **Validates: Requirements 1.5, 1.6, 2.4**

  - [ ] 12.2 Write property test for model_version always populated
    - **Property 2: model_version always populated** — for any Anthropic response with or without a `model` field, the persisted detection/scene/regulatory record carries a non-empty `model_version` (from `msg.model` or the config fallback)
    - **Validates: Requirements 4.4**

  - [ ] 12.3 Write property test for no remaining Bedrock inference calls
    - **Property 5: No Bedrock inference calls remain on migrated paths** — assert (via static/import inspection of the migrated modules) that no `InvokeModel`, `RetrieveAndGenerate`, or `StartIngestionJob` call remains on detection/scene/regulatory/validation; the only Bedrock dependency that may remain is the explicitly-scoped-out BDA OCR in `text-extractor.ts`
    - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.6**

- [ ] 13. Final checkpoint — Ensure all tests pass
  - Ensure all unit and property tests pass and the accuracy harness is green against the golden fixtures; ask the user if questions arise.

- [ ] 14. Operator cutover note (standalone future step — NOT a completion gate)
  - [ ] 14.1 Document the live-verification/cutover operator step
    - Document the operator cutover: deploy with the secret populated, run the accuracy harness against both providers, resolve any blocking divergence, then confirm removal of the Bedrock grant
    - Record this as a standalone future operator step that this plan does not run and is not gated on; it is executed when the migration is deployed live
    - _Requirements: 4.2, 4.3, 3.3_

## Notes

- Each leaf task references specific requirements for traceability.
- Checkpoints ensure incremental validation across the foundation, per-service migration, and full suite.
- Property-based tests use `fast-check` (the framework already used across the repo), minimum 100 iterations each, and validate the six Correctness Properties from the design: output-contract preservation, model_version populated, no key in logs, secret only from Secrets Manager, no Bedrock calls on migrated paths, and only the misplaced grant removed.
- Unit tests validate specific request-shaping examples and parser equivalence.
- The migration is transport-only: prompts, thresholds, category sets, parsers, and output contracts are preserved; only the client and the model-identifier form change.
- Task 4 (the operator token measurement) is a PREREQUISITE that finalizes the RAG approach and must land before the report-validation RAG implementation (Task 8) and the re-targeting (Task 11).
- The BDA OCR in `text-extractor.ts` is explicitly kept and out of scope (Requirement 2.6 option a); Task 8.4 records this decision rather than silently removing it.
- Task 14 is a standalone future operator step and is deliberately NOT a completion gate this plan runs; the accuracy harness (Task 10) captures Bedrock golden outputs before removal so the "before" side is replayable.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4"] },
    { "id": 4, "tasks": ["2.5", "2.6", "4.1"] },
    { "id": 5, "tasks": ["3", "4.2"] },
    { "id": 6, "tasks": ["4.3", "5.1", "6.1", "7.1"] },
    { "id": 7, "tasks": ["5.2", "6.2", "7.2", "7.3", "8.1"] },
    { "id": 8, "tasks": ["8.2", "8.3", "8.4"] },
    { "id": 9, "tasks": ["8.5", "9"] },
    { "id": 10, "tasks": ["10.1", "10.2", "11.1"] },
    { "id": 11, "tasks": ["10.3", "12.1", "12.2", "12.3"] },
    { "id": 12, "tasks": ["13", "14.1"] }
  ]
}
```
