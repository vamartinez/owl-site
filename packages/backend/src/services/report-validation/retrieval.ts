/**
 * Retrieval module for report-validation.
 *
 * Bedrock's RetrieveAndGenerate bundled retrieval over a Knowledge Base with
 * generation in one call. Ollama Cloud's chat API generates only, so retrieval
 * is reimplemented here as an explicit step whose clauses are injected into the
 * generation system prompt.
 *
 * DEFAULT (implemented here): a lightweight, dependency-free keyword retrieval
 * over the built-in WorkSafeBC clause set. It is deterministic and testable and
 * needs no new infrastructure, so the migration is not blocked on an operator
 * decision.
 *
 * EXTENSION POINT (ai-provider-migration Task 4/8, requires operator input): if
 * a self-managed vector store is finalized, replace the body of `retrieveTopK`
 * with an embedding query (Ollama Cloud exposes an embeddings endpoint) against
 * the stored corpus vectors keyed by category prefix. The function signature and
 * the `RetrievedClause` shape are the stable contract the generator depends on;
 * swapping the retrieval backend does not touch validation-engine.ts.
 */

import { REGULATORY_CLAUSES } from './regulatory-corpus.js';

/** A single retrieved regulatory clause injected as generation context. */
export interface RetrievedClause {
  clause_id: string;
  category: string;
  title: string;
  text: string;
}

/** Tokenize a query/clause into lowercased word tokens for keyword scoring. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/**
 * Retrieve the top-k most relevant regulatory clauses for a query.
 *
 * Default backend: keyword overlap scoring against the built-in clause set.
 * Deterministic (stable ordering by score then clause_id), so tests can assert
 * exact retrieval. Returns at most `k` clauses; fewer if the corpus is smaller.
 */
export async function retrieveTopK(
  query: string,
  opts: { k: number }
): Promise<RetrievedClause[]> {
  const queryTokens = new Set(tokenize(query));

  const scored = REGULATORY_CLAUSES.map((clause) => {
    const clauseTokens = tokenize(`${clause.title} ${clause.text}`);
    let overlap = 0;
    for (const t of clauseTokens) {
      if (queryTokens.has(t)) overlap += 1;
    }
    return { clause, score: overlap };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.clause.clause_id.localeCompare(b.clause.clause_id);
  });

  // If nothing matched at all, fall back to the first k clauses so the model
  // still receives regulatory grounding rather than an empty context.
  const anyMatch = scored.some((s) => s.score > 0);
  const selected = (anyMatch ? scored.filter((s) => s.score > 0) : scored).slice(
    0,
    Math.max(0, opts.k)
  );

  return selected.map((s) => s.clause);
}

/**
 * Build the system prompt that injects the retrieved clauses as grounding
 * context for the compliance generation. The user prompt
 * (buildComplianceAnalysisPrompt) is unchanged; this only supplies the
 * regulatory reference material the retrieval step selected.
 */
export function buildRetrievalSystemPrompt(clauses: RetrievedClause[]): string {
  if (clauses.length === 0) {
    return 'You are a British Columbia construction compliance analyst. Analyze the report strictly against WorkSafeBC OHS Regulation, the BC Building Code, and applicable Construction Safety Standards.';
  }

  const context = clauses
    .map(
      (c) => `- [${c.category}] ${c.clause_id} — ${c.title}\n  ${c.text}`
    )
    .join('\n');

  return `You are a British Columbia construction compliance analyst. Use ONLY the following regulatory clauses as your reference material when identifying compliance gaps. Cite the clause id and title in each finding's regulation_references.

Regulatory reference material:
${context}`;
}
