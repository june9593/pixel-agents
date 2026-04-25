import { RUBRIC_CATEGORIES, RUBRIC_LABELS, RUBRIC_DESCRIPTIONS, type RubricCategory } from './types';

function buildRubricBlock(): string {
  return RUBRIC_CATEGORIES.map(
    (cat) =>
      `### ${RUBRIC_LABELS[cat]} (\`${cat}\`)
${RUBRIC_DESCRIPTIONS[cat]}
Score 0-20.`,
  ).join('\n\n');
}

export function buildScorerPrompt(resumeJson: string, jobDescription?: string): string {
  const jdSection = jobDescription
    ? `## Target Job Description
<job_description>
${jobDescription}
</job_description>

When scoring "JD Match", evaluate the resume specifically against this job description.`
    : `No target job description was provided. For "JD Match", evaluate the resume's general marketability and breadth of appeal for the candidate's apparent target role.`;

  return `You are a senior resume reviewer. Score the resume below using the rubric categories listed.

## Resume (JSON)
<resume>
${resumeJson}
</resume>

${jdSection}

## Scoring Rubric
Each category is scored 0-20. The overall score is the sum (0-100).

${buildRubricBlock()}

## Output Format
Return ONLY valid JSON matching this schema exactly — no markdown fences, no commentary:

{
  "overall": <number 0-100>,
  "categories": [
    {
      "category": "<category_id>",
      "label": "<human label>",
      "score": <0-20>,
      "maxScore": 20,
      "rationale": "<2-3 sentence explanation>",
      "evidence": ["<quote or cite from resume>", ...],
      "suggestions": ["<actionable improvement>", ...]
    }
  ],
  "summary": "<2-3 sentence overall assessment>",
  "topStrengths": ["<strength>", "<strength>", "<strength>"],
  "topImprovements": ["<improvement>", "<improvement>", "<improvement>"]
}

Rules:
- Each category MUST appear exactly once, in the order: ${RUBRIC_CATEGORIES.join(', ')}.
- "evidence" must cite actual content from the resume — never fabricate.
- "suggestions" must be concrete and actionable.
- Do not reference specific company hiring policies.
- The overall score MUST equal the sum of category scores.
- Return raw JSON only.`;
}

export function parseCategory(cat: string): RubricCategory | null {
  return RUBRIC_CATEGORIES.includes(cat as RubricCategory) ? (cat as RubricCategory) : null;
}
