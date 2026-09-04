# Bedrock Touchpoint Inventory — AI Provider Migration

> **Purpose.** This is the INVENTORY step (Task 13.1 of `production-readiness-audit`) for the follow-up spec that migrates all AI inference off AWS Bedrock and onto the direct Anthropic Claude API (`@anthropic-ai/sdk`, `https://api.anthropic.com/v1/messages`). It records every Bedrock touchpoint with `file:line` precision, the exact SDK client/command, model IDs, request/response shape, and the equivalent direct-Anthropic call. **No migration code is written here — inventory only.**
>
> Requirement traced: **12.1**.

---

## 0. Executive summary

- **Code touchpoints: 5 backend services** (one more than the 4 named in Requirement 12.1 — `regulatory-mapping` and the BDA-based `text-extractor` were found via grep and are documented below).
  1. `detection/detector.ts` — vision (Bedrock Runtime `InvokeModel`)
  2. `scene-understanding/classifier.ts` — text (Bedrock Runtime `InvokeModel`)
  3. `regulatory-mapping/mapper.ts` — text (Bedrock Runtime `InvokeModel`) **[newly discovered]**
  4. `report-validation/validation-engine.ts` — RAG (Bedrock Agent Runtime `RetrieveAndGenerate`)
  5. `report-validation/kb-manager.ts` — KB ingestion (Bedrock Agent `StartIngestionJob`)
  - Plus `report-validation/text-extractor.ts` — PDF OCR via **Bedrock Data Automation (BDA)** `InvokeDataAutomationAsync` **[newly discovered; not a Claude call, see §6]**.
- **Model IDs in use:**
  - `anthropic.claude-3-5-sonnet-20241022-v2:0` — detection, scene-understanding, regulatory-mapping (3 services).
  - `anthropic.claude-3-5-haiku-20241022-v1:0` — report-validation RAG (hardcoded ARN, `us-west-2`).
- **RAG / Knowledge Base resources:** Bedrock Knowledge Base + a data source (S3-backed vector index) are referenced **only in code via `process.env`** (`KNOWLEDGE_BASE_ID`, `DATA_SOURCE_ID`, `KB_DOCUMENTS_BUCKET`). **No CDK resource provisions a Knowledge Base, a data source, an S3 Vectors bucket, or a BDA project** in `packages/backend/infra`. See §5.
- **IAM finding:** the only Bedrock IAM grant in CDK is `bedrock:InvokeModel` on the `report-validation` Lambda (`api-stack.ts:1115`, `resources: ['*']`). The detection/scene/regulatory Lambdas that call `InvokeModel` have **no Bedrock IAM grant at all**, and report-validation is **missing** `bedrock:Retrieve`/`bedrock:RetrieveAndGenerate` and `bedrock:StartIngestionJob` — meaning the RAG/KB paths cannot currently run as deployed. See §5.
- **`worksafebc-pdf-compliance-agent` spec:** exists, **0/56 tasks, not started**, `specType: feature`. Its `design.md` explicitly extends `report-validation`'s Bedrock KB + `RetrieveAndGenerate` + BDA patterns. It **must be re-targeted to the direct Anthropic API before implementation begins**. See §7.

---

## 1. `detection/detector.ts` — Safety PPE/hazard vision detection

**File:** `packages/backend/src/services/detection/detector.ts`
**Config:** `packages/backend/src/services/detection/types.ts` — `BEDROCK_MODEL_CONFIG` (types.ts:88-92).

### 1.1 SDK client / command
- Import: `BedrockRuntimeClient, InvokeModelCommand` from `@aws-sdk/client-bedrock-runtime` — `detector.ts:11-13`.
- Client instantiated: `const bedrockClient = new BedrockRuntimeClient({});` — `detector.ts:35`.
- Command constructed: `new InvokeModelCommand({...})` — `detector.ts:266`.
- Sent: `await bedrockClient.send(command)` — `detector.ts:273`.

### 1.2 Model ID
- `BEDROCK_MODEL_CONFIG.modelId = 'anthropic.claude-3-5-sonnet-20241022-v2:0'` — `types.ts:90`.
- `maxTokens: 4096`, `temperature: 0.1` — `types.ts:91-92`.
- Referenced at `detector.ts:242-243` (maxTokens/temperature), `detector.ts:267` (modelId), `detector.ts:292` (fallback model version), `detector.ts:437` (model_version on failure record).

### 1.3 Call shape (request)
Vision call. Request body built at `detector.ts:241-265`:
```
{
  anthropic_version: 'bedrock-2023-05-31',   // Bedrock-specific
  max_tokens, temperature,
  system: buildDetectionPrompt(),            // detector.ts:48 — lists SAFETY_OBJECT_CATEGORIES, demands strict JSON
  messages: [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type, data: imageBase64 } },  // image block
      { type: 'text', text: 'Analyze this construction site image...' }
    ]
  }]
}
```
- Image is fetched from S3 and base64-encoded: `fetchImageFromS3()` — `detector.ts:210-228`.
- Images resized to max 1024px longest edge (`MAX_IMAGE_DIMENSION`, `types.ts` / `calculateResizeDimensions` `detector.ts:89-104`).

### 1.4 Response parsing
- Decode: `JSON.parse(new TextDecoder().decode(response.body))` — `detector.ts:275`.
- Extract text block: `responseBody.content?.find(b => b.type === 'text')` — `detector.ts:279-281`.
- `parseBedrockResponse(text)` strips markdown fences and `JSON.parse`s to `{ detections: [...] }` — `detector.ts:156-176`.
- `filterDetections()` validates category + confidence ≥ 0.5 — `detector.ts:184-210`.
- `modelVersion = responseBody.model ?? BEDROCK_MODEL_CONFIG.modelId` — `detector.ts:292` → persisted as `model_version` on `DetectionRecord`.

### 1.5 Equivalent direct Anthropic Messages API call (note only — do not implement)
- Package: `@anthropic-ai/sdk`; `new Anthropic({ apiKey })` → `client.messages.create({...})`.
- **Drop** `anthropic_version: 'bedrock-2023-05-31'` (Bedrock-only); Anthropic SDK sets its own version header.
- `model: 'claude-3-5-sonnet-20241022'` (Anthropic uses the un-prefixed, no `-v2:0` id).
- `system`, `max_tokens`, `temperature` map 1:1.
- Image content block is already in Anthropic's native shape: `{ type: 'image', source: { type: 'base64', media_type, data } }` — **no change needed**.
- Response: read `msg.content` array, find `{ type: 'text' }`, `msg.content[i].text`; `model_version` ← `msg.model`. Reuse the existing `parseBedrockResponse`/`filterDetections` on that text unchanged.

---

## 2. `scene-understanding/classifier.ts` — scene classification (text-only)

**File:** `packages/backend/src/services/scene-understanding/classifier.ts`
**Config:** `packages/backend/src/services/scene-understanding/types.ts` — `SCENE_BEDROCK_MODEL_CONFIG`.

### 2.1 SDK client / command
- Import: `BedrockRuntimeClient, InvokeModelCommand` from `@aws-sdk/client-bedrock-runtime` — `classifier.ts:11-13`.
- Client: `const bedrockClient = new BedrockRuntimeClient({});` — `classifier.ts:33`.
- Command: `new InvokeModelCommand({...})` — `classifier.ts:319`; sent `classifier.ts:326`.

### 2.2 Model ID
- `SCENE_BEDROCK_MODEL_CONFIG.modelId = 'anthropic.claude-3-5-sonnet-20241022-v2:0'`, `maxTokens: 4096`, `temperature: 0.1` — `types.ts` (`SCENE_BEDROCK_MODEL_CONFIG` block).
- Referenced at `classifier.ts:303-304, 320, 342, 416, 488` (config, modelId, fallback, no-object short-circuit, failure record).

### 2.3 Call shape (request)
Text-only (no image). Request body at `classifier.ts:302-318`:
```
{
  anthropic_version: 'bedrock-2023-05-31',
  max_tokens, temperature,
  system: buildSceneClassificationPrompt(),        // classifier.ts:80 — closed set of scene_types, strict JSON
  messages: [{ role: 'user', content: [{ type: 'text', text: buildClassificationUserMessage(detections) }] }]
}
```
- The user message is a text summary of prior detection results (`buildClassificationUserMessage`, `classifier.ts:145-166`), not an image.
- **Short-circuit:** if no construction-relevant objects, the Bedrock call is skipped entirely (`classifier.ts:405`).

### 2.4 Response parsing
- Decode `classifier.ts:327`; find text block `classifier.ts:330-333`.
- `parseBedrockSceneResponse()` — `classifier.ts:165-192` — strips fences, validates `scene_type`/`confidence`.
- `normalizeClassification()` — `classifier.ts:201` — applies confidence threshold (0.5) and construction-object rules.
- `modelVersion = responseBody.model ?? SCENE_BEDROCK_MODEL_CONFIG.modelId` — `classifier.ts:342`.

### 2.5 Equivalent direct Anthropic call (note only)
- `client.messages.create({ model: 'claude-3-5-sonnet-20241022', system, max_tokens, temperature, messages: [{ role:'user', content: userMessage }] })`.
- Drop `anthropic_version`. `content` may be a plain string for text-only. Response text via `msg.content[].text`; `model_version` ← `msg.model`. Existing `parseBedrockSceneResponse`/`normalizeClassification` reusable on the text.

---

## 3. `regulatory-mapping/mapper.ts` — WorkSafeBC regulation mapping (text-only) [newly discovered]

**File:** `packages/backend/src/services/regulatory-mapping/mapper.ts`
**Config:** `packages/backend/src/services/regulatory-mapping/types.ts` — `REGULATORY_BEDROCK_MODEL_CONFIG` (types.ts:158-162).

> Not named in Requirement 12.1's list but is a fourth `InvokeModel` touchpoint and must be migrated alongside detection/scene.

### 3.1 SDK client / command
- Import: `BedrockRuntimeClient, InvokeModelCommand` from `@aws-sdk/client-bedrock-runtime` — `mapper.ts:10-12`.
- Client: `const bedrockClient = new BedrockRuntimeClient({});` — `mapper.ts:35`.
- Command: `new InvokeModelCommand({...})` — `mapper.ts` (in `invokeBedrockMapping`, ~request body block); sent via `bedrockClient.send(command)`.

### 3.2 Model ID
- `REGULATORY_BEDROCK_MODEL_CONFIG.modelId = 'anthropic.claude-3-5-sonnet-20241022-v2:0'`, `maxTokens: 4096`, `temperature: 0.1` — `types.ts:160-162`.
- Fallback `model_version` on failure record uses the same id (in `mapToRegulations` catch block).

### 3.3 Call shape (request)
Text-only. In `invokeBedrockMapping`:
```
{
  anthropic_version: 'bedrock-2023-05-31',
  max_tokens, temperature,
  system: buildRegulatoryMappingPrompt(sceneType),   // mapper.ts:~115 — injects WorkSafeBC regulatory context (worksafe-bc-rules.ts) + strict JSON schema
  messages: [{ role: 'user', content: [{ type: 'text', text: buildRegulatoryUserMessage(...) }] }]
}
```
- Regulatory context assembled from static rule data in `regulatory-mapping/worksafe-bc-rules.ts` (`buildRegulatoryContext`).

### 3.4 Response parsing
- Decode, find text block, `parseBedrockRegulatoryResponse()` → `{ mappings: [...] }`; `normalizeAllMappings()` maps to findings with severity.
- `modelVersion = responseBody.model ?? REGULATORY_BEDROCK_MODEL_CONFIG.modelId`.

### 3.5 Equivalent direct Anthropic call (note only)
- Same pattern as §2.5: `client.messages.create({ model: 'claude-3-5-sonnet-20241022', system, messages, max_tokens, temperature })`. Drop `anthropic_version`; parse `msg.content[].text` with existing `parseBedrockRegulatoryResponse`. Static WorkSafeBC context in the system prompt is a good candidate for Anthropic `cache_control` prompt caching.

---

## 4. `report-validation/validation-engine.ts` — RAG compliance validation (Knowledge Base)

**File:** `packages/backend/src/services/report-validation/validation-engine.ts`

### 4.1 SDK client / command
- Import: `BedrockAgentRuntimeClient, RetrieveAndGenerateCommand` from `@aws-sdk/client-bedrock-agent-runtime` — `validation-engine.ts:20-23`.
- Client: `const bedrockAgentClient = new BedrockAgentRuntimeClient({});` — `validation-engine.ts:46`.
- Command: `new RetrieveAndGenerateCommand({...})` in `queryKnowledgeBase()` — `validation-engine.ts:128`; sent `validation-engine.ts:141`.
- `KNOWLEDGE_BASE_ID = process.env['KNOWLEDGE_BASE_ID'] ?? ''` — `validation-engine.ts:41`.

### 4.2 Model ID
- Hardcoded ARN: `arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-3-5-haiku-20241022-v1:0` — `validation-engine.ts:135`.
- **Note:** region is pinned to `us-west-2` in this ARN, unlike the `us-east-1` deployment implied elsewhere.

### 4.3 Call shape (request / response)
RAG, not plain model invocation. Request at `validation-engine.ts:128-139`:
```
new RetrieveAndGenerateCommand({
  input: { text: prompt },                 // prompt = buildComplianceAnalysisPrompt(extractedText), validation-engine.ts:82
  retrieveAndGenerateConfiguration: {
    type: 'KNOWLEDGE_BASE',
    knowledgeBaseConfiguration: {
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      modelArn: 'arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-3-5-haiku-20241022-v1:0'
    }
  }
})
```
- Bedrock performs retrieval against the KB **and** generation in one call; the corpus is WorkSafeBC OHS Regulation, BC Building Code, Construction Safety Standards.
- Response: `response.output?.text` — `validation-engine.ts:143-147`; parsed by `parseValidationResponse()` → `{ findings: ComplianceFinding[], summary }` — `validation-engine.ts:246`. Deterministic score via `calculateComplianceScore()`.

### 4.4 Equivalent direct Anthropic call (note only)
- **No drop-in.** `RetrieveAndGenerate` bundles retrieval; the Anthropic Messages API does not retrieve. Two options (Requirement 12.3, decided in Task 13.2):
  - **(a) Preferred if it fits:** load the full regulatory corpus into the request as large static context blocks with `cache_control: { type: 'ephemeral' }` (prompt caching), then `client.messages.create(...)` with model `claude-3-5-haiku-20241022`; eliminates the KB + S3 Vectors dependency entirely.
  - **(b) Otherwise:** stand up a lightweight self-managed vector store (e.g. pgvector / embeddings index), retrieve top-k clauses, inject them into the system/user prompt, then a single `messages.create` call.
- Either way, `parseValidationResponse()` and `calculateComplianceScore()` are reusable on the returned text.

---

## 5. `report-validation/kb-manager.ts` — Knowledge Base document sync

**File:** `packages/backend/src/services/report-validation/kb-manager.ts`

### 5.1 SDK client / command
- Import: `BedrockAgentClient, StartIngestionJobCommand` from `@aws-sdk/client-bedrock-agent` — `kb-manager.ts:11-14`.
- Client: `const bedrockAgentClient = new BedrockAgentClient({});` — `kb-manager.ts:44`.
- Command: `new StartIngestionJobCommand({ knowledgeBaseId, dataSourceId })` in `triggerKBSync()` — `kb-manager.ts:~100`; response `ingestionJob?.ingestionJobId`.
- Env: `KNOWLEDGE_BASE_ID`, `DATA_SOURCE_ID`, `KB_DOCUMENTS_BUCKET` all read from `process.env` with fallbacks — `kb-manager.ts:39-41`.

### 5.2 Model ID
- None — this is ingestion/sync management, not model invocation. Also uses `@aws-sdk/client-s3` `PutObjectCommand`/`DeleteObjectCommand` + `getSignedUrl` for presigned uploads/deletes to the KB documents bucket, and DynamoDB (`kb-context-documents` table) for metadata + sync status.

### 5.3 Call shape
- `uploadKBDocument()`: presign S3 PUT → store metadata (`sync_status: 'pending'`) → `triggerKBSync()`.
- `deleteKBDocument()`: S3 delete → DynamoDB delete → `triggerKBSync()` re-index.
- `triggerKBSync()`: `StartIngestionJob` against the KB data source.

### 5.4 Equivalent direct Anthropic call (note only)
- **No equivalent — this whole module disappears under option 4.4(a)** (prompt caching removes the KB). Under 4.4(b), replace `StartIngestionJob` with an embedding/re-index job against the self-managed vector store; the S3 presigned-upload + DynamoDB metadata parts can remain.

---

## 5A. CDK-provisioned Bedrock / Knowledge Base / S3 Vectors resources + IAM grants

Searched `packages/backend/infra/**` for `bedrock`, `knowledge`/`knowledgebase`/`knowledge_base`, `vector`/`s3vectors`, `RetrieveAndGenerate`, `ingestion`, `ANTHROPIC`, and per-Lambda IAM.

### 5A.1 IAM grants (the only Bedrock IAM in the codebase)
- `packages/backend/infra/lib/api-stack.ts:1113-1119` — on the `report-validation` Lambda:
  ```
  this.reportValidationFn.addToRolePolicy(new PolicyStatement({
    actions: ['bedrock:InvokeModel'],
    resources: ['*'],
  }))
  ```
  - Comment at `api-stack.ts:1112` says "Bedrock InvokeModel (for AI validation scoring)".

### 5A.2 Gaps / findings (important for the migration)
- **No CDK construct provisions a Bedrock Knowledge Base, a data source, an S3 Vectors bucket, or a BDA project.** `KNOWLEDGE_BASE_ID`, `DATA_SOURCE_ID`, `KB_DOCUMENTS_BUCKET`, `BDA_DATA_AUTOMATION_PROJECT_ARN`, `BDA_DATA_AUTOMATION_PROFILE_ARN`, `BDA_OUTPUT_BUCKET`, `REPORT_DOCUMENTS_BUCKET` are **not** in the CDK `sharedEnv` block (`api-stack.ts:112-121`) nor injected into `report-validation` (which uses `environment: sharedEnv` at `api-stack.ts:1097`). They resolve to code-level `''`/default-string fallbacks at runtime. → The RAG/KB/BDA features are coded but **not wired to real infrastructure**; there is little-to-no orphaned Bedrock infra to remove for those.
- **The `bedrock:InvokeModel` grant is on the wrong Lambda for the RAG path.** `validation-engine.ts` uses `RetrieveAndGenerate` (needs `bedrock:Retrieve` / `bedrock:RetrieveAndGenerate`) and `kb-manager.ts` uses `StartIngestionJob` (needs `bedrock:StartIngestionJob`). Neither permission is granted anywhere.
- **The vision/text Lambdas that DO call `InvokeModel` have no Bedrock grant.** `detection-layer` (`api-stack.ts:223`), `scene-understanding` (`api-stack.ts:239`), `regulatory-mapping` (`api-stack.ts:255`) get only `sharedEnv`, DynamoDB, media-bucket read (`api-stack.ts:466-467`), and SQS grants — no `bedrock:InvokeModel`. As deployed they would be denied by IAM if they reached the Bedrock call.
- **Migration implication for CDK (design phase, not now):** the concrete CDK removal is essentially just the single `bedrock:InvokeModel` statement at `api-stack.ts:1113-1119`. New CDK work = a Secrets Manager secret for `ANTHROPIC_API_KEY` + IAM `secretsmanager:GetSecretValue` grants + env injection into detection/scene/regulatory/report-validation Lambdas. `cdk diff` should confirm no Knowledge Base / S3 Vectors / BDA resources are removed (there are none to remove).

---

## 6. `report-validation/text-extractor.ts` — PDF OCR via Bedrock Data Automation (BDA) [newly discovered]

**File:** `packages/backend/src/services/report-validation/text-extractor.ts`

### 6.1 SDK client / command
- Import: `BedrockDataAutomationRuntimeClient, InvokeDataAutomationAsyncCommand, GetDataAutomationStatusCommand` from `@aws-sdk/client-bedrock-data-automation-runtime` — `text-extractor.ts:18-21`.
- Client: `const bdaClient = new BedrockDataAutomationRuntimeClient({});` — `text-extractor.ts:51`.
- Invoke: `new InvokeDataAutomationAsyncCommand({ inputConfiguration:{s3Uri}, outputConfiguration:{s3Uri}, dataAutomationConfiguration:{ dataAutomationProjectArn, stage:'LIVE' }, dataAutomationProfileArn })` — `text-extractor.ts:173-186`.
- Poll: `new GetDataAutomationStatusCommand({ invocationArn })` — `text-extractor.ts:261-264`; polls every 3s up to 60s.
- Config env (all with fallbacks, not CDK-injected): `BDA_DATA_AUTOMATION_PROJECT_ARN`, `BDA_DATA_AUTOMATION_PROFILE_ARN`, `BDA_OUTPUT_BUCKET`, `REPORT_DOCUMENTS_BUCKET` — `text-extractor.ts:33-37`.

### 6.2 Model ID
- None (BDA is a document-processing service, not a Claude model invocation). `.docx` files use `JSZip` XML parsing instead (no Bedrock).

### 6.3 Call shape
- Async OCR/structured-extraction job over a PDF in S3; output written to an S3 URI, then polled for status and read back. `extraction_method: 'bda' | 'docx_parser'`.

### 6.4 Migration note
- **BDA has no Anthropic-API equivalent** (Anthropic has no async document-OCR service). This is a decision point for the follow-up spec: either keep BDA (it is not a Claude call and is arguably out of the "AI inference" migration scope), or replace with client-side/alternative PDF text extraction + optionally send page images to Claude vision for scanned PDFs. **Flag for the design phase — do not assume it's removed.**

---

## 7. `worksafebc-pdf-compliance-agent` spec — Bedrock-based design, not started

**Location:** `.kiro/specs/worksafebc-pdf-compliance-agent/` (`.config.kiro`, `requirements.md`, `design.md`, `tasks.md`).
**Status:** `specType: "feature"`, `workflowType: "requirements-first"`. **56 tasks, 0 completed (0/56) — not started.**

### 7.1 How it depends on Bedrock (from `design.md` / `tasks.md`)
- It is explicitly designed to **extend `report-validation`** and **reuse its Bedrock stack**, not build a new provider:
  - "`text-extractor.ts` already performs PDF text extraction via **Bedrock Data Automation (BDA)**" — `design.md:11`.
  - "`kb-manager.ts` already manages a **Bedrock Knowledge Base** backed by S3 ... handles ... `StartIngestionJobCommand` sync" — `design.md:12`.
  - "`validation-engine.ts` already runs **`RetrieveAndGenerateCommand`** against that Knowledge Base with **Claude 3.5 Haiku**" — `design.md:13`.
  - Architecture diagram nodes: `Bedrock Data Automation`, `Bedrock Knowledge Base`, `Claude 3.5 Haiku via RetrieveAndGenerate` — `design.md:68-70`; sequence step `API->>KB: RetrieveAndGenerate(...)` — `design.md:126`.
  - `tasks.md:5` overview: reuse "BDA extraction, Bedrock Knowledge Base/RAG, and presigned-upload patterns."
  - `tasks.md` 3.1 / 6.2 / 8.5: re-sync via `StartIngestionJobCommand`, "Bedrock invoke (both BDA and KB)", and `RetrieveAndGenerateCommand` scoped to OHSR parts.
  - It also introduces a **new** versioned clause table (`RegulatoryClauses`/`RegulatoryVersions`) as the source of truth, still feeding the Bedrock vector KB (`design.md:18`).

### 7.2 Action for the migration spec
- Because it is 0/56 and unstarted, it must be **re-pointed to the direct Anthropic API before any implementation**, mirroring whichever RAG replacement is chosen in §4.4 (prompt-cached corpus vs. self-managed vector store). Otherwise it would be built against Bedrock KB/`RetrieveAndGenerate`/BDA from day one — exactly the anti-pattern Requirement 12.1 calls out. Its BDA extraction dependency inherits the §6.4 decision.

---

## 8. Consolidated migration checklist (for the design phase — not implemented here)

| # | Touchpoint | file:line | Bedrock API | Model / resource | Direct-Anthropic replacement |
|---|-----------|-----------|-------------|------------------|------------------------------|
| 1 | detection | `detection/detector.ts:266,273` | Runtime `InvokeModel` | `claude-3-5-sonnet-20241022-v2:0` (vision) | `messages.create` with native image block |
| 2 | scene-understanding | `scene-understanding/classifier.ts:319,326` | Runtime `InvokeModel` | `claude-3-5-sonnet-20241022-v2:0` (text) | `messages.create` (text) |
| 3 | regulatory-mapping | `regulatory-mapping/mapper.ts` (`invokeBedrockMapping`) | Runtime `InvokeModel` | `claude-3-5-sonnet-20241022-v2:0` (text) | `messages.create` (text) + prompt cache for rules |
| 4 | report-validation (RAG) | `report-validation/validation-engine.ts:128,135` | Agent Runtime `RetrieveAndGenerate` | `claude-3-5-haiku-20241022-v1:0` (ARN, us-west-2) + KB | prompt-cached corpus **or** self-managed vector + `messages.create` |
| 5 | report-validation (KB sync) | `report-validation/kb-manager.ts` (`triggerKBSync`) | Agent `StartIngestionJob` | KB data source | removed (option a) or vector re-index (option b) |
| 6 | report-validation (OCR) | `report-validation/text-extractor.ts:173,261` | BDA `InvokeDataAutomationAsync` | BDA project (no model) | **decision required** — keep BDA or alt PDF extraction |
| — | IAM grant | `infra/lib/api-stack.ts:1113-1119` | `bedrock:InvokeModel` on report-validation | `resources:['*']` | remove; add Secrets Manager grant for `ANTHROPIC_API_KEY` |
| — | worksafebc spec | `.kiro/specs/worksafebc-pdf-compliance-agent/*` | designed on KB/RAG/BDA | 0/56, not started | re-target to direct API before implementation |
