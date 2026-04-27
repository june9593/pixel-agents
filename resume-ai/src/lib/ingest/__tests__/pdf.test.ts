import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractPdf } from "../pdf";
import type { PdfDocLike } from "../pdf";

function makeMockDoc(pages: string[][]): PdfDocLike {
  return {
    numPages: pages.length,
    getPage: async (n: number) => ({
      getTextContent: async () => ({
        items: pages[n - 1].map((str) => ({ str })),
      }),
    }),
  };
}

describe("extractPdf", () => {
  it("extracts text from a text-based PDF", async () => {
    const doc = makeMockDoc([
      ["John Doe ", "Software Engineer"],
      ["5 years experience ", "in TypeScript"],
    ]);
    const result = await extractPdf(Buffer.from("fake"), {
      getDocument: () => ({ promise: Promise.resolve(doc) }),
    });
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.ok(result.text.includes("John Doe"));
      assert.ok(result.text.includes("TypeScript"));
    }
  });

  it("returns PDF_NO_TEXT when extracted text is too short", async () => {
    const doc = makeMockDoc([["hi"]]);
    const result = await extractPdf(Buffer.from("fake"), {
      getDocument: () => ({ promise: Promise.resolve(doc) }),
    });
    assert.deepStrictEqual(result, {
      ok: false,
      code: "PDF_NO_TEXT",
      message:
        "This PDF appears to be scanned or image-only. Upload a text-based PDF, or paste the content directly.",
    });
  });

  it("returns PDF_ENCRYPTED for password-protected PDFs", async () => {
    const err = new Error("password required");
    (err as Error & { name: string }).name = "PasswordException";
    const result = await extractPdf(Buffer.from("fake"), {
      getDocument: () => ({
        promise: Promise.reject(err),
      }),
    });
    assert.deepStrictEqual(result, {
      ok: false,
      code: "PDF_ENCRYPTED",
      message:
        "This PDF is password-protected. Remove the password and re-upload.",
    });
  });

  it("returns EXTRACTION_FAILED for corrupt PDFs", async () => {
    const result = await extractPdf(Buffer.from("fake"), {
      getDocument: () => ({
        promise: Promise.reject(new Error("corrupt")),
      }),
    });
    assert.deepStrictEqual(result, {
      ok: false,
      code: "EXTRACTION_FAILED",
      message:
        "Could not read this PDF. Try a different file or paste the text.",
    });
  });
});
