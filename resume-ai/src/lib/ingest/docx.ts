import mammoth from "mammoth";
import type { IngestResult } from "./types";

interface MammothLike {
  extractRawText(
    input: { buffer: Buffer },
  ): Promise<{ value: string; messages: unknown[] }>;
}

export async function extractDocx(
  buffer: Buffer,
  deps: MammothLike = mammoth,
): Promise<IngestResult> {
  try {
    const { value } = await deps.extractRawText({ buffer });
    const text = value.trim();
    if (!text) {
      return {
        ok: false,
        code: "EXTRACTION_FAILED",
        message: "The .docx file appears to be empty.",
      };
    }
    return { ok: true, text };
  } catch {
    return {
      ok: false,
      code: "EXTRACTION_FAILED",
      message:
        "Could not read this .docx file. Try re-saving it, or upload a PDF.",
    };
  }
}
