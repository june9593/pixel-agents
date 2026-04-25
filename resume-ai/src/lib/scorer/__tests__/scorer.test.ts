import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateScoreResponse, RUBRIC_CATEGORIES, buildScorerPrompt } from '../index';
import { mockResume, mockJobDescription } from '../../mock-data';

function makeValidResponse() {
  return {
    overall: 72,
    categories: RUBRIC_CATEGORIES.map((cat, i) => ({
      category: cat,
      label: cat,
      score: [16, 15, 14, 13, 14][i],
      maxScore: 20,
      rationale: `Rationale for ${cat}`,
      evidence: ['Evidence item 1'],
      suggestions: ['Suggestion item 1'],
    })),
    summary: 'Overall a solid resume with room for improvement.',
    topStrengths: ['Good quantification', 'Clear structure', 'Relevant skills'],
    topImprovements: ['Add more metrics', 'Tailor to JD', 'Improve summary'],
  };
}

describe('validateScoreResponse', () => {
  it('accepts a valid response', () => {
    const result = validateScoreResponse(makeValidResponse());
    assert.equal(result.overall, 72);
    assert.equal(result.categories.length, 5);
  });

  it('rejects non-object input', () => {
    assert.throws(() => validateScoreResponse(null), /must be an object/);
    assert.throws(() => validateScoreResponse('string'), /must be an object/);
  });

  it('rejects overall score out of bounds', () => {
    const r = makeValidResponse();
    r.overall = 150;
    assert.throws(() => validateScoreResponse(r), /overall/);
  });

  it('rejects wrong number of categories', () => {
    const r = makeValidResponse();
    r.categories = r.categories.slice(0, 3);
    assert.throws(() => validateScoreResponse(r), /exactly 5/);
  });

  it('rejects categories in wrong order', () => {
    const r = makeValidResponse();
    const tmp = r.categories[0];
    r.categories[0] = r.categories[1];
    r.categories[1] = tmp;
    assert.throws(() => validateScoreResponse(r), /must be/);
  });

  it('rejects category score out of bounds', () => {
    const r = makeValidResponse();
    r.categories[0].score = 25;
    assert.throws(() => validateScoreResponse(r), /0-20/);
  });

  it('rejects mismatched overall vs sum', () => {
    const r = makeValidResponse();
    r.overall = 50;
    assert.throws(() => validateScoreResponse(r), /sum of category scores/);
  });

  it('rejects empty summary', () => {
    const r = makeValidResponse();
    r.summary = '';
    assert.throws(() => validateScoreResponse(r), /summary/);
  });

  it('rejects empty topStrengths', () => {
    const r = makeValidResponse();
    r.topStrengths = [];
    assert.throws(() => validateScoreResponse(r), /topStrengths/);
  });

  it('rejects empty topImprovements', () => {
    const r = makeValidResponse();
    r.topImprovements = [];
    assert.throws(() => validateScoreResponse(r), /topImprovements/);
  });

  it('normalizes overall to sum of categories', () => {
    const r = makeValidResponse();
    const sum = r.categories.reduce((a, c) => a + c.score, 0);
    r.overall = sum;
    const result = validateScoreResponse(r);
    assert.equal(result.overall, sum);
  });

  it('sets maxScore to 20 on all categories', () => {
    const result = validateScoreResponse(makeValidResponse());
    result.categories.forEach((cat) => {
      assert.equal(cat.maxScore, 20);
    });
  });

  it('preserves evidence and suggestions arrays', () => {
    const r = makeValidResponse();
    r.categories[0].evidence = ['ev1', 'ev2'];
    r.categories[0].suggestions = ['s1', 's2', 's3'];
    const result = validateScoreResponse(r);
    assert.deepEqual(result.categories[0].evidence, ['ev1', 'ev2']);
    assert.deepEqual(result.categories[0].suggestions, ['s1', 's2', 's3']);
  });
});

describe('buildScorerPrompt', () => {
  it('includes all rubric categories', () => {
    const prompt = buildScorerPrompt(JSON.stringify(mockResume));
    for (const cat of RUBRIC_CATEGORIES) {
      assert.ok(prompt.includes(cat), `Prompt should contain category ${cat}`);
    }
  });

  it('includes resume JSON', () => {
    const prompt = buildScorerPrompt(JSON.stringify(mockResume));
    assert.ok(prompt.includes('Alex Chen'));
  });

  it('handles no-JD path', () => {
    const prompt = buildScorerPrompt(JSON.stringify(mockResume));
    assert.ok(prompt.includes('No target job description'));
    assert.ok(!prompt.includes('<job_description>'));
  });

  it('handles with-JD path', () => {
    const prompt = buildScorerPrompt(JSON.stringify(mockResume), mockJobDescription);
    assert.ok(prompt.includes('<job_description>'));
    assert.ok(prompt.includes('FinTech'));
  });
});

describe('RUBRIC_CATEGORIES', () => {
  it('has exactly 5 categories', () => {
    assert.equal(RUBRIC_CATEGORIES.length, 5);
  });

  it('categories sum to 100 max possible', () => {
    assert.equal(RUBRIC_CATEGORIES.length * 20, 100);
  });
});
