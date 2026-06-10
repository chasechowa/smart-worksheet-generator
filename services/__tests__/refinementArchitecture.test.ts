import { describe, it, expect } from 'vitest';
import { classifyIssue } from '../aiService';
import type { ValidationIssue } from '../../types';

// ---------------------------------------------------------------------------
// classifyIssue — critical / major / minor
// ---------------------------------------------------------------------------

describe('classifyIssue', () => {
  // ---- Critical ----

  it('classifies missing summary section as critical', () => {
    const issue: ValidationIssue = {
      type: 'structure',
      section: 'summary',
      severity: 'error',
      message: 'Summary paragraph is missing',
    };
    expect(classifyIssue(issue)).toBe('critical');
  });

  it('classifies missing writing workshop as critical', () => {
    const issue: ValidationIssue = {
      type: 'structure',
      section: 'writing',
      severity: 'error',
      message: 'Writing Workshop section is missing',
    };
    expect(classifyIssue(issue)).toBe('critical');
  });

  it('classifies missing keys section as critical', () => {
    const issue: ValidationIssue = {
      type: 'structure',
      section: 'keys',
      severity: 'error',
      message: 'Keys section is missing',
    };
    expect(classifyIssue(issue)).toBe('critical');
  });

  it('classifies global structural errors as critical', () => {
    const issue: ValidationIssue = {
      type: 'structure',
      section: 'global',
      severity: 'error',
      message: 'Worksheet title is empty',
    };
    expect(classifyIssue(issue)).toBe('critical');
  });

  // ---- Major (recoverable structural errors) ----

  it('classifies wrong MC count as major (recoverable)', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'mc',
      severity: 'error',
      message: 'Expected 10 MC questions, got 7',
    };
    expect(classifyIssue(issue)).toBe('major');
  });

  it('classifies duplicate options as major', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'mc',
      severity: 'error',
      message: 'Q3: Contains duplicate option(s)',
    };
    expect(classifyIssue(issue)).toBe('major');
  });

  it('classifies empty option as major', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'mc',
      severity: 'error',
      message: 'Q5: Contains empty option(s)',
    };
    expect(classifyIssue(issue)).toBe('major');
  });

  it('classifies answer mismatch as major', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'mc',
      severity: 'error',
      message: 'Q1: Answer "X" does not match any option',
    };
    expect(classifyIssue(issue)).toBe('major');
  });

  it('classifies wrong syntax count as major', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'syntax',
      severity: 'error',
      message: 'Expected exactly 2 syntax deconstruction items, got 1',
    };
    expect(classifyIssue(issue)).toBe('major');
  });

  it('classifies empty syntax sentence as major', () => {
    const issue: ValidationIssue = {
      type: 'structure',
      section: 'syntax',
      severity: 'error',
      message: 'Syntax item 1: original sentence is empty',
    };
    // Not "is missing" → major, not critical
    expect(classifyIssue(issue)).toBe('major');
  });

  it('classifies wrong expansion count as major', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'writing',
      severity: 'error',
      message: 'Expected exactly 4 sentence expansion items, got 3',
    };
    expect(classifyIssue(issue)).toBe('major');
  });

  it('classifies wrong keywords count as major', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'writing',
      severity: 'error',
      message: 'Expected exactly 5 keywords, got 3',
    };
    expect(classifyIssue(issue)).toBe('major');
  });

  it('classifies empty critical thinking as major', () => {
    const issue: ValidationIssue = {
      type: 'structure',
      section: 'writing',
      severity: 'error',
      message: 'Critical Thinking prompt is empty',
    };
    // Not "is missing" → major, not critical
    expect(classifyIssue(issue)).toBe('major');
  });

  it('classifies blank count mismatch as major', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'summary',
      severity: 'error',
      message: 'Summary blanks array length (3) does not match [BLANK] count in paragraph (5)',
    };
    expect(classifyIssue(issue)).toBe('major');
  });

  it('classifies MC key count mismatch as major', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'keys',
      severity: 'error',
      message: 'MC key count (8) does not match question count (10)',
    };
    expect(classifyIssue(issue)).toBe('major');
  });

  it('classifies non-letter MC key as major', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'keys',
      severity: 'error',
      message: 'MC key for q1 is "X", expected A/B/C/D',
    };
    expect(classifyIssue(issue)).toBe('major');
  });

  // ---- Minor (quality warnings) ----

  it('classifies answer not found in article as minor', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'summary',
      severity: 'warning',
      message: 'Blank 1 answer "xyz" not found in original article',
    };
    expect(classifyIssue(issue)).toBe('minor');
  });

  it('classifies option length variation as minor', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'mc',
      severity: 'warning',
      message: 'Q1: Option lengths vary significantly (12-48 chars)',
    };
    expect(classifyIssue(issue)).toBe('minor');
  });

  it('classifies type distribution warning as minor', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'mc',
      severity: 'warning',
      message: 'Expected exactly 2 "Finding Evidence" questions, got 5',
    };
    expect(classifyIssue(issue)).toBe('minor');
  });

  it('classifies sentence not matching as minor', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'syntax',
      severity: 'warning',
      message: 'Syntax item 1: original sentence not closely matching article text',
    };
    expect(classifyIssue(issue)).toBe('minor');
  });

  it('classifies keyword not found as minor', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'writing',
      severity: 'warning',
      message: 'Keyword "xyz" not found in article text',
    };
    expect(classifyIssue(issue)).toBe('minor');
  });

  // ---- Edge cases ----

  it('classifies auto-conversion warning as minor', () => {
    const issue: ValidationIssue = {
      type: 'rule',
      section: 'mc',
      severity: 'warning',
      message: 'Q1: Answer was option text "Beta" — auto-converted to letter B',
    };
    expect(classifyIssue(issue)).toBe('minor');
  });

  it('all issues with severity=error that are not "is missing" or global are major', () => {
    // This is the invariant: any non-critical error is recoverable
    const majorIssue: ValidationIssue = {
      type: 'rule',
      section: 'keys',
      severity: 'error',
      message: 'Expansion key count (2) does not match item count (4)',
    };
    expect(classifyIssue(majorIssue)).toBe('major');
  });
});
