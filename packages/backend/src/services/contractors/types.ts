/**
 * TypeScript interfaces for the Contractors Service domain.
 */

export interface Contractor {
  contractor_id: string;
  tenant_id: string;
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  license_number?: string;
  status: ContractorStatus;
  created_at: string;
  updated_at: string;
}

export enum ContractorStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

export interface ContractorWorker {
  contractor_id: string;
  worker_id: string;
  tenant_id: string;
  assigned_at: string;
  assigned_by: string;
}

export interface ContractorComplianceStatus {
  contractor_id: string;
  tenant_id: string;
  total_workers: number;
  compliant_workers: number;
  non_compliant_workers: number;
  expired_certifications: number;
  compliance_percentage: number;
  last_calculated_at: string;
}

export interface CreateContractorRequest {
  company_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  license_number?: string;
}

export interface UpdateContractorRequest {
  company_name?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  license_number?: string;
  status?: ContractorStatus;
}

export interface AssignWorkerRequest {
  worker_id: string;
}
