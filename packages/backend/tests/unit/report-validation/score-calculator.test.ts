import { describe, it, expect } from 'vitest';
import { calculateComplianceScore } from '../../../src/services/report-validation/score-calculator.js';
import type { ComplianceFinding } from '../../../src/services/report-validation/types.js';

const makeFinding = (severity: ComplianceFinding['severity']): ComplianceFinding => ({
  finding_id: `finding-${Math.random().toString(36).slice(2)}`,
  severity,
  description: `Test finding`,
  report_section: 'Section 1',
  suggested_correction: 'Fix it',
  regulation_references: [{ title: 'Reg', section: '1.1' }],
});

describe('calculateComplianceScore', () => {
  it('returns 100 for empty findings array', () => {
    expect(calculateComplianceScore([])).toBe(100);
  });

  it('deducts 15 points per critical finding', () => {
    const findings = [makeFinding('critical')];
    expect(calculateComplianceScore(findings)).toBe(85);
  });

  it('deducts 8 points per major finding', () => {
    const findings = [makeFinding('major')];
    expect(calculateComplianceScore(findings)).toBe(92);
  });

  it('deducts 3 points per minor finding', () => {
    const findings = [makeFinding('minor')];
    expect(calculateComplianceScore(findings)).toBe(97);
  });

  it('deducts 0 points for informational findings', () => {
    const findings = [makeFinding('informational')];
    expect(calculateComplianceScore(findings)).toBe(100);
  });

  it('accumulates deductions from multiple findings', () => {
    const findings = [
      makeFinding('critical'),  // -15
      makeFinding('major'),     // -8
      makeFinding('minor'),     // -3
    ];
    expect(calculateComplianceScore(findings)).toBe(74); // 100 - 15 - 8 - 3
  });

  it('clamps score to minimum of 0', () => {
    const findings = Array.from({ length: 10 }, () => makeFinding('critical')); // -150
    expect(calculateComplianceScore(findings)).toBe(0);
  });

  it('handles mixed severity findings correctly', () => {
    const findings = [
      makeFinding('critical'),       // -15
      makeFinding('critical'),       // -15
      makeFinding('major'),          // -8
      makeFinding('major'),          // -8
      makeFinding('minor'),          // -3
      makeFinding('informational'),  // -0
    ];
    expect(calculateComplianceScore(findings)).toBe(51); // 100 - 30 - 16 - 3 - 0
  });

  it('returns 0 when deductions exceed 100', () => {
    const findings = [
      ...Array.from({ length: 5 }, () => makeFinding('critical')),  // -75
      ...Array.from({ length: 4 }, () => makeFinding('major')),     // -32
    ];
    // Total deduction: 107, clamped to 0
    expect(calculateComplianceScore(findings)).toBe(0);
  });

  it('handles only informational findings (score stays 100)', () => {
    const findings = Array.from({ length: 50 }, () => makeFinding('informational'));
    expect(calculateComplianceScore(findings)).toBe(100);
  });
});
