/**
 * TypeScript interfaces for the Lead Capture domain.
 *
 * Requirements: 16.3, 16.4, 16.5
 */

export interface LeadCapture {
  lead_id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone?: string;
  message: string;
  source: string;
  created_at: string;
  status: LeadStatus;
}

export enum LeadStatus {
  NEW = 'new',
  CONTACTED = 'contacted',
  QUALIFIED = 'qualified',
  DISQUALIFIED = 'disqualified',
}

export interface CreateLeadRequest {
  company_name: string;
  contact_name: string;
  email: string;
  phone?: string;
  message: string;
}
