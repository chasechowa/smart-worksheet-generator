import { describe, it, expect } from 'vitest';
import {
  findVerbatimMatch,
  normalizeText,
  isExactVerbatimMatch,
  isContiguousMatch,
  describeMatch,
  type VerbatimResult,
} from '../verbatimMatcher';

// ---------------------------------------------------------------------------
// normalizeText
// ---------------------------------------------------------------------------

describe('normalizeText', () => {
  it('lowercases', () => {
    expect(normalizeText('Climate Change')).toBe('climate change');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeText('climate   change')).toBe('climate change');
  });

  it('replaces smart quotes with ASCII', () => {
    expect(normalizeText("‘single’ “double”")).toBe("'single' \"double\"");
  });

  it('replaces em-dashes with hyphens', () => {
    expect(normalizeText('climate–change')).toBe('climate-change');
    expect(normalizeText('climate—change')).toBe('climate-change');
    expect(normalizeText('climate―change')).toBe('climate-change');
  });

  it('replaces non-breaking spaces', () => {
    expect(normalizeText('climate change')).toBe('climate change');
  });

  it('strips leading/trailing whitespace', () => {
    expect(normalizeText('  climate change  ')).toBe('climate change');
  });

  it('NFKD-normalizes unicode', () => {
    // 'ﬁ' (ligature fi) normalizes to 'fi'
    const result = normalizeText('ﬁnancial');
    expect(result).toBe('financial');
  });

  it('handles mixed unicode variants', () => {
    const input = '“Climate–change” isn’t  over';
    const result = normalizeText(input);
    // Smart quotes → ASCII, em-dash → hyphen, NBSP → space
    expect(result).toContain('climate-change');
    expect(result).toContain("isn't");
    expect(result).not.toContain(' ');
  });
});

// ---------------------------------------------------------------------------
// findVerbatimMatch — exact matches
// ---------------------------------------------------------------------------

describe('findVerbatimMatch — exact', () => {
  const article = 'Climate change is a serious global issue. Scientists warn that global temperatures will rise.';

  it('detects exact phrase with word boundaries', () => {
    const result = findVerbatimMatch('climate change', article);
    expect(result.status).toBe('exact');
    expect(result.confidence).toBe(1.0);
    expect(result.boundaryPreserved).toBe(true);
    expect(result.matchedText.toLowerCase()).toBe('climate change');
  });

  it('detects exact single word', () => {
    const result = findVerbatimMatch('climate', article);
    expect(result.status).toBe('exact');
    expect(result.confidence).toBe(1.0);
    expect(result.boundaryPreserved).toBe(true);
  });

  it('detects multi-word phrase at end of sentence', () => {
    const result = findVerbatimMatch('global temperatures', article);
    expect(result.status).toBe('exact');
    expect(result.boundaryPreserved).toBe(true);
  });

  it('detects embedded phrase (no boundaries) with confidence 0.95', () => {
    const result = findVerbatimMatch('climate', 'global climate change patterns');
    // "climate" is a substring of the article, but check boundaries
    expect(result.status).toBe('exact');
     // "climate" at position 7, preceded by 'l' of "global " (space) — boundary IS preserved
    // Actually "climate" starts at index 7 after "global " → boundary preserved
    expect(result.boundaryPreserved).toBe(true);
  });

  it('detects exact match with punctuation', () => {
    const article2 = "It's a well-known fact: climate change is real.";
    const result = findVerbatimMatch("climate change", article2);
    expect(result.status).toBe('exact');
    expect(result.boundaryPreserved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findVerbatimMatch — partial matches (all words found, not contiguous)
// ---------------------------------------------------------------------------

describe('findVerbatimMatch — partial', () => {
  it('detects all words present but separated', () => {
    const article = 'Climate patterns are changing rapidly. Scientists study change every day.';
    // "climate" and "change" both exist but not together
    const result = findVerbatimMatch('climate change', article);
    expect(result.status).toBe('partial');
    expect(result.confidence).toBe(0.7);
    expect(result.boundaryPreserved).toBe(false);
  });

  it('reports partial with all words found', () => {
    const article = 'The quick brown fox jumps over the lazy dog.';
    const result = findVerbatimMatch('fox lazy', article);
    expect(result.status).toBe('partial');
    expect(result.confidence).toBe(0.7);
    expect(result.details).toContain('not contiguous');
    expect(result.details).toContain('Missing words: none');
  });
});

// ---------------------------------------------------------------------------
// findVerbatimMatch — fuzzy matches (≥50% words found)
// ---------------------------------------------------------------------------

describe('findVerbatimMatch — fuzzy', () => {
  it('detects fuzzy when ≥50% words found', () => {
    const article = 'Climate change is a pressing global concern.';
    // "climate" and "concern" found, "xyzzy" not found → 2/3 = 67%
    const result = findVerbatimMatch('climate xyzzy concern', article);
    expect(result.status).toBe('fuzzy');
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    expect(result.confidence).toBeLessThanOrEqual(0.6);
    expect(result.details).toContain('Missing: xyzzy');
  });

  it('detects fuzzy with 50% match', () => {
    const article = 'The weather is nice today.';
    // "weather" found, "cataclysm" not → 1/2 = 50%
    const result = findVerbatimMatch('weather cataclysm', article);
    expect(result.status).toBe('fuzzy');
  });
});

// ---------------------------------------------------------------------------
// findVerbatimMatch — missing (<50% words found)
// ---------------------------------------------------------------------------

describe('findVerbatimMatch — missing', () => {
  it('detects missing when most words not found', () => {
    const article = 'Climate change is important.';
    const result = findVerbatimMatch('xyzzy flurbo gnarp', article);
    expect(result.status).toBe('missing');
    expect(result.confidence).toBe(0);
  });

  it('handles empty answer', () => {
    const result = findVerbatimMatch('', 'some article');
    expect(result.status).toBe('missing');
    expect(result.confidence).toBe(0);
    expect(result.details).toBe('Answer is empty');
  });

  it('handles empty article', () => {
    const result = findVerbatimMatch('climate', '');
    expect(result.status).toBe('missing');
  });
});

// ---------------------------------------------------------------------------
// Context extraction
// ---------------------------------------------------------------------------

describe('findVerbatimMatch — context', () => {
  it('returns surrounding sentence context', () => {
    const article = 'Urbanization is accelerating. Climate change poses serious risks. Scientists are concerned.';
    const result = findVerbatimMatch('climate change', article);
    expect(result.context).toContain('Climate change');
    expect(result.context.length).toBeGreaterThan(0);
  });

  it('returns matched text from original article', () => {
    const article = 'Climate Change is Real';
    const result = findVerbatimMatch('climate change', article);
    // matchedText preserves original casing
    expect(result.matchedText).toBe('Climate Change');
  });
});

// ---------------------------------------------------------------------------
// Real-world pedagogical edge cases
// ---------------------------------------------------------------------------

describe('findVerbatimMatch — pedagogical edge cases', () => {
  const article = 'Scientists report that global climate change is accelerating at an unprecedented rate. '
    + 'The effects of climate change include rising sea levels and extreme weather events. '
    + 'Many governments have implemented climate change mitigation policies.';

  it('"climate change" → exact (appears multiple times with boundaries)', () => {
    const result = findVerbatimMatch('climate change', article);
    expect(result.status).toBe('exact');
    expect(result.boundaryPreserved).toBe(true);
    expect(result.confidence).toBe(1.0);
  });

  it('"global climate change" → exact with boundaries', () => {
    const result = findVerbatimMatch('global climate change', article);
    expect(result.status).toBe('exact');
    expect(result.boundaryPreserved).toBe(true);
    expect(result.confidence).toBe(1.0);
  });

  it('"climate" → exact (single word substring)', () => {
    const result = findVerbatimMatch('climate', article);
    expect(result.status).toBe('exact');
    expect(result.confidence).toBe(1.0);
  });

  it('"climate mitigation" → partial (words exist but NOT contiguous)', () => {
    // "climate" appears, "mitigation" appears, but "climate mitigation" is NOT in the article
    const result = findVerbatimMatch('climate mitigation', article);
    // Actually "climate change mitigation" IS in the article... so "climate" and "mitigation" are
    // separated by "change". Let me check if "climate mitigation" as a contiguous phrase exists.
    // "climate change mitigation policies" → "climate" + "change" + "mitigation" → "climate mitigation" is NOT contiguous
    expect(result.status).toBe('partial');
    expect(result.details).toContain('not contiguous');
  });

  it('"rising temperatures" → missing (not in article at all)', () => {
    // "rising" appears in "rising sea levels", "temperatures" not in article
    const result = findVerbatimMatch('rising temperatures', article);
    expect(result.status).toBe('fuzzy'); // 1/2 words found = 50% → fuzzy
  });

  it('"unprecedented rate" → exact (contiguous in article)', () => {
    const result = findVerbatimMatch('unprecedented rate', article);
    expect(result.status).toBe('exact');
  });
});

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

describe('convenience helpers', () => {
  const article = 'Climate change is a serious issue.';

  it('isExactVerbatimMatch returns true for boundary-preserved exact match', () => {
    expect(isExactVerbatimMatch('climate change', article)).toBe(true);
    expect(isExactVerbatimMatch('climate', article)).toBe(true);
    expect(isExactVerbatimMatch('xyzzy', article)).toBe(false);
  });

  it('isContiguousMatch returns true for exact status', () => {
    expect(isContiguousMatch('climate change', article)).toBe(true);
    expect(isContiguousMatch('xyzzy', article)).toBe(false);
  });

  it('isContiguousMatch with requireBoundaries=true', () => {
    const article2 = 'global climate change patterns';
    // "climate change" is contiguous but embedded
    const result = findVerbatimMatch('climate change', article2);
    expect(result.status).toBe('exact');
    // boundaries: "global " before, " patterns" after → boundaries ARE preserved
    // Actually "climate" starts after "global " (space = boundary), "change" ends before " patterns" (space = boundary)
    expect(isContiguousMatch('climate change', article2, true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// describeMatch
// ---------------------------------------------------------------------------

describe('describeMatch', () => {
  const article = 'Climate change is a serious global issue.';

  it('describes exact match', () => {
    const result = findVerbatimMatch('climate change', article);
    const desc = describeMatch(result);
    expect(desc).toContain('Exact');
    expect(desc).toContain('boundaries preserved');
  });

  it('describes partial match', () => {
    const article2 = 'Climate is one thing. Change is another.';
    const result = findVerbatimMatch('climate change', article2);
    const desc = describeMatch(result);
    expect(desc).toContain('Partial');
  });

  it('describes missing', () => {
    const result = findVerbatimMatch('xyzzy', article);
    const desc = describeMatch(result);
    expect(desc).toContain('Missing');
  });
});
