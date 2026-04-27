import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractDocx } from "../docx";

describe("extractDocx", () => {
  it("extracts raw text from a valid docx buffer", async () => {
    const result = await extractDocx(Buffer.from("fake-docx-bytes"), {
      extractRawText: async () => ({
        value: "Jane Smith\nProduct Manager\n5 years experience",
        messages: [],
      }),
    });
    assert.deepStrictEqual(result, {
      ok: true,
      text: "Jane Smith\nProduct Manager\n5 years experience",
    });
  });

  it("returns EXTRACTION_FAILED when extraction throws", async () => {
    const result = await extractDocx(Buffer.from("bad-bytes"), {
      extractRawText: async () => {
        throw new Error("corrupt");
      },
    });
    assert.deepStrictEqual(result, {
      ok: false,
      code: "EXTRACTION_FAILED",
      message:
        "Could not read this .docx file. Try re-saving it, or upload a PDF.",
    });
  });

  it("returns EXTRACTION_FAILED for empty docx", async () => {
    const result = await extractDocx(Buffer.from("empty-docx"), {
      extractRawText: async () => ({
        value: "   ",
        messages: [],
      }),
    });
    assert.deepStrictEqual(result, {
      ok: false,
      code: "EXTRACTION_FAILED",
      message: "The .docx file appears to be empty.",
    });
  });
});
