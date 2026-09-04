import { describe, it, expect } from 'vitest';
import { Role } from '../../src/shared/types/common.js';
import {
  getAvailableActions,
  getScoreColor,
  getEstimatedTimeSeconds,
  groupFindingsBySeverity,
  getReportVisibilityScope,
  buildKBDocumentS3Key,
  isTextSufficient,
} from '../../src/services/report-validation/utils.js';
import type { ComplianceFinding } from '../../src/services/report-validation/types.js';

// --- getAvailableActions ---

describe('getAvailableActions', () => {
  it('returns request_validation and submit for draft', () => {
    expect(getAvailableActions('draft')).toEqual(['request_validation', 'submit']);
  });

  it('returns empty array for validating', () => {
    expect(getAvailableActions('validating')).toEqual([]);
  });

  it('returns upload_version and submit for validated', () => {
    expect(getAvailableActions('validated')).toEqual(['upload_version', 'submit']);
  });

  it('returns empty array for submitted', () => {
    expect(getAvailableActions('submitted')).toEqual([]);
  });
});

// --- getScoreColor ---

describe('getScoreColor', () => {
  it('returns green for score 80', () => {
    expect(getScoreColor(80)).toBe('green');
  });

  it('returns green for score 100', () => {
    expect(getScoreColor(100)).toBe('green');
  });

  it('returns yellow for score 79', () => {
    expect(getScoreColor(79)).toBe('yellow');
  });

  it('returns yellow for score 50', () => {
    expect(getScoreColor(50)).toBe('yellow');
  });

  it('returns red for score 49', () => {
    expect(getScoreColor(49)).toBe('red');
  });

  it('returns red for score 0', () => {
    expect(getScoreColor(0)).toBe('red');
  });
});

// --- getEstimatedTimeSeconds ---

describe('getEstimatedTimeSeconds', () => {
  it('returns 30 for 1 page', () => {
    expect(getEstimatedTimeSeconds(1)).toBe(30);
  });

  it('returns 30 for 5 pages', () => {
    expect(getEstimatedTimeSeconds(5)).toBe(30);
  });

  it('returns 60 for 6 pages', () => {
    expect(getEstimatedTimeSeconds(6)).toBe(60);
  });

  it('returns 60 for 20 pages', () => {
    expect(getEstimatedTimeSeconds(20)).toBe(60);
  });

  it('returns 90 for 21 pages', () => {
    expect(getEstimatedTimeSeconds(21)).toBe(90);
  });

  it('returns 90 for 100 pages', () => {
    expect(getEstimatedTimeSeconds(100)).toBe(90);
  });
});

// --- groupFindingsBySeverity ---

describe('groupFindingsBySeverity', () => {
  const makeFinding = (severity: ComplianceFinding['severity'], id: string): ComplianceFinding => ({
    finding_id: id,
    severity,
    description: `Finding ${id}`,
    report_section: 'Section 1',
    suggested_correction: 'Fix it',
    regulation_references: [{ title: 'Reg', section: '1.1' }],
  });

  it('returns empty array for empty findings', () => {
    expect(groupFindingsBySeverity([])).toEqual([]);
  });

  it('groups findings by severity in correct order', () => {
    const findings = [
      makeFinding('minor', '1'),
      makeFinding('critical', '2'),
      makeFinding('informational', '3'),
      makeFinding('major', '4'),
    ];

    const result = groupFindingsBySeverity(findings);
    expect(result).toHaveLength(4);
    expect(result[0]!.severity).toBe('critical');
    expect(result[1]!.severity).toBe('major');
    expect(result[2]!.severity).toBe('minor');
    expect(result[3]!.severity).toBe('informational');
  });

  it('filters out empty severity groups', () => {
    const findings = [
      makeFinding('critical', '1'),
      makeFinding('minor', '2'),
    ];

    const result = groupFindingsBySeverity(findings);
    expect(result).toHaveLength(2);
    expect(result[0]!.severity).toBe('critical');
    expect(result[1]!.severity).toBe('minor');
  });

  it('preserves total count across groups', () => {
    const findings = [
      makeFinding('critical', '1'),
      makeFinding('critical', '2'),
      makeFinding('major', '3'),
      makeFinding('minor', '4'),
      makeFinding('minor', '5'),
      makeFinding('minor', '6'),
    ];

    const result = groupFindingsBySeverity(findings);
    const totalCount = result.reduce((sum, group) => sum + group.findings.length, 0);
    expect(totalCount).toBe(findings.length);
  });
});

// --- getReportVisibilityScope ---

describe('getReportVisibilityScope', () => {
  it('returns tenant for TENANT_ADMIN', () => {
    expect(getReportVisibilityScope(Role.TENANT_ADMIN)).toBe('tenant');
  });

  it('returns tenant for CSO', () => {
    expect(getReportVisibilityScope(Role.CSO)).toBe('tenant');
  });

  it('returns site for SITE_ADMIN', () => {
    expect(getReportVisibilityScope(Role.SITE_ADMIN)).toBe('site');
  });

  it('returns site for SUPERVISOR', () => {
    expect(getReportVisibilityScope(Role.SUPERVISOR)).toBe('site');
  });

  it('returns own for WORKER', () => {
    expect(getReportVisibilityScope(Role.WORKER)).toBe('own');
  });

  it('returns own for GATE_OPERATOR', () => {
    expect(getReportVisibilityScope(Role.GATE_OPERATOR)).toBe('own');
  });

  it('returns own for PLATFORM_ADMIN', () => {
    expect(getReportVisibilityScope(Role.PLATFORM_ADMIN)).toBe('own');
  });
});

// --- buildKBDocumentS3Key ---

describe('buildKBDocumentS3Key', () => {
  it('builds key with worksafebc prefix', () => {
    expect(buildKBDocumentS3Key('worksafebc', 'doc-123', 'regulation.pdf')).toBe(
      'worksafebc/doc-123/regulation.pdf'
    );
  });

  it('builds key with bc-building-code prefix', () => {
    expect(buildKBDocumentS3Key('bc-building-code', 'doc-456', 'code.docx')).toBe(
      'bc-building-code/doc-456/code.docx'
    );
  });

  it('builds key with safety-standards prefix', () => {
    expect(buildKBDocumentS3Key('safety-standards', 'doc-789', 'standard.pdf')).toBe(
      'safety-standards/doc-789/standard.pdf'
    );
  });

  it('builds key with canada-general prefix', () => {
    expect(buildKBDocumentS3Key('canada-general', 'doc-abc', 'national.pdf')).toBe(
      'canada-general/doc-abc/national.pdf'
    );
  });
});

// --- isTextSufficient ---

describe('isTextSufficient', () => {
  it('returns false for empty string', () => {
    expect(isTextSufficient('')).toBe(false);
  });

  it('returns false for 49 characters', () => {
    expect(isTextSufficient('a'.repeat(49))).toBe(false);
  });

  it('returns true for exactly 50 characters', () => {
    expect(isTextSufficient('a'.repeat(50))).toBe(true);
  });

  it('returns true for more than 50 characters', () => {
    expect(isTextSufficient('a'.repeat(100))).toBe(true);
  });
});
