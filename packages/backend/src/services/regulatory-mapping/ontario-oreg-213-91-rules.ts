/**
 * Ontario O. Reg. 213/91 (Construction Projects) reference data for regulatory
 * mapping. Ontario counterpart to worksafe-bc-rules.ts, used by the jurisdiction
 * registry when a site's jurisdiction_id resolves to Ontario.
 *
 * Section numbers follow the O. Reg. 213/91 structure published on ontario.ca
 * e-Laws (Occupational Health and Safety Act, R.S.O. 1990):
 *   - Protective Clothing, Equipment and Devices  s.21-27  (headwear s.22-23,
 *     fall protection s.26, high-visibility s.69.1)
 *   - Housekeeping                                 s.35-48
 *   - Traffic Control                              s.67-69
 *   - Ladders                                      s.78-84
 *   - Scaffolds and Work Platforms                 s.125-142
 *   - Excavations                                  s.222-242
 * Sources:
 *   https://www.ontario.ca/laws/regulation/910213 (table of contents)
 *   https://www.ontario.ca/page/shepherds-hook-fall-protection-system (s.26)
 *   https://ohsguide.ihsa.ca/en/topic/guardrails (IHSA, fall protection hierarchy)
 *
 * COR note: Ontario contractors pursuing COR certification need ongoing,
 * clause-referenced audit trails; these rules produce exactly that via the
 * regulatory_basis / suggested_action fields carried into each Finding.
 *
 * IMPORTANT: detection_type and scene_type values MUST match the shared
 * vocabulary used in worksafe-bc-rules.ts so the mapper's rule matching works
 * identically across jurisdictions.
 */

import { Severity } from '../../shared/types/common.js';
import type { JurisdictionRule } from './jurisdiction-registry.js';

/**
 * Ontario Construction Projects regulation identifier.
 */
export const ONTARIO_JURISDICTION_ID = 'ontario-oreg-213-91';

/**
 * O. Reg. 213/91 rules applicable to construction site safety.
 * Each rule mirrors a WorkSafeBC counterpart so detection/scene coverage
 * stays at parity between jurisdictions.
 */
export const ONTARIO_RULES: JurisdictionRule[] = [
  // --- Fall Protection (s.26) ---
  {
    rule_id: 'on-26.1',
    section: 'Part III',
    clause: 'O. Reg. 213/91 s.26.1',
    title: 'Fall Protection Required',
    description:
      'A worker must be protected by a guardrail system or, where impractical, a travel-restraint, fall-restricting, fall-arrest system or safety net where the worker could fall 3 m or more, or into operating machinery, water, or a hazardous substance.',
    applicable_detection_types: ['harness', 'roof_edge', 'scaffold'],
    applicable_scene_types: ['work_at_height', 'roofing', 'ladder_access'],
    default_severity: Severity.CRITICAL,
    suggested_action:
      'Immediately stop work at height. Ensure all workers use guardrails or an appropriate personal fall protection system before resuming elevated work.',
  },
  {
    rule_id: 'on-26.3',
    section: 'Part III',
    clause: 'O. Reg. 213/91 s.26.3',
    title: 'Fall Protection System Selection',
    description:
      'Where a guardrail system is impractical, the employer must ensure an appropriate fall protection method is used following the required hierarchy (travel restraint, fall restricting, fall arrest, safety net) for the specific work.',
    applicable_detection_types: ['harness', 'scaffold', 'roof_edge'],
    applicable_scene_types: ['work_at_height', 'roofing'],
    default_severity: Severity.HIGH,
    suggested_action:
      'Select and implement the appropriate fall protection method per the s.26 hierarchy. Document the fall protection plan and confirm workers are trained on proper use.',
  },
  // --- Scaffolding (s.125-142) ---
  {
    rule_id: 'on-125',
    section: 'Part III',
    clause: 'O. Reg. 213/91 s.125',
    title: 'Scaffold General Requirements',
    description:
      'A scaffold must be designed and constructed to support all loads to which it may be subjected, be provided with guardrails on open sides, and be inspected before use. Frame scaffolds over 15 m (tube-and-clamp over 10 m) require engineered design (s.130(1)).',
    applicable_detection_types: ['scaffold'],
    applicable_scene_types: ['work_at_height'],
    default_severity: Severity.HIGH,
    suggested_action:
      'Inspect scaffold for structural integrity, guardrails on all open sides, and adequate load capacity. Confirm engineered design where height thresholds are exceeded before allowing worker access.',
  },
  // --- Ladders (s.78-84) ---
  {
    rule_id: 'on-79',
    section: 'Part III',
    clause: 'O. Reg. 213/91 s.79',
    title: 'Ladder Safety Requirements',
    description:
      'A ladder must be free of defects, placed on a firm level surface, secured against movement, and extend approximately 900 mm above the top landing. Workers must maintain three-point contact.',
    applicable_detection_types: ['ladder'],
    applicable_scene_types: ['ladder_access', 'work_at_height'],
    default_severity: Severity.MEDIUM,
    suggested_action:
      'Verify the ladder is on a firm level surface, secured top and bottom, extends ~900 mm above the landing, and the worker maintains three-point contact. Remove defective ladders from service.',
  },
  // --- Protective Equipment: Head (s.22-23) ---
  {
    rule_id: 'on-22',
    section: 'Part II',
    clause: 'O. Reg. 213/91 s.22',
    title: 'Protective Headwear Required',
    description:
      'A worker must wear protective headwear (industrial protective headwear meeting CSA Z94.1) at all times when on a project where there is a risk of head injury.',
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
      'Ensure all workers wear CSA-approved protective headwear. Remove workers without head protection from the hazard area until properly equipped.',
  },
  // --- Protective Equipment: High-Visibility (s.69.1) ---
  {
    rule_id: 'on-69.1',
    section: 'Part II',
    clause: 'O. Reg. 213/91 s.69.1',
    title: 'High-Visibility Apparel',
    description:
      'A worker who may be endangered by vehicular traffic must wear a garment of high-visibility material that meets the requirements of the regulation.',
    applicable_detection_types: ['vest', 'machinery_proximity'],
    applicable_scene_types: ['material_handling_near_equipment'],
    default_severity: Severity.MEDIUM,
    suggested_action:
      'Provide and enforce high-visibility apparel for all workers exposed to vehicular traffic or mobile equipment. Establish designated pedestrian walkways.',
  },
  // --- Excavations (s.222-242) ---
  {
    rule_id: 'on-234',
    section: 'Part III',
    clause: 'O. Reg. 213/91 s.234',
    title: 'Excavation Support / Cave-in Protection',
    description:
      'The walls of an excavation that a worker may enter must be supported by a support system, cut back to a stable slope, or otherwise protected against cave-in, and underground utilities must be located before excavation.',
    applicable_detection_types: ['trench_excavation_edge'],
    applicable_scene_types: ['excavation'],
    default_severity: Severity.CRITICAL,
    suggested_action:
      'Stop work immediately if excavation walls are unsupported. Install shoring or trench boxes, or cut walls back to a stable slope. Ensure a safe means of entry and exit.',
  },
  {
    rule_id: 'on-235',
    section: 'Part III',
    clause: 'O. Reg. 213/91 s.235',
    title: 'Excavation Edge / Spoil Protection',
    description:
      'Excavated material and equipment must be kept back from the edge of an excavation, and workers must be protected from material falling into the excavation.',
    applicable_detection_types: ['trench_excavation_edge'],
    applicable_scene_types: ['excavation'],
    default_severity: Severity.HIGH,
    suggested_action:
      'Keep spoil piles and equipment back from excavation edges. Install barriers or guardrails and restrict access to authorized personnel only.',
  },
  // --- Traffic Control / Mobile Equipment (s.67-69, s.104) ---
  {
    rule_id: 'on-67',
    section: 'Part II',
    clause: 'O. Reg. 213/91 s.67',
    title: 'Traffic Protection / Mobile Equipment',
    description:
      'Where a worker may be endangered by vehicular or mobile equipment traffic, a traffic protection plan and control measures (barriers, signallers, designated routes) must be implemented, and workers kept clear of equipment paths.',
    applicable_detection_types: ['machinery_proximity'],
    applicable_scene_types: ['material_handling_near_equipment'],
    default_severity: Severity.CRITICAL,
    suggested_action:
      'Establish exclusion zones around mobile equipment. Implement signaller/spotter systems, proximity controls, and physical barriers. Ensure operators have clear sightlines.',
  },
  // --- Housekeeping and Egress (s.35-48) ---
  {
    rule_id: 'on-35',
    section: 'Part II',
    clause: 'O. Reg. 213/91 s.35',
    title: 'Housekeeping and Clear Access Routes',
    description:
      'A project must be kept clear of obstructions and accumulations of material or debris that may endanger a worker; access and egress routes must be kept unobstructed.',
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
      'Clear all obstructions from access and egress routes immediately. Implement a regular housekeeping schedule and designate material storage away from travel paths.',
  },
  // --- Roofing Edge Protection (s.26, roofing-specific) ---
  {
    rule_id: 'on-26.roof',
    section: 'Part III',
    clause: 'O. Reg. 213/91 s.26',
    title: 'Roof Edge Protection',
    description:
      'A worker on a roof exposed to a fall of 3 m or more, or a lesser fall onto a hazard, must be protected by a guardrail system or, where impractical, an appropriate personal fall protection system.',
    applicable_detection_types: ['roof_edge'],
    applicable_scene_types: ['roofing'],
    default_severity: Severity.CRITICAL,
    suggested_action:
      'Install guardrails or ensure workers use travel-restraint/fall-arrest systems near unprotected roof edges. Stop roofing work until edge protection is in place.',
  },
];

/**
 * Finds applicable Ontario rules for a given detection type and scene type.
 */
export function findApplicableRules(
  detectionType: string,
  sceneType: string
): JurisdictionRule[] {
  return ONTARIO_RULES.filter(
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
): Map<string, JurisdictionRule[]> {
  const ruleMap = new Map<string, JurisdictionRule[]>();
  for (const detectionType of detectionTypes) {
    const rules = findApplicableRules(detectionType, sceneType);
    if (rules.length > 0) {
      ruleMap.set(detectionType, rules);
    }
  }
  return ruleMap;
}

/**
 * Builds the Ontario regulation context for the model system prompt.
 */
export function buildRegulatoryContext(sceneType: string): string {
  const relevantRules = ONTARIO_RULES.filter((rule) =>
    rule.applicable_scene_types.includes(sceneType)
  );

  if (relevantRules.length === 0) {
    return 'No specific O. Reg. 213/91 provisions are directly applicable to this scene type.';
  }

  const ruleDescriptions = relevantRules
    .map(
      (rule) =>
        `- ${rule.clause} (${rule.title}): ${rule.description} [Severity: ${rule.default_severity}]`
    )
    .join('\n');

  return `Applicable Ontario O. Reg. 213/91 (Construction Projects) provisions for ${sceneType} scenes:\n${ruleDescriptions}`;
}

/**
 * Gets all unique detection types covered by Ontario rules.
 */
export function getCoveredDetectionTypes(): string[] {
  const types = new Set<string>();
  for (const rule of ONTARIO_RULES) {
    for (const type of rule.applicable_detection_types) {
      types.add(type);
    }
  }
  return Array.from(types);
}
