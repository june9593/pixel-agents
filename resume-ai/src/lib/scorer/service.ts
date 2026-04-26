import Anthropic from '@anthropic-ai/sdk';
import { buildScorerPrompt } from './prompt';
import {
  RUBRIC_CATEGORIES,
  RUBRIC_LABELS,
  type ScoreRequest,
  type ScoreResponse,
  type CategoryScore,
} from './types';

export class ScorerService {
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({ apiKey });
  }

  async score(request: ScoreRequest): Promise<ScoreResponse> {
    const resumeJson = JSON.stringify(request.resume, null, 2);
    const prompt = buildScorerPrompt(resumeJson, request.jobDescription);

    const message = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return validateScoreResponse(JSON.parse(text));
  }
}

export function validateScoreResponse(raw: unknown): ScoreResponse {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Score response must be an object');
  }
  const obj = raw as Record<string, unknown>;

  if (!Number.isFinite(obj.overall) || !Number.isInteger(obj.overall) || (obj.overall as number) < 0 || (obj.overall as number) > 100) {
    throw new Error('overall must be an integer between 0 and 100');
  }

  if (!Array.isArray(obj.categories) || obj.categories.length !== RUBRIC_CATEGORIES.length) {
    throw new Error(`categories must contain exactly ${RUBRIC_CATEGORIES.length} entries`);
  }

  const categories: CategoryScore[] = obj.categories.map((cat: unknown, i: number) => {
    const c = cat as Record<string, unknown>;
    const expectedCat = RUBRIC_CATEGORIES[i];

    if (c.category !== expectedCat) {
      throw new Error(`Category at index ${i} must be "${expectedCat}", got "${c.category}"`);
    }
    if (!Number.isFinite(c.score) || !Number.isInteger(c.score) || (c.score as number) < 0 || (c.score as number) > 20) {
      throw new Error(`Score for ${expectedCat} must be an integer 0-20`);
    }
    if (typeof c.rationale !== 'string' || c.rationale.length === 0) {
      throw new Error(`Rationale for ${expectedCat} must be a non-empty string`);
    }
    if (!Array.isArray(c.evidence) || !c.evidence.every((e: unknown) => typeof e === 'string')) {
      throw new Error(`Evidence for ${expectedCat} must be an array of strings`);
    }
    if (!Array.isArray(c.suggestions) || !c.suggestions.every((s: unknown) => typeof s === 'string')) {
      throw new Error(`Suggestions for ${expectedCat} must be an array of strings`);
    }

    return {
      category: expectedCat,
      label: RUBRIC_LABELS[expectedCat],
      score: c.score,
      maxScore: 20 as const,
      rationale: c.rationale,
      evidence: c.evidence as string[],
      suggestions: c.suggestions as string[],
    };
  });

  const sum = categories.reduce((acc, c) => acc + c.score, 0);
  const overall = Math.round(obj.overall as number);
  if (Math.abs(overall - sum) > 1) {
    throw new Error(`Overall score (${overall}) must equal sum of category scores (${sum})`);
  }

  if (typeof obj.summary !== 'string' || obj.summary.length === 0) {
    throw new Error('summary must be a non-empty string');
  }
  if (!Array.isArray(obj.topStrengths) || obj.topStrengths.length === 0 || !obj.topStrengths.every((s: unknown) => typeof s === 'string')) {
    throw new Error('topStrengths must be a non-empty array of strings');
  }
  if (!Array.isArray(obj.topImprovements) || obj.topImprovements.length === 0 || !obj.topImprovements.every((s: unknown) => typeof s === 'string')) {
    throw new Error('topImprovements must be a non-empty array of strings');
  }

  return {
    overall: sum,
    categories,
    summary: obj.summary as string,
    topStrengths: obj.topStrengths as string[],
    topImprovements: obj.topImprovements as string[],
  };
}
