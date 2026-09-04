import type { IncidentCreateFormData } from './schemas';
import type { CreateIncidentRequest } from './types';

/**
 * Builds the CreateIncidentRequest payload from validated form data.
 * Conditionally includes worker_id only when it is a non-empty string.
 *
 * Requirements: 6.3, 6.4
 */
export function buildCreateIncidentPayload(
  formData: IncidentCreateFormData,
): CreateIncidentRequest {
  const payload: CreateIncidentRequest = {
    title: formData.title,
    description: formData.description,
    incident_type: formData.incident_type,
    incident_datetime: formData.incident_datetime,
    site_id: formData.site_id,
    location: formData.location,
    persons_involved_count: formData.persons_involved_count,
    severity: formData.severity,
    regulatory_indicators: formData.regulatory_indicators,
  };

  // Include optional fields only when they have meaningful values
  if (formData.other_type_description) {
    payload.other_type_description = formData.other_type_description;
  }

  if (formData.jurisdiction) {
    payload.jurisdiction = formData.jurisdiction;
  }

  // worker_id is included if and only if a worker was selected (non-empty string)
  if (formData.worker_id && formData.worker_id.length > 0) {
    payload.worker_id = formData.worker_id;
  }

  return payload;
}
