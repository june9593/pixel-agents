import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingest } from "../index";

describe("ingest dispatcher", () => {
  it("routes .txt files to text extractor", async () => {
    const result = await ingest(Buffer.from("hello world resume content here enough text to pass"), "resume.txt");
    assert.deepStrictEqual(result, {
      ok: true,
      text: "hello world resume content here enough text to pass",
    });
  });

  it("rejects .doc with UNSUPPORTED_FORMAT and helpful message", async () => {
    const result = await ingest(Buffer.from(""), "resume.doc");
    assert.deepStrictEqual(result, {
      ok: false,
      code: "UNSUPPORTED_FORMAT",
      message:
        ".doc isn't supported. Open it in Word and Save As .docx or PDF.",
    });
  });

  it("rejects unknown formats", async () => {
    const result = await ingest(Buffer.from(""), "resume.rtf");
    assert.deepStrictEqual(result, {
      ok: false,
      code: "UNSUPPORTED_FORMAT",
      message:
        "We support .txt, .docx, and .pdf files. Save your resume as one of these and try again.",
    });
  });

  it("rejects files exceeding size limit", async () => {
    const bigBuffer = Buffer.alloc(11_000_000);
    const result = await ingest(bigBuffer, "resume.pdf");
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.code, "FILE_TOO_LARGE");
      assert.ok(result.message.includes("too large"));
    }
  });

  it("rejects image files", async () => {
    const result = await ingest(Buffer.from(""), "photo.jpg");
    assert.deepStrictEqual(result, {
      ok: false,
      code: "UNSUPPORTED_FORMAT",
      message:
        "We support .txt, .docx, and .pdf files. Save your resume as one of these and try again.",
    });
  });
});
