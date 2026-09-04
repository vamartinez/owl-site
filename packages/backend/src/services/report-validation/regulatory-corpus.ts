/**
 * Regulatory clause corpus for report-validation retrieval.
 *
 * Derived from the single source of truth `WORKSAFE_BC_RULES` (used by the
 * regulatory-mapping service) so the two services stay consistent and the
 * clause text is not duplicated. Each rule becomes a `RetrievedClause` that the
 * retrieval step can score and inject as generation context.
 *
 * When the finalized RAG approach (ai-provider-migration Task 4) stands up a
 * vector store, this static corpus becomes the seed content that is embedded
 * and indexed; the `RetrievedClause` shape is unchanged.
 */

import { WORKSAFE_BC_RULES } from '../regulatory-mapping/worksafe-bc-rules.js';
import type { RetrievedClause } from './retrieval.js';

/** All WorkSafeBC clauses flattened into the retrieval clause shape. */
export const REGULATORY_CLAUSES: RetrievedClause[] = WORKSAFE_BC_RULES.map(
  (rule) => ({
    clause_id: rule.clause,
    category: 'worksafebc',
    title: rule.title,
    text: rule.description,
  })
);
