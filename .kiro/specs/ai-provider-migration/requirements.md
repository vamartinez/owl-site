# Requirements Document

## Introduction

This spec migrates **every AI inference touchpoint** in the platform off AWS Bedrock and onto the **direct Anthropic Claude API** (`@anthropic-ai/sdk`, `https://api.anthropic.com/v1/messages`), authenticated with the platform owner's own `ANTHROPIC_API_KEY`. It is the follow-up spec scoped by Requirement 12 of `production-readiness-audit` ("scope now, implement separately"), and it is grounded in two prior investigation artifacts committed to this spec directory:

- **`bedrock-inventory.md`** (Task 13.1) — the precise, `file:line` touchpoint inventory. It confirms **five code touchpoints** (one more than the four named in the parent requirement) plus a Bedrock Data Automation (BDA) OCR dependency:
  1. `detection/detector.ts` — vision (`InvokeModel`, `claude-3-5-sonnet-20241022-v2:0`)
  2. `scene-understanding/classifier.ts` — text (`InvokeModel`, `claude-3-5-sonnet-20241022-v2:0`)
  3. `regulatory-mapping/mapper.ts` — text (`InvokeModel`, `claude-3-5-sonnet-20241022-v2:0`) **[newly discovered — not named in the parent requirement but a real touchpoint]**
  4. `report-validation/validation-engine.ts` — RAG (`RetrieveAndGenerate`, `claude-3-5-haiku-20241022-v1:0`, KB)
  5. `report-validation/kb-manager.ts` — Knowledge Base ingestion (`StartIngestionJob`)
  - Plus `report-validation/text-extractor.ts` — PDF OCR via **BDA** (`InvokeDataAutomationAsync`), which is **not a Claude call** and is a distinct decision point.
- **`corpus-token-measurement.md`** (Task 13.2) — the RAG-replacement sizing analysis. Its headline caveat: the exact corpus token count **cannot be measured in the sandbox** (the corpus is operator-uploaded to S3, not committed to the repo, and there is no CDK-provisioned Knowledge Base). Its **provisional** recommendation: default to a **lightweight self-managed vector store** for `report-validation` RAG (the full four-category corpus is provisionally ~2.5M–6M+ tokens, far beyond Claude's 200K window), and only prompt-cache a narrowed subset if a **real operator measurement** confirms it fits with headroom.

The migration is deliberately scoped to cover the mechanical vision/text swaps (low risk), the one genuinely architectural RAG decision (`report-validation`), the secrets/IAM/CDK plumbing for a first non-AWS secret, a no-regression guarantee, and the pre-emptive re-targeting of the not-yet-started `worksafebc-pdf-compliance-agent` spec so it is never built against the wrong provider.

This document defines requirements only. **No migration code is written here** — implementation is sequenced by the design and tasks that follow.

## Glossary

- **Bedrock**: AWS Bedrock — the current provider for all AI inference, accessed via `@aws-sdk/client-bedrock-runtime` (`InvokeModel`), `@aws-sdk/client-bedrock-agent-runtime` (`RetrieveAndGenerate`), `@aws-sdk/client-bedrock-agent` (`StartIngestionJob`), and `@aws-sdk/client-bedrock-data-automation-runtime` (BDA OCR).
- **Anthropic_API**: The direct Anthropic Claude API at `https://api.anthropic.com/v1/messages`, called via the official `@anthropic-ai/sdk` package's `messages.create` (and `messages.countTokens`) methods.
- **Vision_Services**: The two vision/text `InvokeModel` services whose calls are a same-shape swap — `detection/detector.ts` (vision, image + prompt) and `scene-understanding/classifier.ts` (text-only). Both use `claude-3-5-sonnet-20241022-v2:0`.
- **Regulatory_Mapping_Service**: `packages/backend/src/services/regulatory-mapping/mapper.ts` — a third text-only `InvokeModel` touchpoint discovered during inventory, using `claude-3-5-sonnet-20241022-v2:0`, that maps scene classifications to WorkSafeBC regulations.
- **Report_Validation_Service**: `packages/backend/src/services/report-validation/` — the RAG compliance-validation service. `validation-engine.ts` runs `RetrieveAndGenerate` over the whole Knowledge Base; `kb-manager.ts` manages KB document sync; `text-extractor.ts` performs PDF OCR via BDA.
- **Knowledge_Base** (KB): The Bedrock-managed retrieval index that `validation-engine.ts` queries. Referenced only via `process.env` (`KNOWLEDGE_BASE_ID`, `DATA_SOURCE_ID`, `KB_DOCUMENTS_BUCKET`); **no CDK construct provisions it** in this codebase.
- **BDA**: Bedrock Data Automation — the async document-OCR/structured-extraction service used by `text-extractor.ts`. It is a document-processing service, not a Claude model invocation, and has no direct-Anthropic equivalent.
- **RAG**: Retrieval-Augmented Generation — retrieval of relevant corpus text combined with generation in response to a query. Bedrock's `RetrieveAndGenerate` bundles both; the Anthropic Messages API performs generation only.
- **Regulatory_Corpus**: The WorkSafeBC OHS Regulation, BC Building Code, Construction Safety Standards, and Canada General documents, operator-uploaded to the KB documents S3 bucket under category prefixes. Provisionally sized at ~2.5M–6M+ tokens.
- **Prompt_Caching**: Anthropic's `cache_control: { type: 'ephemeral' }` mechanism for holding large static context blocks across requests, bounded by Claude's 200K-token context window.
- **Self_Managed_Vector_Store**: A lightweight, self-hosted embeddings/retrieval index (e.g. pgvector or an equivalent) that replaces the Bedrock KB retrieval step, feeding top-k clauses into a single `messages.create` call.
- **Secrets_Manager**: AWS Secrets Manager — the store for the `ANTHROPIC_API_KEY`, injected into Lambda environments by CDK.
- **sharedEnv**: The CDK environment map in `packages/backend/infra/lib/api-stack.ts` that injects common environment variables into Lambdas. Today it holds only AWS-native values (`ENVIRONMENT`, `TABLE_PREFIX`, `SNS_TOPIC_ARN`, bucket names, etc.); this migration introduces the first non-AWS secret reference.
- **model_version**: The field already recorded on detection/scene/regulatory findings, currently populated from the Bedrock model config id (`responseBody.model ?? <config>.modelId`), that must continue to be populated post-migration from the Anthropic response's `model` field.
- **worksafebc-pdf-compliance-agent**: A separate spec at `.kiro/specs/worksafebc-pdf-compliance-agent` (`specType: feature`, `workflowType: requirements-first`), **0/56 tasks, not started**, whose `design.md` explicitly extends `report-validation`'s Bedrock KB/`RetrieveAndGenerate`/BDA patterns and must be re-targeted before implementation.

## Requirements

### Requirement 1: Migrate vision and text inference from Bedrock InvokeModel to the direct Anthropic Messages API

**User Story:** As the Product Owner, I want the vision and text AI services (detection, scene-understanding, regulatory-mapping) to call Claude directly through the Anthropic Messages API using our own API key, so that model access, billing, and versioning are controlled directly instead of through Bedrock's provisioning layer, without changing how these services behave.

#### Acceptance Criteria

1. THE migration SHALL replace the Bedrock `InvokeModel` call in `detection/detector.ts` (vision — image content block + text prompt) with an equivalent `@anthropic-ai/sdk` `messages.create` call, mapping `system`, `max_tokens`, and `temperature` 1:1 and reusing the existing native image content block (`{ type: 'image', source: { type: 'base64', media_type, data } }`) unchanged.
2. THE migration SHALL replace the Bedrock `InvokeModel` call in `scene-understanding/classifier.ts` (text-only) with an equivalent `messages.create` call, preserving the existing no-object short-circuit that skips the model call entirely when no construction-relevant objects are present.
3. THE migration SHALL ALSO replace the Bedrock `InvokeModel` call in `regulatory-mapping/mapper.ts` (text-only) with an equivalent `messages.create` call, because the inventory confirmed it is a fourth `InvokeModel` touchpoint that the parent requirement did not name; it SHALL NOT be left on Bedrock.
4. WHEN constructing each migrated request, THE migration SHALL drop the Bedrock-specific `anthropic_version: 'bedrock-2023-05-31'` field (the Anthropic SDK sets its own version header) and use the un-prefixed Anthropic model identifier (`claude-3-5-sonnet-20241022`) in place of the Bedrock model id (`anthropic.claude-3-5-sonnet-20241022-v2:0`).
5. THE migration SHALL preserve every existing structured-output parser and post-processing step unchanged — `parseBedrockResponse`/`filterDetections` (detection), `parseBedrockSceneResponse`/`normalizeClassification` (scene), and `parseBedrockRegulatoryResponse`/`normalizeAllMappings` (regulatory-mapping) — operating on the text extracted from the Anthropic response's `content` array (the `{ type: 'text' }` block).
6. THE migration SHALL NOT alter each service's prompts, confidence thresholds, category sets, or output contract; the only intended change is the transport (Bedrock client → Anthropic SDK) and the model identifier form.
7. WHERE a migrated service embeds large static context in its system prompt (notably `regulatory-mapping`'s WorkSafeBC rule summaries from `worksafe-bc-rules.ts`), THE design MAY apply Anthropic `cache_control` prompt caching to that static block, provided it does not change the service's output.

### Requirement 2: Replace the Bedrock Knowledge Base RAG in report-validation with a Bedrock-free approach

**User Story:** As the Product Owner, I want compliance validation to keep working against the full regulatory corpus without depending on Bedrock Knowledge Bases, so that the report-validation service runs entirely on the direct Anthropic API while preserving its current retrieval-over-the-whole-corpus behavior.

#### Acceptance Criteria

1. THE migration SHALL replace the `RetrieveAndGenerate` call in `report-validation/validation-engine.ts` (which today bundles retrieval over the whole KB with generation using `claude-3-5-haiku-20241022-v1:0`) with a Bedrock-free approach, because the Anthropic Messages API performs generation only and has no drop-in `RetrieveAndGenerate` equivalent.
2. THE migration SHALL adopt a **lightweight self-managed vector store** as the provisional default RAG replacement per `corpus-token-measurement.md` §4: embed the corpus once, retrieve top-k relevant clauses per report, and inject them into a single `messages.create` call using `claude-3-5-haiku-20241022`; this default SHALL be subject to the decision gate in Requirement 6.
3. WHERE the real operator token measurement (Requirement 6) confirms the subset of corpus actually needed per validation fits comfortably under ~150–180K tokens together with the report text, prompt, and output headroom, THE design MAY instead adopt the **prompt-cached subset** alternative (Anthropic `cache_control` on static corpus context, removing the vector store entirely); this alternative additionally requires a product decision to narrow retrieval from "whole KB" to the scoped subset.
4. THE migration SHALL preserve the existing `parseValidationResponse` and `calculateComplianceScore` logic unchanged, operating on the text returned by the Anthropic call, so that finding structure, summary, and the deterministic compliance score are unaffected.
5. THE migration SHALL define the fate of `report-validation/kb-manager.ts`: under the prompt-cached approach it SHALL be removed (the KB disappears); under the self-managed vector store approach its Bedrock `StartIngestionJob` sync SHALL be replaced with an embedding/re-index job against the vector store, while its S3 presigned-upload and DynamoDB metadata handling MAY be retained.
6. THE migration SHALL make an explicit, documented decision on `report-validation/text-extractor.ts`'s BDA OCR dependency: either (a) keep BDA as an out-of-scope document-processing dependency (it is not a Claude inference call), or (b) replace it with alternative PDF text extraction (optionally routing scanned pages through Claude vision); the design SHALL NOT silently assume BDA is removed.

### Requirement 3: Manage ANTHROPIC_API_KEY via AWS Secrets Manager with CDK injection, and remove the misplaced Bedrock IAM grant

**User Story:** As the platform operator, I want the Anthropic API key stored in AWS Secrets Manager and injected into the relevant Lambdas by CDK, following the same infrastructure-managed pattern this codebase already uses for configuration, so that no API key is ever hardcoded and unused Bedrock permissions are cleaned up.

#### Acceptance Criteria

1. THE migration SHALL store the `ANTHROPIC_API_KEY` in AWS Secrets Manager (not hardcoded, not committed) and SHALL grant `secretsmanager:GetSecretValue` on that secret to each Lambda that performs a migrated Anthropic call: detection, scene-understanding, regulatory-mapping, and report-validation.
2. THE migration SHALL make the secret available to those Lambdas via CDK — either by resolving it into the Lambda environment (extending the `sharedEnv` pattern in `packages/backend/infra/lib/api-stack.ts`) or by having each service read it from Secrets Manager at runtime — following the codebase's existing "CDK injects configuration into Lambdas" convention documented in the README's "Variables de Entorno" section, noting this is the first non-AWS secret introduced.
3. THE migration SHALL remove the now-misplaced `bedrock:InvokeModel` IAM grant on the report-validation Lambda (`api-stack.ts` ~1113-1119, `resources: ['*']`), which the inventory confirmed is attached to the wrong Lambda for the RAG path (which used `RetrieveAndGenerate`, never granted) and unused by the vision/text services (which have no Bedrock grant at all).
4. THE migration SHALL confirm via `cdk diff` that the only Bedrock-related infrastructure removed is the single `bedrock:InvokeModel` statement, since the inventory found **no** CDK-provisioned Knowledge Base, data source, S3 Vectors bucket, or BDA project to remove (they resolve to code-level env fallbacks today).
5. WHERE the self-managed vector store approach (Requirement 2) is chosen, THE migration SHALL provision the corresponding CDK infrastructure (e.g. the vector store and its access grants) as new resources, distinct from the removed Bedrock grant.

### Requirement 4: Guarantee no silent regression in detection and validation quality from the provider swap

**User Story:** As the Product Owner, I want assurance that switching from Bedrock to the direct Anthropic API does not silently degrade detection or compliance-validation quality, so that the migration is a transport change and not an accuracy regression.

#### Acceptance Criteria

1. THE migration SHALL define a fixed, representative sample set for a before/after comparison, covering detection/scene inputs (a fixed set of sample construction-site photos) and report-validation inputs (a fixed set of sample reports).
2. THE migration SHALL run each service against that fixed sample set on both the pre-migration (Bedrock) and post-migration (Anthropic) paths and compare the structured outputs — detections and confidences, scene classifications, regulatory mappings, and compliance findings/scores.
3. THE migration SHALL treat a material divergence in that comparison (e.g. dropped detections, changed classifications, or shifted compliance scores beyond an agreed tolerance) as a blocking defect to investigate and resolve before the migration is considered complete, rather than accepting it silently.
4. THE migration SHALL continue to populate the `model_version` field on every finding, now sourced from the Anthropic response's `model` field (falling back to the configured Anthropic model id), preserving the field's existing presence and semantics on detection, scene, and regulatory records.

### Requirement 5: Re-target the worksafebc-pdf-compliance-agent spec design before it is implemented

**User Story:** As the Product Owner, I want the not-yet-started worksafebc-pdf-compliance-agent spec updated to target the direct Anthropic API from the start, so that it is never built against Bedrock and does not require a second migration immediately after being implemented.

#### Acceptance Criteria

1. THE migration SHALL update `.kiro/specs/worksafebc-pdf-compliance-agent/design.md` (currently 0/56 tasks, not started) so its architecture targets the direct Anthropic API instead of extending `report-validation`'s Bedrock KB, `RetrieveAndGenerate`, and BDA patterns.
2. THE updated design SHALL mirror whichever RAG replacement approach is selected in Requirement 2 (self-managed vector store as the provisional default, or prompt-cached subset), so the two specs stay architecturally consistent.
3. THE updated design SHALL inherit the BDA text-extraction decision made in Requirement 2.6, rather than assuming BDA-based extraction.
4. THE migration SHALL make this design update a prerequisite that lands **before** any `worksafebc-pdf-compliance-agent` implementation task begins, since fixing it at the design stage is cheaper than building on Bedrock and migrating later.

### Requirement 6: The exact corpus token measurement is a prerequisite operator step for finalizing the RAG approach

**User Story:** As the platform operator, I want the real regulatory-corpus token count measured against a live environment before the RAG approach is locked in, so that the choice between a self-managed vector store and a prompt-cached subset is based on a real measurement rather than a provisional estimate.

#### Acceptance Criteria

1. THE migration SHALL treat the exact corpus token count as an **operator step requiring live KB access**, because `corpus-token-measurement.md` confirmed the corpus is operator-uploaded to S3 (not committed to the repo) and cannot be measured in the sandbox.
2. THE operator SHALL run the measurement methodology defined in `corpus-token-measurement.md` §2 — enumerate corpus objects under the category prefixes in the KB documents bucket (counting only `synced` documents), extract their text, and count tokens per document with Anthropic's `messages.countTokens` using the validation model, then sum across the corpus.
3. THE migration SHALL apply the decision threshold from `corpus-token-measurement.md` §4.2: if the corpus/subset intended for static context exceeds ~150–180K tokens (leaving no headroom for the report text, prompt, and output within the 200K window), the self-managed vector store SHALL be chosen; below that, the prompt-cached subset becomes viable.
4. THE migration SHALL record the real measured numbers back into the analysis and finalize the RAG approach (Requirement 2) based on them, so that the provisional default is either confirmed or overridden by evidence before implementation of the RAG replacement proceeds.
