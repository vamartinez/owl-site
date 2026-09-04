/**
 * Incident state machine module.
 * Defines valid state transitions and provides validation utilities.
 *
 * Requirements: 5.1, 5.2, 5.4
 */

import { IncidentStatus } from './types';

/**
 * Map of valid state transitions for the incident lifecycle.
 * Each key is a source state, and the value is the array of allowed target states.
 *
 * Requirement 5.2: Allowed state transitions.
 */
export const VALID_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  [IncidentStatus.OPEN]: [IncidentStatus.UNDER_REVIEW, IncidentStatus.REGULATORY_REVIEW],
  [IncidentStatus.UNDER_REVIEW]: [IncidentStatus.ACTION_REQUIRED, IncidentStatus.RESOLVED],
  [IncidentStatus.REGULATORY_REVIEW]: [IncidentStatus.ACTION_REQUIRED, IncidentStatus.RESOLVED],
  [IncidentStatus.ACTION_REQUIRED]: [IncidentStatus.RESOLVED],
  [IncidentStatus.RESOLVED]: [IncidentStatus.CLOSED],
  [IncidentStatus.CLOSED]: [IncidentStatus.OPEN], // Reopening
};

/**
 * Checks whether a state transition from one status to another is valid.
 *
 * Requirement 5.2: Only allowed transitions are permitted.
 * Requirement 5.4: Invalid transitions are rejected.
 *
 * @param from - The current incident status
 * @param to - The desired target status
 * @returns true if the transition is allowed, false otherwise
 */
export function isValidTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Returns the list of valid target states from a given source state.
 *
 * Requirement 5.4: Return the list of valid transitions from the current state.
 *
 * @param from - The current incident status
 * @returns Array of valid target statuses (empty if none or unknown state)
 */
export function getValidTransitions(from: IncidentStatus): IncidentStatus[] {
  return VALID_TRANSITIONS[from] ?? [];
}
