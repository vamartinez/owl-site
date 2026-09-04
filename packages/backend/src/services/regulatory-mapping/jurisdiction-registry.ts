/**
 * Jurisdiction registry — province-agnostic regulatory rule lookup.
 *
 * Decouples the regulatory-mapping pipeline from any single jurisdiction
 * (previously hard-wired to WorkSafeBC). A jurisdiction is a self-contained
 * bundle of rules + the pure functions that query them, keyed by the
 * `jurisdiction_id` that is already threaded through every mapping record.
 *
 * To add a province:
 *   1. Create `<jurisdiction>-rules.ts` exporting a JurisdictionRuleSet.
 *   2. Register it here in JURISDICTIONS.
 * No change to mapper.ts is required — it resolves the ruleset by id.
 */

import type { Severity } from '../../shared/types/common.js';
import type { WorkSafeBCRule } from './types.js';
import {
  WORKSAFE_BC_RULES,
  findApplicableRules as bcFindApplicableRules,
  findRulesForDetections as bcFindRulesForDetections,
  buildRegulatoryContext as bcBuildRegulatoryContext,
  getCoveredDetectionTypes as bcGetCoveredDetectionTypes,
} from './worksafe-bc-rules.js';
import { WORKSAFE_BC_JURISDICTION_ID } from './types.js';
import {
  ONTARIO_JURISDICTION_ID,
  ONTARIO_RULES,
  findApplicableRules as onFindApplicableRules,
  findRulesForDetections as onFindRulesForDetections,
  buildRegulatoryContext as onBuildRegulatoryContext,
  getCoveredDetectionTypes as onGetCoveredDetectionTypes,
} from './ontario-oreg-213-91-rules.js';

/**
 * Generic jurisdiction rule. Structurally identical to WorkSafeBCRule so the
 * existing BC ruleset satisfies it without modification; the `clause` /
 * `section` strings carry the province-specific regulation references.
 */
export interface JurisdictionRule {
  rule_id: string;
  section: string;
  clause: string;
  title: string;
  description: string;
  applicable_detection_types: string[];
  applicable_scene_types: string[];
  default_severity: Severity;
  suggested_action: string;
}

/**
 * A registered jurisdiction: its rules plus the query functions the mapper
 * needs. Bundling the functions (rather than only the data) lets a
 * jurisdiction override matching semantics later if a province needs it.
 */
export interface JurisdictionRuleSet {
  jurisdiction_id: string;
  display_name: string;
  rules: JurisdictionRule[];
  findApplicableRules: (detectionType: string, sceneType: string) => JurisdictionRule[];
  findRulesForDetections: (
    detectionTypes: string[],
    sceneType: string
  ) => Map<string, JurisdictionRule[]>;
  buildRegulatoryContext: (sceneType: string) => string;
  getCoveredDetectionTypes: () => string[];
}

/**
 * WorkSafeBC, adapted to the generic interface. WorkSafeBCRule is
 * structurally assignable to JurisdictionRule, so this is a zero-cost wrap.
 */
const worksafeBc: JurisdictionRuleSet = {
  jurisdiction_id: WORKSAFE_BC_JURISDICTION_ID,
  display_name: 'WorkSafeBC (British Columbia OHS Regulation)',
  rules: WORKSAFE_BC_RULES as JurisdictionRule[],
  findApplicableRules: bcFindApplicableRules as (
    d: string,
    s: string
  ) => JurisdictionRule[],
  findRulesForDetections: bcFindRulesForDetections as (
    d: string[],
    s: string
  ) => Map<string, JurisdictionRule[]>,
  buildRegulatoryContext: bcBuildRegulatoryContext,
  getCoveredDetectionTypes: bcGetCoveredDetectionTypes,
};

/**
 * Ontario O. Reg. 213/91 (Construction Projects). Already authored against the
 * generic JurisdictionRule interface, so no wrapping cast is needed.
 */
const ontario: JurisdictionRuleSet = {
  jurisdiction_id: ONTARIO_JURISDICTION_ID,
  display_name: 'Ontario O. Reg. 213/91 (Construction Projects) — COR-aligned',
  rules: ONTARIO_RULES,
  findApplicableRules: onFindApplicableRules,
  findRulesForDetections: onFindRulesForDetections,
  buildRegulatoryContext: onBuildRegulatoryContext,
  getCoveredDetectionTypes: onGetCoveredDetectionTypes,
};

/**
 * The registry. Add new provinces here.
 */
const JURISDICTIONS: Record<string, JurisdictionRuleSet> = {
  [WORKSAFE_BC_JURISDICTION_ID]: worksafeBc,
  [ONTARIO_JURISDICTION_ID]: ontario,
};

/**
 * Jurisdiction used when a site has no explicit jurisdiction_id set.
 * Preserves current behavior (everything defaults to WorkSafeBC).
 */
export const DEFAULT_JURISDICTION_ID = WORKSAFE_BC_JURISDICTION_ID;

/**
 * Resolve a jurisdiction ruleset by id. Falls back to the default jurisdiction
 * for an unknown/empty id so the pipeline never hard-fails on a mis-set site.
 */
export function getJurisdiction(jurisdictionId?: string | null): JurisdictionRuleSet {
  if (jurisdictionId && JURISDICTIONS[jurisdictionId]) {
    return JURISDICTIONS[jurisdictionId];
  }
  return JURISDICTIONS[DEFAULT_JURISDICTION_ID];
}

/**
 * Map a Policy's free-text `jurisdiction` label (e.g. 'BC', 'British Columbia',
 * 'Ontario') to a registry jurisdiction id. This bridges the existing policy
 * data model — which stores jurisdiction as a human label — to the registry's
 * canonical ids. Unknown/empty labels resolve to the default jurisdiction,
 * preserving prior behavior for every existing BC site.
 *
 * A value that is ALREADY a canonical registry id (e.g. 'ontario-oreg-213-91')
 * is passed through unchanged.
 */
export function resolveJurisdictionId(label?: string | null): string {
  if (!label) return DEFAULT_JURISDICTION_ID;

  // Already a registered canonical id.
  if (JURISDICTIONS[label]) return label;

  const normalized = label.trim().toLowerCase();
  const LABEL_TO_ID: Record<string, string> = {
    bc: WORKSAFE_BC_JURISDICTION_ID,
    'b.c.': WORKSAFE_BC_JURISDICTION_ID,
    'british columbia': WORKSAFE_BC_JURISDICTION_ID,
    worksafebc: WORKSAFE_BC_JURISDICTION_ID,
    'worksafe bc': WORKSAFE_BC_JURISDICTION_ID,
    on: ONTARIO_JURISDICTION_ID,
    ont: ONTARIO_JURISDICTION_ID,
    ontario: ONTARIO_JURISDICTION_ID,
    'o. reg. 213/91': ONTARIO_JURISDICTION_ID,
    'o.reg. 213/91': ONTARIO_JURISDICTION_ID,
    'oreg 213/91': ONTARIO_JURISDICTION_ID,
  };

  return LABEL_TO_ID[normalized] ?? DEFAULT_JURISDICTION_ID;
}

/**
 * List every registered jurisdiction id (for admin UIs / validation).
 */
export function listJurisdictions(): string[] {
  return Object.keys(JURISDICTIONS);
}

/** Ensure a type keeps satisfying the generic contract at compile time. */
export type { WorkSafeBCRule };
