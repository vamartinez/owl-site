/**
 * Unit tests for the jurisdiction registry and the Ontario O. Reg. 213/91
 * ruleset. Verifies:
 *   - registry resolution + safe fallback to the default jurisdiction
 *   - Ontario rules match the SAME detection/scene vocabulary as BC (parity)
 *   - Ontario query functions behave identically in shape to BC's
 *   - the mapper prompt reflects the resolved jurisdiction
 */

import { describe, it, expect } from 'vitest';
import {
  getJurisdiction,
  listJurisdictions,
  resolveJurisdictionId,
  DEFAULT_JURISDICTION_ID,
} from '../../src/services/regulatory-mapping/jurisdiction-registry.js';
import {
  ONTARIO_JURISDICTION_ID,
  ONTARIO_RULES,
} from '../../src/services/regulatory-mapping/ontario-oreg-213-91-rules.js';
import {
  getCoveredDetectionTypes as bcGetCoveredDetectionTypes,
} from '../../src/services/regulatory-mapping/worksafe-bc-rules.js';
import { WORKSAFE_BC_JURISDICTION_ID } from '../../src/services/regulatory-mapping/types.js';
import { buildRegulatoryMappingPrompt } from '../../src/services/regulatory-mapping/mapper.js';
import { Severity } from '../../src/services/regulatory-mapping/types.js';

describe('jurisdiction registry', () => {
  it('lists both registered jurisdictions', () => {
    const ids = listJurisdictions();
    expect(ids).toContain(WORKSAFE_BC_JURISDICTION_ID);
    expect(ids).toContain(ONTARIO_JURISDICTION_ID);
  });

  it('resolves WorkSafeBC by id', () => {
    const j = getJurisdiction(WORKSAFE_BC_JURISDICTION_ID);
    expect(j.jurisdiction_id).toBe(WORKSAFE_BC_JURISDICTION_ID);
  });

  it('resolves Ontario by id', () => {
    const j = getJurisdiction(ONTARIO_JURISDICTION_ID);
    expect(j.jurisdiction_id).toBe(ONTARIO_JURISDICTION_ID);
  });

  it('falls back to the default jurisdiction for an unknown id', () => {
    expect(getJurisdiction('nonexistent').jurisdiction_id).toBe(DEFAULT_JURISDICTION_ID);
  });

  it('falls back to the default jurisdiction for null/undefined', () => {
    expect(getJurisdiction(null).jurisdiction_id).toBe(DEFAULT_JURISDICTION_ID);
    expect(getJurisdiction(undefined).jurisdiction_id).toBe(DEFAULT_JURISDICTION_ID);
  });

  it('default jurisdiction is WorkSafeBC (backward compatible)', () => {
    expect(DEFAULT_JURISDICTION_ID).toBe(WORKSAFE_BC_JURISDICTION_ID);
  });
});

describe('resolveJurisdictionId (Policy label -> registry id)', () => {
  it('maps BC labels to WorkSafeBC', () => {
    for (const label of ['BC', 'bc', 'British Columbia', 'WorkSafeBC', 'worksafe bc']) {
      expect(resolveJurisdictionId(label)).toBe(WORKSAFE_BC_JURISDICTION_ID);
    }
  });

  it('maps Ontario labels to the Ontario registry id', () => {
    for (const label of ['Ontario', 'ON', 'ont', 'O. Reg. 213/91']) {
      expect(resolveJurisdictionId(label)).toBe(ONTARIO_JURISDICTION_ID);
    }
  });

  it('passes through a canonical registry id unchanged', () => {
    expect(resolveJurisdictionId(ONTARIO_JURISDICTION_ID)).toBe(ONTARIO_JURISDICTION_ID);
    expect(resolveJurisdictionId(WORKSAFE_BC_JURISDICTION_ID)).toBe(WORKSAFE_BC_JURISDICTION_ID);
  });

  it('falls back to the default for unknown/empty labels', () => {
    expect(resolveJurisdictionId('Nova Scotia')).toBe(DEFAULT_JURISDICTION_ID);
    expect(resolveJurisdictionId('')).toBe(DEFAULT_JURISDICTION_ID);
    expect(resolveJurisdictionId(null)).toBe(DEFAULT_JURISDICTION_ID);
    expect(resolveJurisdictionId(undefined)).toBe(DEFAULT_JURISDICTION_ID);
  });
});

describe('Ontario O. Reg. 213/91 ruleset', () => {
  it('has rules', () => {
    expect(ONTARIO_RULES.length).toBeGreaterThan(0);
  });

  it('every rule carries an O. Reg. 213/91 clause reference', () => {
    for (const rule of ONTARIO_RULES) {
      expect(rule.clause).toMatch(/O\. Reg\. 213\/91/);
      expect(rule.suggested_action.length).toBeGreaterThan(0);
      expect(Object.values(Severity)).toContain(rule.default_severity);
    }
  });

  it('has unique rule_ids', () => {
    const ids = ONTARIO_RULES.map((r) => r.rule_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the same detection-type vocabulary as WorkSafeBC (parity)', () => {
    const on = new Set(getJurisdiction(ONTARIO_JURISDICTION_ID).getCoveredDetectionTypes());
    const bc = new Set(bcGetCoveredDetectionTypes());
    // Ontario must cover every detection type BC covers, so no scene loses
    // coverage when a site switches jurisdiction.
    for (const t of bc) {
      expect(on.has(t)).toBe(true);
    }
  });

  it('matches rules for a known detection/scene pair', () => {
    const j = getJurisdiction(ONTARIO_JURISDICTION_ID);
    const rules = j.findApplicableRules('roof_edge', 'roofing');
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.clause.includes('O. Reg. 213/91'))).toBe(true);
  });

  it('returns no rules for an unrelated pair', () => {
    const j = getJurisdiction(ONTARIO_JURISDICTION_ID);
    expect(j.findApplicableRules('helmet', 'nonexistent_scene')).toHaveLength(0);
  });

  it('builds Ontario-specific regulatory context', () => {
    const ctx = getJurisdiction(ONTARIO_JURISDICTION_ID).buildRegulatoryContext('roofing');
    expect(ctx).toMatch(/O\. Reg\. 213\/91/);
  });
});

describe('mapper prompt is jurisdiction-aware', () => {
  it('uses WorkSafeBC by default', () => {
    const prompt = buildRegulatoryMappingPrompt('roofing');
    expect(prompt).toMatch(/WorkSafeBC/);
  });

  it('reflects Ontario when the jurisdiction id is passed', () => {
    const prompt = buildRegulatoryMappingPrompt('roofing', ONTARIO_JURISDICTION_ID);
    expect(prompt).toMatch(/Ontario|213\/91/);
  });
});
