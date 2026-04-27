import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseResumeText } from "../index";
import type { ResumeJSON } from "@/lib/mock-data";

const sampleResume: ResumeJSON = {
  contact: { name: "Jane Doe", email: "jane@example.com", phone: "555-1234", location: "NY" },
  summary: "Engineer with 5 years experience",
  experience: [
    {
      title: "Engineer",
      company: "Acme",
      location: "NY",
      startDate: "2020",
      endDate: "Present",
      bullets: ["Built things"],
    },
  ],
  education: [{ degree: "BS CS", school: "MIT", year: "2020" }],
  skills: ["TypeScript"],
};

describe("parseResumeText", () => {
  it("returns parsed resume from LLM", async () => {
    const mockLlm = async () => JSON.stringify(sampleResume);
    const result = await parseResumeText("John Doe\nSoftware Engineer\n5 years", mockLlm);
    assert.strictEqual(result.contact.name, "Jane Doe");
    assert.ok(result.experience.length > 0);
    assert.ok(result.skills.length > 0);
  });

  it("throws on invalid LLM output", async () => {
    const mockLlm = async () => "not json";
    await assert.rejects(() => parseResumeText("some text", mockLlm), {
      message: /Failed to parse resume/,
    });
  });

  it("throws on missing required fields", async () => {
    const mockLlm = async () => JSON.stringify({ contact: { name: "Test" } });
    await assert.rejects(() => parseResumeText("some text", mockLlm), {
      message: /Failed to parse resume/,
    });
  });
});
