import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractText } from "../text";

describe("extractText", () => {
  it("returns the text content as-is", async () => {
    const result = await extractText(Buffer.from("John Doe\nSoftware Engineer"));
    assert.deepStrictEqual(result, {
      ok: true,
      text: "John Doe\nSoftware Engineer",
    });
  });

  it("rejects empty input", async () => {
    const result = await extractText(Buffer.from(""));
    assert.deepStrictEqual(result, {
      ok: false,
      code: "EXTRACTION_FAILED",
      message: "File is empty.",
    });
  });

  it("rejects whitespace-only input", async () => {
    const result = await extractText(Buffer.from("   \n\t  "));
    assert.deepStrictEqual(result, {
      ok: false,
      code: "EXTRACTION_FAILED",
      message: "File is empty.",
    });
  });
});
