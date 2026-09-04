/**
 * Regulatory Evaluation Engine
 *
 * Pure function that evaluates regulatory rules based on jurisdiction and
 * boolean indicators. No external API calls — just rule evaluation.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import {
  RegulatoryEvaluationInput,
  RegulatoryEvaluationResult,
  RegulatoryDeadline,
  RegulatoryFlag,
  RegulatorySuggestion,
} from './types';

/**
 * Computes an absolute deadline by adding a number of hours to a reference time.
 *
 * @param referenceTime - ISO 8601 datetime string
 * @param hours - Number of hours to add (0 for immediate)
 * @returns ISO 8601 datetime string representing the deadline
 */
export function computeDeadline(referenceTime: string, hours: number): string {
  const date = new Date(referenceTime);
  date.setTime(date.getTime() + hours * 60 * 60 * 1000);
  return date.toISOString();
}

/**
 * Determines if a jurisdiction is a US state (OSHA applies).
 */
function isOshaJurisdiction(jurisdiction: string): boolean {
  return jurisdiction.startsWith('us_') || jurisdiction === 'us_state';
}

/**
 * Determines if a jurisdiction is British Columbia (WorkSafeBC applies).
 */
function isWorkSafeBCJurisdiction(jurisdiction: string): boolean {
  return jurisdiction === 'british_columbia';
}

/**
 * Evaluates OSHA regulatory rules for US jurisdictions.
 *
 * Rules:
 * - Fatality → 8h deadline from incident_time, flag = immediately_reportable
 * - Hospitalization/amputation/loss_of_eye → 24h deadline from employer_knowledge
 * - Medical treatment beyond first aid / lost time → OSHA recordable (informational)
 */
function evaluateOshaRules(
  input: RegulatoryEvaluationInput
): {
  suggestions: RegulatorySuggestion[];
  deadlines: RegulatoryDeadline[];
  applied_rules: string[];
  maxFlag: RegulatoryFlag;
} {
  const suggestions: RegulatorySuggestion[] = [];
  const deadlines: RegulatoryDeadline[] = [];
  const applied_rules: string[] = [];
  let maxFlag: RegulatoryFlag = RegulatoryFlag.INTERNAL_ONLY;

  const { indicators, incident_datetime } = input;

  // Rule: Fatality → 8h deadline from incident_time
  if (indicators.fatality) {
    applied_rules.push('OSHA_fatality_8h');
    maxFlag = RegulatoryFlag.IMMEDIATELY_REPORTABLE;

    suggestions.push({
      authority: 'OSHA',
      action: 'Report fatality to OSHA within 8 hours of the incident',
      urgency: 'immediate',
      deadline_hours: 8,
      rule_reference: '29 CFR 1904.39(a)(1)',
    });

    deadlines.push({
      authority: 'OSHA',
      deadline_hours: 8,
      deadline_from: 'incident_time',
      absolute_deadline: computeDeadline(incident_datetime, 8),
      description: 'OSHA fatality notification deadline (8 hours from incident)',
    });
  }

  // Rule: Hospitalization/amputation/loss_of_eye → 24h deadline from employer_knowledge
  if (indicators.hospitalization || indicators.amputation || indicators.loss_of_eye) {
    const triggerReasons: string[] = [];
    if (indicators.hospitalization) triggerReasons.push('hospitalization');
    if (indicators.amputation) triggerReasons.push('amputation');
    if (indicators.loss_of_eye) triggerReasons.push('loss of eye');

    applied_rules.push('OSHA_severe_injury_24h');

    if (maxFlag !== RegulatoryFlag.IMMEDIATELY_REPORTABLE) {
      maxFlag = RegulatoryFlag.IMMEDIATELY_REPORTABLE;
    }

    suggestions.push({
      authority: 'OSHA',
      action: `Report ${triggerReasons.join(', ')} to OSHA within 24 hours of employer knowledge`,
      urgency: 'within_deadline',
      deadline_hours: 24,
      rule_reference: '29 CFR 1904.39(a)(2)',
    });

    deadlines.push({
      authority: 'OSHA',
      deadline_hours: 24,
      deadline_from: 'employer_knowledge',
      absolute_deadline: computeDeadline(incident_datetime, 24),
      description: `OSHA severe injury notification deadline (24 hours from employer knowledge): ${triggerReasons.join(', ')}`,
    });
  }

  // Rule: Medical treatment beyond first aid / lost time → OSHA recordable
  if (indicators.medical_treatment_beyond_first_aid || indicators.lost_time) {
    applied_rules.push('OSHA_recordable');

    if (maxFlag === RegulatoryFlag.INTERNAL_ONLY) {
      maxFlag = RegulatoryFlag.POTENTIALLY_REPORTABLE;
    }

    suggestions.push({
      authority: 'OSHA',
      action: 'Consider recording on OSHA Form 300 and Form 301',
      urgency: 'informational',
      rule_reference: '29 CFR 1904.7',
    });
  }

  // Requirement 6.5: Any of the severe indicators also trigger recordability suggestion
  if (
    indicators.hospitalization ||
    indicators.fatality ||
    indicators.amputation ||
    indicators.loss_of_eye
  ) {
    // Only add recordable rule if not already added by medical_treatment/lost_time
    if (!applied_rules.includes('OSHA_recordable')) {
      applied_rules.push('OSHA_recordable');

      suggestions.push({
        authority: 'OSHA',
        action: 'Consider recording on OSHA Form 300 and Form 301',
        urgency: 'informational',
        rule_reference: '29 CFR 1904.7',
      });
    }
  }

  return { suggestions, deadlines, applied_rules, maxFlag };
}

/**
 * Evaluates WorkSafeBC regulatory rules for British Columbia jurisdiction.
 *
 * Rules:
 * - Fatality/structural_collapse/hazardous_substance_release/fire_or_explosion → immediate (0h)
 * - Medical treatment beyond first aid / lost time → 72h deadline
 */
function evaluateWorkSafeBCRules(
  input: RegulatoryEvaluationInput
): {
  suggestions: RegulatorySuggestion[];
  deadlines: RegulatoryDeadline[];
  applied_rules: string[];
  maxFlag: RegulatoryFlag;
} {
  const suggestions: RegulatorySuggestion[] = [];
  const deadlines: RegulatoryDeadline[] = [];
  const applied_rules: string[] = [];
  let maxFlag: RegulatoryFlag = RegulatoryFlag.INTERNAL_ONLY;

  const { indicators, incident_datetime } = input;

  // Rule: Fatality/structural_collapse/hazardous_substance_release/fire_or_explosion → immediate
  const immediateIndicators: { key: keyof typeof indicators; label: string }[] = [
    { key: 'fatality', label: 'fatality' },
    { key: 'structural_collapse', label: 'structural collapse' },
    { key: 'hazardous_substance_release', label: 'hazardous substance release' },
    { key: 'fire_or_explosion', label: 'fire or explosion' },
  ];

  const activeImmediateIndicators = immediateIndicators.filter(
    (ind) => indicators[ind.key]
  );

  if (activeImmediateIndicators.length > 0) {
    applied_rules.push('WorkSafeBC_immediate_notification');
    maxFlag = RegulatoryFlag.IMMEDIATELY_REPORTABLE;

    const reasons = activeImmediateIndicators.map((ind) => ind.label).join(', ');

    suggestions.push({
      authority: 'WorkSafeBC',
      action: `Immediately notify WorkSafeBC: ${reasons}`,
      urgency: 'immediate',
      deadline_hours: 0,
      rule_reference: 'WorkSafeBC OHS Regulation Section 172',
    });

    deadlines.push({
      authority: 'WorkSafeBC',
      deadline_hours: 0,
      deadline_from: 'incident_time',
      absolute_deadline: computeDeadline(incident_datetime, 0),
      description: `WorkSafeBC immediate notification required: ${reasons}`,
    });
  }

  // Rule: Medical treatment beyond first aid / lost time → 72h deadline
  if (indicators.medical_treatment_beyond_first_aid || indicators.lost_time) {
    applied_rules.push('WorkSafeBC_employer_report_72h');

    if (maxFlag === RegulatoryFlag.INTERNAL_ONLY) {
      maxFlag = RegulatoryFlag.POTENTIALLY_REPORTABLE;
    }

    suggestions.push({
      authority: 'WorkSafeBC',
      action: 'Submit employer report to WorkSafeBC within 72 hours',
      urgency: 'within_deadline',
      deadline_hours: 72,
      rule_reference: 'WorkSafeBC OHS Regulation Section 172',
    });

    deadlines.push({
      authority: 'WorkSafeBC',
      deadline_hours: 72,
      deadline_from: 'incident_time',
      absolute_deadline: computeDeadline(incident_datetime, 72),
      description: 'WorkSafeBC employer report deadline (72 hours from incident)',
    });
  }

  return { suggestions, deadlines, applied_rules, maxFlag };
}

/**
 * Determines the highest priority regulatory flag.
 * Priority: immediately_reportable > potentially_reportable > internal_only
 */
function highestFlag(a: RegulatoryFlag, b: RegulatoryFlag): RegulatoryFlag {
  const priority: Record<RegulatoryFlag, number> = {
    [RegulatoryFlag.INTERNAL_ONLY]: 0,
    [RegulatoryFlag.POTENTIALLY_REPORTABLE]: 1,
    [RegulatoryFlag.IMMEDIATELY_REPORTABLE]: 2,
  };

  return priority[a] >= priority[b] ? a : b;
}

/**
 * Evaluates regulatory rules based on jurisdiction and incident indicators.
 *
 * This is a pure function with no external API calls. It evaluates:
 * - OSHA rules for US jurisdictions (jurisdiction starts with "us_")
 * - WorkSafeBC rules for British Columbia jurisdiction
 *
 * Returns the highest applicable regulatory flag, suggestions for action,
 * computed deadlines, and the list of applied rules.
 *
 * @param input - Regulatory evaluation input containing indicators, jurisdiction, and incident datetime
 * @returns Regulatory evaluation result with flag, suggestions, deadlines, and applied rules
 */
export function evaluateRegulatory(
  input: RegulatoryEvaluationInput
): RegulatoryEvaluationResult {
  let overallFlag: RegulatoryFlag = RegulatoryFlag.INTERNAL_ONLY;
  const allSuggestions: RegulatorySuggestion[] = [];
  const allDeadlines: RegulatoryDeadline[] = [];
  const allAppliedRules: string[] = [];

  if (isOshaJurisdiction(input.jurisdiction)) {
    const oshaResult = evaluateOshaRules(input);
    allSuggestions.push(...oshaResult.suggestions);
    allDeadlines.push(...oshaResult.deadlines);
    allAppliedRules.push(...oshaResult.applied_rules);
    overallFlag = highestFlag(overallFlag, oshaResult.maxFlag);
  }

  if (isWorkSafeBCJurisdiction(input.jurisdiction)) {
    const wsbcResult = evaluateWorkSafeBCRules(input);
    allSuggestions.push(...wsbcResult.suggestions);
    allDeadlines.push(...wsbcResult.deadlines);
    allAppliedRules.push(...wsbcResult.applied_rules);
    overallFlag = highestFlag(overallFlag, wsbcResult.maxFlag);
  }

  return {
    regulatory_flag: overallFlag,
    suggestions: allSuggestions,
    deadlines: allDeadlines,
    applied_rules: allAppliedRules,
  };
}
