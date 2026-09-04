# Regulatory Corpus Token Measurement — AI Provider Migration

> **Purpose.** This is the token-measurement step (Task 13.2 of `production-readiness-audit`) for the follow-up spec that migrates all AI inference off AWS Bedrock onto the direct Anthropic Claude API. It answers the RAG-replacement decision from Requirement 12.3 and the inventory's §4.4: **prompt-cache the full regulatory corpus directly in the Claude request (preferred if it fits) vs. stand up a separate lightweight vector store.**
>
> Requirement traced: **12.2** (and feeds 12.3 / Tasks 13.3–13.4).
>
> **⚠️ Headline caveat, stated up front:** the EXACT live token count **cannot be measured in this sandbox**. The corpus is not committed to the repo — it is uploaded as documents into an S3 Knowledge Base bucket at runtime, and there is no CDK-provisioned Knowledge Base or live AWS access here. Everything below is either (a) source-confirmed facts about where the corpus lives, (b) a concrete methodology for an operator to run the real measurement against a live environment, or (c) a **provisional** public-knowledge sizing estimate so the design (13.3/13.4) isn't blocked. **The provisional recommendation MUST be confirmed by the real operator measurement before implementation.**

---

## 1. Where the corpus lives, and why it can't be measured offline

### 1.1 It is uploaded, not committed — confirmed from source

The regulatory corpus (WorkSafeBC OHS Regulation, BC Building Code, Construction Safety Standards, Canada General) is **not** stored in the repository. It is uploaded as document files (PDF / `.docx`) into a dedicated S3 bucket and then ingested into a Bedrock Knowledge Base. The upload flow, confirmed in source:

- **Entry point (UI):** `packages/admin-portal/src/features/report-validation/KnowledgeBaseManager.tsx` — a tenant-admin screen with category options mapping 1:1 to the corpus domains:
  - `worksafebc` → "WorkSafeBC OHS Regulation"
  - `bc-building-code` → "BC Building Code"
  - `safety-standards` → "Construction Safety Standards"
  - `canada-general` → "Canada General"
- **Upload flow (backend):** `packages/backend/src/services/report-validation/kb-manager.ts`
  - `uploadKBDocument()` → `validateKBFileMetadata()` (accepts PDF / `.docx`, max 50 MB per file — `ALLOWED_KB_MIME_TYPES`, `MAX_KB_FILE_SIZE` in `types.ts`) → `generateKBPresignedUploadUrl()` (presigned S3 `PUT`) → stores metadata row in the `kb-context-documents` DynamoDB table with `sync_status: 'pending'` → `triggerKBSync()`.
  - `triggerKBSync()` issues a Bedrock `StartIngestionJobCommand` against `KNOWLEDGE_BASE_ID` + `DATA_SOURCE_ID` so the uploaded doc is chunked, embedded and indexed into the KB's vector store.
  - **Bucket:** `KB_DOCUMENTS_BUCKET = process.env['KB_DOCUMENTS_BUCKET'] ?? 'kb-context-documents'` (`kb-manager.ts:38`).
  - **S3 key layout / category prefixes:** `buildKBDocumentS3Key()` in `report-validation/utils.ts` produces `{category}/{documentId}/{fileName}`, where the category prefix is one of `worksafebc/`, `bc-building-code/`, `safety-standards/`, `canada-general/`. So every corpus document lives under a predictable prefix in the bucket.
- **How it's queried at inference time:** `report-validation/validation-engine.ts` → `RetrieveAndGenerateCommand` (`type: 'KNOWLEDGE_BASE'`) runs retrieval over the whole KB **and** generation in one Bedrock call, using model ARN `anthropic.claude-3-5-haiku-20241022-v1:0` (`us-west-2`). It does not scope retrieval to a single category — it queries the entire indexed corpus.

### 1.2 Why the live token count is not measurable in this sandbox

- **No corpus files in the repo.** A repo-wide search found **no committed PDFs** (`*.pdf`: none) and **no committed full-text** of the WorkSafeBC OHS Regulation, BC Building Code, or Construction Safety Standards. The only regulation-related content in source is:
  - `packages/backend/src/services/regulatory-mapping/worksafe-bc-rules.ts` — a small, hand-curated set of ~11 rule summaries (fall protection, scaffolds, head protection, excavation, etc.) with clause references like `OHS Regulation 11.2`. **This is a compact rule-summary table used by the `regulatory-mapping` service — it is NOT the full regulatory corpus indexed in the KB.** It is a few KB of TypeScript, not the hundreds/thousands of pages of primary regulation text.
  - Category labels and clause-reference strings scattered across prompts (`validation-engine.ts`, `mapper.ts`, `incidents/regulatory-engine.ts`). Again, references, not corpus text.
- **No CDK-provisioned Knowledge Base / bucket in this environment.** Per the 13.1 inventory (`bedrock-inventory.md` §5A): no CDK construct provisions a Bedrock Knowledge Base, data source, S3 Vectors bucket, or the KB documents bucket; `KNOWLEDGE_BASE_ID` / `DATA_SOURCE_ID` / `KB_DOCUMENTS_BUCKET` resolve to code-level empty/default fallbacks. There is no deployed KB to read and no live AWS credentials in this sandbox.

**Net:** the actual corpus content only exists as operator-uploaded S3 objects in a real (dev/prod) AWS account. Measuring its token count is therefore an **operator step requiring live KB access**, not something reproducible offline from the repo.

---

## 2. Measurement methodology (operator step — run against a live environment)

An operator with AWS credentials for the environment that holds the corpus (and an `ANTHROPIC_API_KEY`) can produce the exact count as follows. The intent: enumerate every corpus object in the KB documents bucket, extract its text, count tokens per document with Anthropic's own tokenizer, and sum across the corpus.

### 2.1 Prerequisites
- AWS CLI configured with read access to the account/region holding the KB documents bucket.
- The real bucket name and region. Resolve them from either the Lambda's environment or the CDK/CloudFormation once the KB is actually provisioned:
  ```bash
  # The KB documents bucket name is the KB_DOCUMENTS_BUCKET env var on the report-validation Lambda.
  aws lambda get-function-configuration \
    --function-name <report-validation-fn-name> \
    --query "Environment.Variables.KB_DOCUMENTS_BUCKET" --output text
  ```
  (If unset, it defaults in code to `kb-context-documents` — but confirm the real deployed value.)
- Node.js with `@anthropic-ai/sdk` installed, and `ANTHROPIC_API_KEY` exported. Text-extraction tooling for PDF/`.docx` (e.g. `pdftotext` from poppler, and a `.docx` text extractor).

### 2.2 Step 1 — List every corpus document in the bucket
```bash
# All corpus objects live under the four category prefixes.
for prefix in worksafebc bc-building-code safety-standards canada-general; do
  aws s3 ls "s3://<KB_DOCUMENTS_BUCKET>/${prefix}/" --recursive
done
```
Cross-check against the metadata table for a source of truth on which docs are actually indexed (and their `sync_status`):
```bash
aws dynamodb scan --table-name <env>-kb-context-documents \
  --projection-expression "category,file_name,file_size,sync_status,s3_key"
```
Only count documents whose `sync_status` is `synced` (i.e. actually in the retrieval index) — `pending`/`error` docs are not part of the live corpus the RAG call sees.

### 2.3 Step 2 — Download and extract text from each document
```bash
mkdir -p corpus && cd corpus
aws s3 cp "s3://<KB_DOCUMENTS_BUCKET>/worksafebc/"        ./worksafebc/        --recursive
aws s3 cp "s3://<KB_DOCUMENTS_BUCKET>/bc-building-code/"  ./bc-building-code/  --recursive
aws s3 cp "s3://<KB_DOCUMENTS_BUCKET>/safety-standards/"  ./safety-standards/  --recursive
aws s3 cp "s3://<KB_DOCUMENTS_BUCKET>/canada-general/"    ./canada-general/    --recursive

# Extract text (PDF -> txt). For .docx, use a docx text extractor instead.
find . -name '*.pdf' -print0 | while IFS= read -r -d '' f; do
  pdftotext -layout "$f" "${f%.pdf}.txt"
done
```

### 2.4 Step 3 — Count tokens with Anthropic's token counting API
Use `client.messages.countTokens` so the count reflects the exact tokenizer Claude uses (this is the authoritative number for "will it fit in the context window / prompt cache"). Sum per document and across the corpus:

```js
// count-corpus-tokens.mjs  —  node count-corpus-tokens.mjs ./corpus
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { globSync } from 'glob';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
const MODEL = 'claude-3-5-haiku-20241022'; // match the model used for validation RAG

const files = globSync(`${process.argv[2] ?? './corpus'}/**/*.txt`);
let total = 0;
const perCategory = {};

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const { input_tokens } = await client.messages.countTokens({
    model: MODEL,
    messages: [{ role: 'user', content: text }],
  });
  const category = file.split('/').at(-3) ?? 'unknown';
  perCategory[category] = (perCategory[category] ?? 0) + input_tokens;
  total += input_tokens;
  console.log(`${input_tokens.toString().padStart(9)}  ${file}`);
}

console.table(perCategory);
console.log(`TOTAL corpus tokens: ${total}`);
```

> `messages.countTokens` counts tokens for a request payload without spending generation tokens; it is the correct primitive for sizing static context and prompt-cache blocks. For a very large single document you may need to chunk it into multiple `countTokens` calls and sum, since a single count call still has request-size limits — chunk on section boundaries and add the per-chunk counts.

### 2.5 Step 4 — Interpret against the budget
- Compare `TOTAL` and each `perCategory` subtotal against the working budget in §3.3.
- Record the real numbers back into this document (replacing the provisional estimates in §3) and finalize the recommendation in §4 before design tasks 13.3/13.4 lock in the RAG approach.

---

## 3. Provisional sizing estimate (public knowledge — NOT a measurement)

These are order-of-magnitude estimates from the publicly known size of these documents, provided **only** so the design work isn't blocked waiting on the operator step. They are deliberately conservative and must be replaced by §2's real numbers.

Rule of thumb used: English prose runs roughly **~1.3–1.5 tokens per word**, and a dense regulation/code page holds on the order of **~500–800 words**, i.e. very roughly **~750–1,200 tokens per page**. Regulatory text with heavy clause numbering, tables, and cross-references tends toward the higher end.

| Corpus document | Public scale | Rough page count | Provisional token estimate |
|---|---|---|---|
| **WorkSafeBC OHS Regulation** (+ associated Guidelines/Policies if uploaded) | Large multi-part regulation (Parts 1–33) | ~hundreds of pages (regulation text alone ~500+ pp; far more if Guidelines/Policies included) | **~0.4M – 0.8M tokens** (regulation text); higher with Guidelines |
| **BC Building Code** | Very large multi-volume code | ~thousands of pages (multi-thousand across volumes) | **~2M – 5M+ tokens** |
| **Construction Safety Standards** (e.g. CSA/association standards, site standards) | Varies widely by what's uploaded | tens–hundreds of pages | **~0.1M – 0.5M tokens** |
| **Canada General** (catch-all category) | Varies | unknown | **~0.05M – 0.3M tokens** |
| **TOTAL (provisional)** | — | — | **~2.5M – 6M+ tokens** |

**Claude context window for reference:** Claude models expose a **200K-token** context window. Prompt caching (`cache_control: { type: 'ephemeral' }`) can hold large static context up to the window, but the cached context **plus** the report text **plus** the prompt/instructions **plus** room for the model's output must all fit inside that same 200K window on each call.

**Key takeaway from the provisional numbers:** even the WorkSafeBC OHS Regulation alone plausibly approaches or exceeds a comfortable static-context budget, and the **BC Building Code alone is one-to-two orders of magnitude larger than the entire 200K window**. So the full four-category corpus almost certainly does **not** fit as prompt-cached static context. A meaningful subset (e.g. WorkSafeBC OHSR only, or a curated slice) is the only variant that could plausibly fit — and only the real measurement can confirm it.

---

## 4. Provisional recommendation (MUST be confirmed by the real measurement)

> **This recommendation is provisional and pending the §2 operator measurement.** It is written so design tasks 13.3/13.4 can proceed with a default direction, not as a final decision.

### 4.1 What the code actually needs today
`report-validation/validation-engine.ts` runs `RetrieveAndGenerate` over the **whole** KB (all four categories, no per-category scoping) for every compliance validation. So, as currently written, "what the validation needs" is the entire indexed corpus — which is precisely why the prompt-cache-everything option is unlikely to be viable at the full corpus's provisional size.

### 4.2 Recommendation
1. **Do NOT plan on prompt-caching the full four-category corpus.** At the provisional sizing (§3), the total (~2.5M–6M+ tokens), dominated by the BC Building Code, is far beyond the 200K window. A "load the entire corpus as static cached context" design (inventory §4.4 option **a**) is almost certainly infeasible for the full corpus.
2. **Default to a lightweight self-managed vector store** (inventory §4.4 option **b**) as the RAG replacement for `report-validation`: embed the corpus once, retrieve top-k relevant clauses per report, inject those into a single `messages.create` call to the direct Anthropic API. This preserves current behavior (retrieval over the full corpus) without Bedrock, and keeps the request comfortably inside the window. Reuse `parseValidationResponse()` / `calculateComplianceScore()` on the returned text unchanged.
3. **Consider prompt-caching a *subset* only if the measurement supports it and the product scopes retrieval down.** If the real measurement shows the specific subset actually needed per validation (most likely the **WorkSafeBC OHS Regulation** portion) fits comfortably under ~150–180K tokens *together with* the report text + prompt + output headroom, then prompt-caching that subset (option **a**) becomes attractive: it removes the vector-store infrastructure entirely and is architecturally simpler. This requires a product decision to narrow validation retrieval from "whole KB" to "OHSR subset," plus the measurement confirming the subset fits.
4. **Threshold to decide on (apply to the real numbers):** if the corpus/subset intended for static context exceeds roughly **~150–180K tokens**, it will not prompt-cache comfortably alongside the report text and prompts within the 200K window → choose the vector store. Below that, with margin for the largest expected report + output, prompt-caching the subset is viable.

### 4.3 Cross-references for the design phase
- Inventory §4.4 (RAG replacement options a/b) and §5 (`kb-manager.ts` disappears under option a, becomes a vector re-index under option b).
- Inventory §6 (`text-extractor.ts` BDA OCR) and §7 (`worksafebc-pdf-compliance-agent`) are separate decision points that inherit whichever RAG approach is chosen here.
- The `regulatory-mapping` service's static WorkSafeBC rule summaries (`worksafe-bc-rules.ts`) are small and are already a good candidate for `cache_control` prompt caching in that service's own migrated call — that is unrelated to the large-corpus RAG decision above.

---

## 5. Summary

- **Where the corpus lives:** operator-uploaded PDF/`.docx` files in the S3 `KB_DOCUMENTS_BUCKET` under category prefixes (`worksafebc/`, `bc-building-code/`, `safety-standards/`, `canada-general/`), ingested into a Bedrock Knowledge Base via `kb-manager.ts` → `StartIngestionJob`; queried whole via `RetrieveAndGenerate` in `validation-engine.ts`. **Not committed to the repo.**
- **Why not measurable here:** no corpus files/PDFs in the repo (only a small hand-curated rule-summary table in `worksafe-bc-rules.ts`), and no CDK-provisioned KB / live AWS access in this sandbox. **The precise measurement is an operator step requiring live KB access.**
- **Provisional estimate:** full corpus ~**2.5M–6M+ tokens** (BC Building Code dominant, multi-thousand pages); far beyond the **200K** Claude context window.
- **Provisional recommendation (pending real measurement):** default to a **lightweight self-managed vector store** for `report-validation`'s RAG; prompt-cache only a narrowed subset (likely WorkSafeBC OHSR) **if** the measurement shows it fits under ~150–180K tokens with headroom, which also requires a product decision to scope retrieval down from the current whole-KB query.
