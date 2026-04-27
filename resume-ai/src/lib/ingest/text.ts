import type { IngestResult } from "./types";

export async function extractText(buffer: Buffer): Promise<IngestResult> {
  const text = buffer.toString("utf-8");
  if (!text.trim()) {
    return { ok: false, code: "EXTRACTION_FAILED", message: "File is empty." };
  }
  return { ok: true, text };
}
