import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { ResumeJSON } from "@/lib/mock-data";

const fakeResume: ResumeJSON = {
  contact: { name: "Test", email: "t@t.com", phone: "555", location: "NY" },
  summary: "Engineer",
  experience: [],
  education: [],
  skills: ["TS"],
};

describe("POST /api/parse/resume", () => {
  let POST: (request: Request) => Promise<Response>;
  let rc: { testLlm: unknown };

  before(async () => {
    const mod = await import("../route");
    POST = mod.POST;
    rc = mod.routeConfig;
    rc.testLlm = async () => JSON.stringify(fakeResume);
  });

  afterEach(() => {
    rc.testLlm = async () => JSON.stringify(fakeResume);
  });

  it("accepts JSON rawText and returns parsed resume", async () => {
    const request = new Request("http://localhost/api/parse/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText: "John Doe\nSoftware Engineer" }),
    });

    const response = await POST(request);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(data.resume);
    assert.strictEqual(data.resume.contact.name, "Test");
  });

  it("accepts multipart/form-data with .txt file", async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob(["John Doe\nSoftware Engineer\n5 years"], { type: "text/plain" }),
      "resume.txt",
    );

    const request = new Request("http://localhost/api/parse/resume", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(data.resume);
  });

  it("returns 415 for unsupported format (.doc)", async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new Blob(["data"], { type: "application/msword" }),
      "resume.doc",
    );

    const request = new Request("http://localhost/api/parse/resume", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request);
    assert.strictEqual(response.status, 415);
    const data = await response.json();
    assert.strictEqual(data.code, "UNSUPPORTED_FORMAT");
  });

  it("returns 400 when no rawText in JSON body", async () => {
    const request = new Request("http://localhost/api/parse/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    assert.strictEqual(response.status, 400);
  });

  it("returns 400 when multipart has no file", async () => {
    const formData = new FormData();
    formData.append("other", "value");

    const request = new Request("http://localhost/api/parse/resume", {
      method: "POST",
      body: formData,
    });

    const response = await POST(request);
    assert.strictEqual(response.status, 400);
  });
});
