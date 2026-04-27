import Anthropic from "@anthropic-ai/sdk";
import type { ResumeJSON } from "@/lib/mock-data";

export type LlmFn = (prompt: string) => Promise<string>;

function defaultLlm(apiKey?: string): LlmFn {
  const client = new Anthropic({ apiKey });
  return async (prompt: string) => {
    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  };
}

const PARSE_PROMPT = `Parse the following resume text into structured JSON matching this exact schema:
{
  "contact": { "name": string, "email": string, "phone": string, "location": string, "linkedin"?: string },
  "summary": string,
  "experience": [{ "title": string, "company": string, "location": string, "startDate": string, "endDate": string, "bullets": string[] }],
  "education": [{ "degree": string, "school": string, "year": string }],
  "skills": string[],
  "certifications"?: string[]
}

Return ONLY valid JSON. No markdown, no explanation.

Resume text:
`;

function validateResume(obj: unknown): ResumeJSON {
  if (!obj || typeof obj !== "object") throw new Error("not an object");
  const r = obj as Record<string, unknown>;
  if (!r.contact || typeof r.contact !== "object") throw new Error("missing contact");
  const c = r.contact as Record<string, unknown>;
  if (typeof c.name !== "string") throw new Error("missing contact.name");
  if (!Array.isArray(r.experience)) throw new Error("missing experience");
  if (!Array.isArray(r.education)) throw new Error("missing education");
  if (!Array.isArray(r.skills)) throw new Error("missing skills");
  if (typeof r.summary !== "string") throw new Error("missing summary");
  return obj as ResumeJSON;
}

export async function parseResumeText(
  rawText: string,
  llm?: LlmFn,
  apiKey?: string,
): Promise<ResumeJSON> {
  const call = llm ?? defaultLlm(apiKey);
  const response = await call(PARSE_PROMPT + rawText);

  try {
    const jsonStr = response.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(jsonStr);
    return validateResume(parsed);
  } catch {
    throw new Error("Failed to parse resume: LLM returned invalid structure");
  }
}
