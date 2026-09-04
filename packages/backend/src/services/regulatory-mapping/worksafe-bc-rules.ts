/**
 * WorkSafeBC OHS Regulation reference data for regulatory mapping.
 * Contains BC construction safety regulations relevant to AI detection categories.
 *
 * Requirement 8.5: WorkSafeBC as initial jurisdiction rule set.
 *
 * These rules are used both as structured reference data for the mapper
 * and as context for the Bedrock system prompt.
 */

import { Severity } from '../../shared/types/common.js';
import type { WorkSafeBCRule } from './types.js';

/**
 * WorkSafeBC OHS Regulation rules applicable to construction site safety.
 * Each rule maps detection types and scene types to specific regulation clauses.
 */
export const WORKSAFE_BC_RULES: WorkSafeBCRule[] = [
  // --- Fall Protection ---
  {
    rule_id: 'wsbc-11.2',
    section: 'Part 11',
    clause: 'OHS Regulation 11.2',
    title: 'Fall Protection Required',
    description:
      'A worker must be protected from falling where the worker could fall 3 m (10 ft) or more, or where a fall from a lesser height could result in serious injury.',
    applicable_detection_types: ['harness', 'roof_edge', 'scaffold'],
    applicable_scene_types: ['work_at_height', 'roofing', 'ladder_access'],
    default_severity: Severity.CRITICAL,
    suggested_action:
      'Immediately stop work at height. Ensure all workers are equipped with fall protection systems (guardrails, safety nets, or personal fall arrest systems) before resuming elevated work.',
  },
  {
    rule_id: 'wsbc-11.3',
    section: 'Part 11',
    clause: 'OHS Regulation 11.3',
    title: 'Fall Protection System Selection',
    description:
      'The employer must ensure that a fall protection system appropriate for the work is used, considering guardrails, safety nets, personal fall protection systems, or other fall protection systems.',
    applicable_detection_types: ['harness', 'scaffold', 'roof_edge'],
    applicable_scene_types: ['work_at_height', 'roofing'],
    default_severity: Severity.HIGH,
    suggested_action:
      'Review and implement appropriate fall protection system for the specific work activity. Document the fall protection plan and ensure workers are trained on proper use.',
  },
  // --- Scaffolding ---
  {
    rule_id: 'wsbc-13.1',
    section: 'Part 13',
    clause: 'OHS Regulation 13.1',
    title: 'Scaffold General Requirements',
    description:
      'Scaffolds must be designed, constructed, and used so that they are capable of supporting the loads likely to be applied. Guardrails required on open sides and ends.',
    applicable_detection_types: ['scaffold'],
    applicable_scene_types: ['work_at_height'],
    default_severity: Severity.HIGH,
    suggested_action:
      'Inspect scaffold for structural integrity, proper guardrails on all open sides, and adequate load capacity. Tag scaffold as inspected before allowing worker access.',
  },
  // --- Ladders ---
  {
    rule_id: 'wsbc-13.18',
    section: 'Part 13',
    clause: 'OHS Regulation 13.18',
    title: 'Ladder Safety Requirements',
    description:
      'Ladders must be inspected before use, placed on firm level surfaces, secured against displacement, and extend at least 1 m above the landing surface.',
    applicable_detection_types: ['ladder'],
    applicable_scene_types: ['ladder_access', 'work_at_height'],
    default_severity: Severity.MEDIUM,
    suggested_action:
      'Verify ladder is on firm level surface, secured at top and bottom, extends 1 m above landing, and worker maintains 3-point contact. Remove damaged ladders from service.',
  },
  // --- Personal Protective Equipment ---
  {
    rule_id: 'wsbc-8.22',
    section: 'Part 8',
    clause: 'OHS Regulation 8.22',
    title: 'Head Protection Required',
    description:
      'Workers must wear head protection that meets CSA Standard Z94.1 in areas where there is a danger of head injury from falling, flying, or thrown objects.',
    applicable_detection_types: ['helmet'],
    applicable_scene_types: [
      'work_at_height',
      'roofing',
      'excavation',
      'framing',
      'ladder_access',
      'material_handling_near_equipment',
    ],
    default_severity: Severity.HIGH,
    suggested_action:
      'Ensure all workers in the area wear CSA-approved hard hats. Remove workers without head protection from the hazard area until properly equipped.',
  },
  {
    rule_id: 'wsbc-8.24',
    section: 'Part 8',
    clause: 'OHS Regulation 8.24',
    title: 'High-Visibility Apparel',
    description:
      'Workers exposed to vehicular traffic or mobile equipment must wear high-visibility apparel meeting applicable standards.',
    applicable_detection_types: ['vest', 'machinery_proximity'],
    applicable_scene_types: ['material_handling_near_equipment'],
    default_severity: Severity.MEDIUM,
    suggested_action:
      'Provide and enforce use of high-visibility vests for all workers in areas with mobile equipment or vehicular traffic. Establish designated pedestrian walkways.',
  },
  // --- Excavation and Trenching ---
  {
    rule_id: 'wsbc-20.2',
    section: 'Part 20',
    clause: 'OHS Regulation 20.2',
    title: 'Excavation Safety',
    description:
      'Before excavation begins, the employer must ensure underground utility locations are identified. Excavation walls must be supported or sloped to prevent cave-in.',
    applicable_detection_types: ['trench_excavation_edge'],
    applicable_scene_types: ['excavation'],
    default_severity: Severity.CRITICAL,
    suggested_action:
      'Stop work immediately if excavation walls are unsupported. Install shoring, trench boxes, or slope walls to safe angles. Ensure workers have safe means of entry and exit.',
  },
  {
    rule_id: 'wsbc-20.72',
    section: 'Part 20',
    clause: 'OHS Regulation 20.72',
    title: 'Excavation Edge Protection',
    description:
      'Barriers or warning signs must be placed at least 1 m from the edge of an excavation to prevent workers and equipment from falling in.',
    applicable_detection_types: ['trench_excavation_edge'],
    applicable_scene_types: ['excavation'],
    default_severity: Severity.HIGH,
    suggested_action:
      'Install barriers or guardrails at least 1 m from excavation edges. Place warning signs and restrict access to authorized personnel only.',
  },
  // --- Machinery and Equipment ---
  {
    rule_id: 'wsbc-16.4',
    section: 'Part 16',
    clause: 'OHS Regulation 16.4',
    title: 'Mobile Equipment Operation Safety',
    description:
      'Workers must not be in the path of mobile equipment unless protected by barriers or signaling systems. Operators must have clear visibility of work areas.',
    applicable_detection_types: ['machinery_proximity'],
    applicable_scene_types: ['material_handling_near_equipment'],
    default_severity: Severity.CRITICAL,
    suggested_action:
      'Establish exclusion zones around mobile equipment. Implement spotter systems, proximity alarms, and physical barriers. Ensure operators have clear sightlines.',
  },
  // --- Housekeeping and Egress ---
  {
    rule_id: 'wsbc-4.43',
    section: 'Part 4',
    clause: 'OHS Regulation 4.43',
    title: 'Housekeeping and Clear Exits',
    description:
      'Work areas must be kept clean and orderly. Exits and access routes must be kept clear of obstructions at all times.',
    applicable_detection_types: ['blocked_exit_clutter'],
    applicable_scene_types: [
      'work_at_height',
      'roofing',
      'excavation',
      'framing',
      'ladder_access',
      'material_handling_near_equipment',
    ],
    default_severity: Severity.MEDIUM,
    suggested_action:
      'Clear all obstructions from exits and access routes immediately. Implement regular housekeeping schedule and designate material storage areas away from egress paths.',
  },
  // --- Roofing Specific ---
  {
    rule_id: 'wsbc-11.7',
    section: 'Part 11',
    clause: 'OHS Regulation 11.7',
    title: 'Roof Edge Protection',
    description:
      'Workers on a roof with a slope of less than 4 in 12 must be protected by guardrails or a travel restraint system if within 2 m of an unprotected edge.',
    applicable_detection_types: ['roof_edge'],
    applicable_scene_types: ['roofing'],
    default_severity: Severity.CRITICAL,
    suggested_action:
      'Install temporary guardrails or ensure workers use travel restraint systems when within 2 m of unprotected roof edges. Stop roofing work until edge protection is in place.',
  },
];

/**
 * Finds applicable WorkSafeBC rules for a given detection type and scene type.
 */
export function findApplicableRules(
  detectionType: string,
  sceneType: string
): WorkSafeBCRule[] {
  return WORKSAFE_BC_RULES.filter(
    (rule) =>
      rule.applicable_detection_types.includes(detectionType) &&
      rule.applicable_scene_types.includes(sceneType)
  );
}

/**
 * Finds all rules applicable to any of the given detection types within a scene.
 */
export function findRulesForDetections(
  detectionTypes: string[],
  sceneType: string
): Map<string, WorkSafeBCRule[]> {
  const ruleMap = new Map<string, WorkSafeBCRule[]>();

  for (const detectionType of detectionTypes) {
    const rules = findApplicableRules(detectionType, sceneType);
    if (rules.length > 0) {
      ruleMap.set(detectionType, rules);
    }
  }

  return ruleMap;
}

/**
 * Builds the WorkSafeBC regulation context for the Bedrock system prompt.
 * Provides the model with relevant regulation references for the given scene type.
 */
export function buildRegulatoryContext(sceneType: string): string {
  const relevantRules = WORKSAFE_BC_RULES.filter((rule) =>
    rule.applicable_scene_types.includes(sceneType)
  );

  if (relevantRules.length === 0) {
    return 'No specific WorkSafeBC regulations are directly applicable to this scene type.';
  }

  const ruleDescriptions = relevantRules
    .map(
      (rule) =>
        `- ${rule.clause} (${rule.title}): ${rule.description} [Severity: ${rule.default_severity}]`
    )
    .join('\n');

  return `Applicable WorkSafeBC OHS Regulations for ${sceneType} scenes:\n${ruleDescriptions}`;
}

/**
 * Gets all unique detection types covered by WorkSafeBC rules.
 */
export function getCoveredDetectionTypes(): string[] {
  const types = new Set<string>();
  for (const rule of WORKSAFE_BC_RULES) {
    for (const type of rule.applicable_detection_types) {
      types.add(type);
    }
  }
  return Array.from(types);
}
