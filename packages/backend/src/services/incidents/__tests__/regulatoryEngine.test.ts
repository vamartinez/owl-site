/**
 * Unit tests for the Regulatory Evaluation Engine.
 *
 * Tests OSHA rules, WorkSafeBC rules, computeDeadline utility,
 * and edge cases (no indicators, unknown jurisdictions).
 */

import { describe, it, expect } from 'vitest';
import { evaluateRegulatory, computeDeadline } from '../regulatory-engine';
import { RegulatoryFlag, RegulatoryIndicators } from '../types';

function makeIndicators(overrides: Partial<RegulatoryIndicators> = {}): RegulatoryIndicators {
  return {
    medical_treatment_beyond_first_aid: false,
    lost_time: false,
    hospitalization: false,
    fatality: false,
    amputation: false,
    loss_of_eye: false,
    structural_collapse: false,
    hazardous_substance_release: false,
    fire_or_explosion: false,
    ...overrides,
  };
}

const INCIDENT_TIME = '2024-06-15T10:00:00.000Z';

describe('computeDeadline', () => {
  it('adds the correct number of hours to a reference time', () => {
    const result = computeDeadline('2024-06-15T10:00:00.000Z', 8);
    expect(result).toBe('2024-06-15T18:00:00.000Z');
  });

  it('handles 0 hours (immediate)', () => {
    const result = computeDeadline('2024-06-15T10:00:00.000Z', 0);
    expect(result).toBe('2024-06-15T10:00:00.000Z');
  });

  it('handles crossing midnight', () => {
    const result = computeDeadline('2024-06-15T22:00:00.000Z', 8);
    expect(result).toBe('2024-06-16T06:00:00.000Z');
  });

  it('handles 72 hours', () => {
    const result = computeDeadline('2024-06-15T10:00:00.000Z', 72);
    expect(result).toBe('2024-06-18T10:00:00.000Z');
  });

  it('handles 24 hours', () => {
    const result = computeDeadline('2024-06-15T10:00:00.000Z', 24);
    expect(result).toBe('2024-06-16T10:00:00.000Z');
  });
});

describe('evaluateRegulatory - No indicators active', () => {
  it('returns internal_only with empty deadlines for OSHA jurisdiction', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators(),
      jurisdiction: 'us_california',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.INTERNAL_ONLY);
    expect(result.deadlines).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
    expect(result.applied_rules).toHaveLength(0);
  });

  it('returns internal_only with empty deadlines for WorkSafeBC jurisdiction', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators(),
      jurisdiction: 'british_columbia',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.INTERNAL_ONLY);
    expect(result.deadlines).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
    expect(result.applied_rules).toHaveLength(0);
  });

  it('returns internal_only for unknown jurisdiction', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ fatality: true }),
      jurisdiction: 'unknown_jurisdiction',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.INTERNAL_ONLY);
    expect(result.deadlines).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
  });
});

describe('evaluateRegulatory - OSHA rules', () => {
  it('fatality triggers 8h deadline and immediately_reportable flag', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ fatality: true }),
      jurisdiction: 'us_california',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);
    expect(result.applied_rules).toContain('OSHA_fatality_8h');
    expect(result.applied_rules).toContain('OSHA_recordable');

    const deadline = result.deadlines.find((d) => d.deadline_hours === 8);
    expect(deadline).toBeDefined();
    expect(deadline!.authority).toBe('OSHA');
    expect(deadline!.deadline_from).toBe('incident_time');
    expect(deadline!.absolute_deadline).toBe('2024-06-15T18:00:00.000Z');

    const suggestion = result.suggestions.find((s) => s.deadline_hours === 8);
    expect(suggestion).toBeDefined();
    expect(suggestion!.urgency).toBe('immediate');
  });

  it('hospitalization triggers 24h deadline and immediately_reportable flag', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ hospitalization: true }),
      jurisdiction: 'us_texas',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);
    expect(result.applied_rules).toContain('OSHA_severe_injury_24h');

    const deadline = result.deadlines.find((d) => d.deadline_hours === 24);
    expect(deadline).toBeDefined();
    expect(deadline!.authority).toBe('OSHA');
    expect(deadline!.deadline_from).toBe('employer_knowledge');
    expect(deadline!.absolute_deadline).toBe('2024-06-16T10:00:00.000Z');
  });

  it('amputation triggers 24h deadline', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ amputation: true }),
      jurisdiction: 'us_new_york',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);
    expect(result.applied_rules).toContain('OSHA_severe_injury_24h');

    const deadline = result.deadlines.find((d) => d.deadline_hours === 24);
    expect(deadline).toBeDefined();
    expect(deadline!.deadline_from).toBe('employer_knowledge');
  });

  it('loss_of_eye triggers 24h deadline', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ loss_of_eye: true }),
      jurisdiction: 'us_florida',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);
    expect(result.applied_rules).toContain('OSHA_severe_injury_24h');
  });

  it('medical_treatment_beyond_first_aid triggers recordable suggestion', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ medical_treatment_beyond_first_aid: true }),
      jurisdiction: 'us_ohio',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.POTENTIALLY_REPORTABLE);
    expect(result.applied_rules).toContain('OSHA_recordable');
    expect(result.deadlines).toHaveLength(0);

    const suggestion = result.suggestions.find((s) => s.urgency === 'informational');
    expect(suggestion).toBeDefined();
    expect(suggestion!.action).toContain('OSHA Form 300');
  });

  it('lost_time triggers recordable suggestion', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ lost_time: true }),
      jurisdiction: 'us_washington',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.POTENTIALLY_REPORTABLE);
    expect(result.applied_rules).toContain('OSHA_recordable');
  });

  it('fatality + hospitalization produces both 8h and 24h deadlines', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ fatality: true, hospitalization: true }),
      jurisdiction: 'us_california',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);
    expect(result.deadlines).toHaveLength(2);
    expect(result.deadlines.some((d) => d.deadline_hours === 8)).toBe(true);
    expect(result.deadlines.some((d) => d.deadline_hours === 24)).toBe(true);
  });

  it('works with jurisdiction "us_state"', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ fatality: true }),
      jurisdiction: 'us_state',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);
    expect(result.applied_rules).toContain('OSHA_fatality_8h');
  });
});

describe('evaluateRegulatory - WorkSafeBC rules', () => {
  it('fatality triggers immediate notification', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ fatality: true }),
      jurisdiction: 'british_columbia',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);
    expect(result.applied_rules).toContain('WorkSafeBC_immediate_notification');

    const deadline = result.deadlines.find((d) => d.deadline_hours === 0);
    expect(deadline).toBeDefined();
    expect(deadline!.authority).toBe('WorkSafeBC');
    expect(deadline!.deadline_from).toBe('incident_time');
    expect(deadline!.absolute_deadline).toBe(INCIDENT_TIME);
  });

  it('structural_collapse triggers immediate notification', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ structural_collapse: true }),
      jurisdiction: 'british_columbia',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);
    expect(result.applied_rules).toContain('WorkSafeBC_immediate_notification');
  });

  it('hazardous_substance_release triggers immediate notification', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ hazardous_substance_release: true }),
      jurisdiction: 'british_columbia',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);
    expect(result.applied_rules).toContain('WorkSafeBC_immediate_notification');
  });

  it('fire_or_explosion triggers immediate notification', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ fire_or_explosion: true }),
      jurisdiction: 'british_columbia',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);
    expect(result.applied_rules).toContain('WorkSafeBC_immediate_notification');
  });

  it('medical_treatment_beyond_first_aid triggers 72h deadline', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ medical_treatment_beyond_first_aid: true }),
      jurisdiction: 'british_columbia',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.POTENTIALLY_REPORTABLE);
    expect(result.applied_rules).toContain('WorkSafeBC_employer_report_72h');

    const deadline = result.deadlines.find((d) => d.deadline_hours === 72);
    expect(deadline).toBeDefined();
    expect(deadline!.authority).toBe('WorkSafeBC');
    expect(deadline!.absolute_deadline).toBe('2024-06-18T10:00:00.000Z');
  });

  it('lost_time triggers 72h deadline', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ lost_time: true }),
      jurisdiction: 'british_columbia',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.POTENTIALLY_REPORTABLE);
    expect(result.applied_rules).toContain('WorkSafeBC_employer_report_72h');

    const deadline = result.deadlines.find((d) => d.deadline_hours === 72);
    expect(deadline).toBeDefined();
  });

  it('fatality + lost_time produces both immediate and 72h deadlines', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({ fatality: true, lost_time: true }),
      jurisdiction: 'british_columbia',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);
    expect(result.deadlines).toHaveLength(2);
    expect(result.deadlines.some((d) => d.deadline_hours === 0)).toBe(true);
    expect(result.deadlines.some((d) => d.deadline_hours === 72)).toBe(true);
  });
});

describe('evaluateRegulatory - Flag priority', () => {
  it('immediately_reportable takes priority over potentially_reportable', () => {
    const result = evaluateRegulatory({
      indicators: makeIndicators({
        fatality: true,
        medical_treatment_beyond_first_aid: true,
      }),
      jurisdiction: 'british_columbia',
      incident_datetime: INCIDENT_TIME,
    });

    expect(result.regulatory_flag).toBe(RegulatoryFlag.IMMEDIATELY_REPORTABLE);
  });
});
