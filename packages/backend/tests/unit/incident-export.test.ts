/**
 * Unit tests for the incident export handler.
 * Tests CSV generation, OSHA 300A summary calculation, and CSV field escaping.
 *
 * Requirements: 10.3, 17.1, 17.2, 17.3, 17.4
 */

import { describe, it, expect } from 'vitest';
import {
  generateOperationalCsv,
  generateOsha300Csv,
  calculateOsha300aSummary,
  escapeCsvField,
} from '../../src/services/incidents/export-handler.js';
import type { IncidentRecord, OshaRecordingData } from '../../src/services/incidents/types.js';
import {
  IncidentType,
  OperationalSeverity,
  RegulatoryFlag,
  IncidentStatus,
  ExternalReportStatus,
  OshaCaseOutcome,
  OshaRecordability,
} from '../../src/services/incidents/types.js';
import type { AuthenticatedUser } from '../../src/shared/auth-middleware.js';
import { Role } from '../../src/shared/types/common.js';

// --- Test Fixtures ---

function makeUser(overrides?: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    user_id: 'user-123',
    tenant_id: 'tenant-abc',
    role: Role.CSO,
    email: 'cso@example.com',
    ...overrides,
  };
}

function makeIncident(overrides?: Partial<IncidentRecord>): IncidentRecord {
  return {
    incident_id: 'inc-001',
    tenant_id: 'tenant-abc',
    site_id: 'site-1',
    title: 'Test Incident',
    description: 'A test incident description',
    incident_type: IncidentType.INJURY,
    incident_datetime: '2024-06-15T10:30:00.000Z',
    report_datetime: '2024-06-15T11:00:00.000Z',
    location: 'Building A, Floor 2',
    persons_involved_count: 1,
    reporting_user_id: 'user-123',
    reporting_user_name: 'reporter@example.com',
    severity: OperationalSeverity.MEDIUM,
    regulatory_flag: RegulatoryFlag.POTENTIALLY_REPORTABLE,
    status: IncidentStatus.OPEN,
    external_report_status: ExternalReportStatus.NOT_REPORTABLE,
    regulatory_indicators: {
      medical_treatment_beyond_first_aid: true,
      lost_time: false,
      hospitalization: false,
      fatality: false,
      amputation: false,
      loss_of_eye: false,
      structural_collapse: false,
      hazardous_substance_release: false,
      fire_or_explosion: false,
    },
    jurisdiction: 'us_state',
    created_at: '2024-06-15T11:00:00.000Z',
    updated_at: '2024-06-15T11:00:00.000Z',
    ...overrides,
  };
}

function makeOshaData(overrides?: Partial<OshaRecordingData>): OshaRecordingData {
  return {
    case_identifier: 'CASE-001',
    worker_name: 'John Doe',
    job_title: 'Electrician',
    incident_date: '2024-06-15',
    location_within_site: 'Building A, Floor 2',
    injury_illness_description: 'Electrical burn on left hand',
    case_outcome: OshaCaseOutcome.DAYS_AWAY_FROM_WORK,
    days_away_from_work: 5,
    days_restricted_work: 0,
    is_complete: true,
    last_updated: '2024-06-16T10:00:00.000Z',
    ...overrides,
  };
}

// --- All Operational CSV Fields (Req 17.1) ---

const ALL_OPERATIONAL_HEADERS = [
  'incident_id',
  'title',
  'description',
  'incident_type',
  'incident_datetime',
  'report_datetime',
  'site_id',
  'location',
  'persons_involved_count',
  'reporting_user_name',
  'severity',
  'regulatory_flag',
  'status',
  'external_report_status',
  'jurisdiction',
  'osha_recordability',
  'resolution_notes',
  'closure_date',
  'created_at',
  'updated_at',
];

const ALL_OSHA_300_HEADERS = [
  'case_identifier',
  'worker_name',
  'job_title',
  'incident_date',
  'location',
  'description',
  'case_outcome',
  'days_away',
  'days_restricted',
];

// --- escapeCsvField Tests ---

describe('incident-export: escapeCsvField', () => {
  it('returns empty quoted string for empty value', () => {
    expect(escapeCsvField('')).toBe('""');
  });

  it('returns value as-is when no special characters', () => {
    expect(escapeCsvField('simple value')).toBe('simple value');
  });

  it('wraps value in quotes when it contains a comma', () => {
    expect(escapeCsvField('value,with,commas')).toBe('"value,with,commas"');
  });

  it('wraps value in quotes and escapes internal quotes', () => {
    expect(escapeCsvField('value "with" quotes')).toBe('"value ""with"" quotes"');
  });

  it('wraps value in quotes when it contains a newline', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('wraps value in quotes when it contains a carriage return', () => {
    expect(escapeCsvField('line1\rline2')).toBe('"line1\rline2"');
  });

  it('handles value with both commas and quotes', () => {
    expect(escapeCsvField('a "b", c')).toBe('"a ""b"", c"');
  });
});

// --- generateOperationalCsv Tests ---

describe('incident-export: generateOperationalCsv', () => {
  it('generates CSV with metadata header (Req 17.4)', () => {
    const incidents = [makeIncident()];
    const user = makeUser();
    const filters = { status: 'open', site_id: 'site-1' };

    const csv = generateOperationalCsv(incidents, filters, user);

    expect(csv).toContain('# Incident Export Report');
    expect(csv).toContain('# Generation Date:');
    expect(csv).toContain('# Period: All time');
    expect(csv).toContain('# Filters: status=open, site_id=site-1');
    expect(csv).toContain('# Generated By: cso@example.com');
    expect(csv).toContain('# Total Records: 1');
  });

  it('includes correct CSV header row', () => {
    const csv = generateOperationalCsv([], {}, makeUser());
    const lines = csv.split('\n');
    const headerLine = lines.find((l) => l.startsWith('incident_id'));
    expect(headerLine).toBeDefined();
    expect(headerLine).toContain('incident_id');
    expect(headerLine).toContain('title');
    expect(headerLine).toContain('severity');
    expect(headerLine).toContain('status');
    expect(headerLine).toContain('osha_recordability');
  });

  it('includes incident data rows', () => {
    const incidents = [makeIncident({ incident_id: 'inc-test-123', title: 'Fall from scaffold' })];
    const csv = generateOperationalCsv(incidents, {}, makeUser());

    expect(csv).toContain('inc-test-123');
    expect(csv).toContain('Fall from scaffold');
  });

  it('generates empty CSV (header only) when no incidents', () => {
    const csv = generateOperationalCsv([], {}, makeUser());
    expect(csv).toContain('# Total Records: 0');
    // Should have metadata + empty line + header = 8 lines
    const lines = csv.split('\n');
    expect(lines.length).toBe(8);
  });

  it('includes date range in period when provided', () => {
    const filters = {
      date_range: { start: '2024-01-01', end: '2024-12-31' },
    };
    const csv = generateOperationalCsv([], filters, makeUser());
    expect(csv).toContain('# Period: from 2024-01-01 to 2024-12-31');
  });

  it('escapes fields with commas in incident data', () => {
    const incidents = [makeIncident({ title: 'Fall, slip, and trip' })];
    const csv = generateOperationalCsv(incidents, {}, makeUser());
    expect(csv).toContain('"Fall, slip, and trip"');
  });
});

// --- generateOsha300Csv Tests ---

describe('incident-export: generateOsha300Csv', () => {
  it('generates OSHA Form 300 CSV with metadata header (Req 17.4)', () => {
    const oshaData = [makeOshaData()];
    const user = makeUser();
    const filters = {};

    const csv = generateOsha300Csv(oshaData, filters, user);

    expect(csv).toContain('# OSHA Form 300 - Log of Work-Related Injuries and Illnesses');
    expect(csv).toContain('# Generation Date:');
    expect(csv).toContain('# Generated By: cso@example.com');
    expect(csv).toContain('# Total Records: 1');
    expect(csv).toContain('# Disclaimer:');
  });

  it('includes correct OSHA Form 300 header row', () => {
    const csv = generateOsha300Csv([], {}, makeUser());
    const lines = csv.split('\n');
    const headerLine = lines.find((l) => l.startsWith('case_identifier'));
    expect(headerLine).toBeDefined();
    expect(headerLine).toContain('case_identifier');
    expect(headerLine).toContain('worker_name');
    expect(headerLine).toContain('job_title');
    expect(headerLine).toContain('incident_date');
    expect(headerLine).toContain('location');
    expect(headerLine).toContain('description');
    expect(headerLine).toContain('case_outcome');
    expect(headerLine).toContain('days_away');
    expect(headerLine).toContain('days_restricted');
  });

  it('includes OSHA recording data rows', () => {
    const oshaData = [makeOshaData({ case_identifier: 'CASE-XYZ', worker_name: 'Jane Smith' })];
    const csv = generateOsha300Csv(oshaData, {}, makeUser());

    expect(csv).toContain('CASE-XYZ');
    expect(csv).toContain('Jane Smith');
  });
});

// --- calculateOsha300aSummary Tests ---

describe('incident-export: calculateOsha300aSummary', () => {
  it('returns zero totals for empty data', () => {
    const summary = calculateOsha300aSummary([], 2024);

    expect(summary.year).toBe(2024);
    expect(summary.total_cases).toBe(0);
    expect(summary.total_deaths).toBe(0);
    expect(summary.total_days_away).toBe(0);
    expect(summary.total_restricted_work).toBe(0);
    expect(summary.total_job_transfer).toBe(0);
    expect(summary.total_other_recordable).toBe(0);
    expect(summary.total_days_away_count).toBe(0);
    expect(summary.total_days_restricted_count).toBe(0);
  });

  it('counts deaths correctly', () => {
    const data = [
      makeOshaData({ case_outcome: OshaCaseOutcome.DEATH }),
      makeOshaData({ case_outcome: OshaCaseOutcome.DEATH }),
    ];
    const summary = calculateOsha300aSummary(data, 2024);

    expect(summary.total_deaths).toBe(2);
    expect(summary.total_cases).toBe(2);
  });

  it('counts days away from work and accumulates day counts', () => {
    const data = [
      makeOshaData({ case_outcome: OshaCaseOutcome.DAYS_AWAY_FROM_WORK, days_away_from_work: 10 }),
      makeOshaData({ case_outcome: OshaCaseOutcome.DAYS_AWAY_FROM_WORK, days_away_from_work: 5 }),
    ];
    const summary = calculateOsha300aSummary(data, 2024);

    expect(summary.total_days_away).toBe(2);
    expect(summary.total_days_away_count).toBe(15);
  });

  it('counts restricted work and accumulates restricted day counts', () => {
    const data = [
      makeOshaData({ case_outcome: OshaCaseOutcome.RESTRICTED_WORK, days_restricted_work: 7 }),
      makeOshaData({ case_outcome: OshaCaseOutcome.RESTRICTED_WORK, days_restricted_work: 3 }),
    ];
    const summary = calculateOsha300aSummary(data, 2024);

    expect(summary.total_restricted_work).toBe(2);
    expect(summary.total_days_restricted_count).toBe(10);
  });

  it('counts job transfers correctly', () => {
    const data = [makeOshaData({ case_outcome: OshaCaseOutcome.JOB_TRANSFER })];
    const summary = calculateOsha300aSummary(data, 2024);

    expect(summary.total_job_transfer).toBe(1);
  });

  it('counts other recordable cases correctly', () => {
    const data = [
      makeOshaData({ case_outcome: OshaCaseOutcome.OTHER_RECORDABLE }),
      makeOshaData({ case_outcome: OshaCaseOutcome.OTHER_RECORDABLE }),
      makeOshaData({ case_outcome: OshaCaseOutcome.OTHER_RECORDABLE }),
    ];
    const summary = calculateOsha300aSummary(data, 2024);

    expect(summary.total_other_recordable).toBe(3);
  });

  it('handles mixed outcome categories correctly (Req 10.3)', () => {
    const data = [
      makeOshaData({ case_outcome: OshaCaseOutcome.DEATH }),
      makeOshaData({ case_outcome: OshaCaseOutcome.DAYS_AWAY_FROM_WORK, days_away_from_work: 12 }),
      makeOshaData({ case_outcome: OshaCaseOutcome.RESTRICTED_WORK, days_restricted_work: 4 }),
      makeOshaData({ case_outcome: OshaCaseOutcome.JOB_TRANSFER }),
      makeOshaData({ case_outcome: OshaCaseOutcome.OTHER_RECORDABLE }),
    ];
    const summary = calculateOsha300aSummary(data, 2024);

    expect(summary.total_cases).toBe(5);
    expect(summary.total_deaths).toBe(1);
    expect(summary.total_days_away).toBe(1);
    expect(summary.total_days_away_count).toBe(12);
    expect(summary.total_restricted_work).toBe(1);
    expect(summary.total_days_restricted_count).toBe(4);
    expect(summary.total_job_transfer).toBe(1);
    expect(summary.total_other_recordable).toBe(1);
  });
});

// --- Additional Coverage: Operational CSV All Fields (Req 17.1) ---

describe('incident-export: operational CSV includes all incident fields (Req 17.1)', () => {
  it('header row contains all 20 required fields', () => {
    const csv = generateOperationalCsv([], {}, makeUser());
    const lines = csv.split('\n');
    const headerLine = lines.find((l) => l.startsWith('incident_id'));
    expect(headerLine).toBeDefined();

    const headers = headerLine!.split(',');
    expect(headers).toHaveLength(ALL_OPERATIONAL_HEADERS.length);
    for (const field of ALL_OPERATIONAL_HEADERS) {
      expect(headers).toContain(field);
    }
  });

  it('data row contains values for all 20 fields', () => {
    const incident = makeIncident({
      osha_recordability: OshaRecordability.MEDICAL_TREATMENT,
      resolution_notes: 'Resolved after investigation',
      closure_date: '2024-07-01T00:00:00.000Z',
    });
    const csv = generateOperationalCsv([incident], {}, makeUser());
    const lines = csv.split('\n');
    // Data row is the last non-empty line
    const dataLine = lines[lines.length - 1];
    const fields = dataLine.split(',');
    // Should have 20 fields (some may be quoted with commas inside, but our test data has no commas in values)
    expect(fields.length).toBeGreaterThanOrEqual(ALL_OPERATIONAL_HEADERS.length);
  });

  it('handles optional fields as empty quoted strings when undefined', () => {
    const incident = makeIncident({
      osha_recordability: undefined,
      resolution_notes: undefined,
      closure_date: undefined,
    });
    const csv = generateOperationalCsv([incident], {}, makeUser());
    // Empty optional fields should appear as ""
    expect(csv).toContain('""');
  });

  it('generates correct number of data rows for multiple incidents', () => {
    const incidents = [
      makeIncident({ incident_id: 'inc-001' }),
      makeIncident({ incident_id: 'inc-002' }),
      makeIncident({ incident_id: 'inc-003' }),
    ];
    const csv = generateOperationalCsv(incidents, {}, makeUser());
    expect(csv).toContain('# Total Records: 3');
    // 6 metadata lines + 1 empty line + 1 header + 3 data rows = 11 lines
    const lines = csv.split('\n');
    expect(lines.length).toBe(11);
  });
});

// --- Additional Coverage: OSHA Form 300 CSV All Fields (Req 17.2) ---

describe('incident-export: OSHA Form 300 CSV includes all required fields (Req 17.2)', () => {
  it('header row contains all 9 required OSHA Form 300 fields', () => {
    const csv = generateOsha300Csv([], {}, makeUser());
    const lines = csv.split('\n');
    const headerLine = lines.find((l) => l.startsWith('case_identifier'));
    expect(headerLine).toBeDefined();

    const headers = headerLine!.split(',');
    expect(headers).toHaveLength(ALL_OSHA_300_HEADERS.length);
    for (const field of ALL_OSHA_300_HEADERS) {
      expect(headers).toContain(field);
    }
  });

  it('data row maps OSHA recording data fields correctly', () => {
    const oshaData = [makeOshaData({
      case_identifier: 'CASE-100',
      worker_name: 'Alice Johnson',
      job_title: 'Welder',
      incident_date: '2024-03-10',
      location_within_site: 'Workshop B',
      injury_illness_description: 'Burns from welding',
      case_outcome: OshaCaseOutcome.RESTRICTED_WORK,
      days_away_from_work: 0,
      days_restricted_work: 14,
    })];
    const csv = generateOsha300Csv(oshaData, {}, makeUser());

    expect(csv).toContain('CASE-100');
    expect(csv).toContain('Alice Johnson');
    expect(csv).toContain('Welder');
    expect(csv).toContain('2024-03-10');
    expect(csv).toContain('Workshop B');
    expect(csv).toContain('Burns from welding');
    expect(csv).toContain('restricted_work');
    expect(csv).toContain('0');
    expect(csv).toContain('14');
  });

  it('includes legal disclaimer in OSHA Form 300 CSV (Req 24.2)', () => {
    const csv = generateOsha300Csv([], {}, makeUser());
    expect(csv).toContain('do not constitute legal advice');
  });
});

// --- Additional Coverage: Metadata Header ISO 8601 Format (Req 17.4) ---

describe('incident-export: metadata header format (Req 17.4)', () => {
  it('generation date is in ISO 8601 format', () => {
    const csv = generateOperationalCsv([], {}, makeUser());
    const lines = csv.split('\n');
    const dateLine = lines.find((l) => l.startsWith('# Generation Date:'));
    expect(dateLine).toBeDefined();
    // Extract the date portion and verify ISO 8601 format
    const dateStr = dateLine!.replace('# Generation Date: ', '');
    expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  it('uses user_id when email is not available', () => {
    const user = makeUser({ email: undefined, user_id: 'user-fallback-456' });
    const csv = generateOperationalCsv([], {}, user);
    expect(csv).toContain('# Generated By: user-fallback-456');
  });

  it('OSHA 300 CSV uses user_id when email is not available', () => {
    const user = makeUser({ email: undefined, user_id: 'user-fallback-789' });
    const csv = generateOsha300Csv([], {}, user);
    expect(csv).toContain('# Generated By: user-fallback-789');
  });

  it('filters description shows "None" when no filters applied', () => {
    const csv = generateOperationalCsv([], {}, makeUser());
    expect(csv).toContain('# Filters: None');
  });

  it('filters description includes regulatory_flag when provided', () => {
    const filters = { regulatory_flag: 'immediately_reportable' };
    const csv = generateOperationalCsv([], filters, makeUser());
    expect(csv).toContain('regulatory_flag=immediately_reportable');
  });
});
