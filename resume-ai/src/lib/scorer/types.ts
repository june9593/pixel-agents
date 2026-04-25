import type { ResumeJSON } from '../mock-data';

export const RUBRIC_CATEGORIES = [
  'jd_match',
  'content_quality',
  'quantification_impact',
  'ats_friendliness',
  'structure_readability',
] as const;

export type RubricCategory = (typeof RUBRIC_CATEGORIES)[number];

export const RUBRIC_LABELS: Record<RubricCategory, string> = {
  jd_match: 'JD Match',
  content_quality: 'Content Quality',
  quantification_impact: 'Quantification & Impact',
  ats_friendliness: 'ATS Friendliness',
  structure_readability: 'Structure & Readability',
};

export const RUBRIC_DESCRIPTIONS: Record<RubricCategory, string> = {
  jd_match:
    'How well the resume addresses the requirements, keywords, and priorities in the target job description.',
  content_quality:
    'Clarity, relevance, and persuasiveness of bullet points, summary, and overall narrative.',
  quantification_impact:
    'Use of concrete numbers, metrics, and measurable outcomes to demonstrate impact.',
  ats_friendliness:
    'Compatibility with applicant tracking systems: standard section headings, keyword density, no parsing-hostile formatting.',
  structure_readability:
    'Logical flow, consistent formatting, appropriate length, and ease of skimming.',
};

export interface CategoryScore {
  category: RubricCategory;
  label: string;
  score: number;
  maxScore: 20;
  rationale: string;
  evidence: string[];
  suggestions: string[];
}

export interface ScoreResponse {
  overall: number;
  categories: CategoryScore[];
  summary: string;
  topStrengths: string[];
  topImprovements: string[];
}

export interface ScoreRequest {
  resume: ResumeJSON;
  jobDescription?: string;
}
