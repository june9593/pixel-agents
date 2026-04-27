import { extractText } from "./text";
import { extractDocx } from "./docx";
import { extractPdf } from "./pdf";
import type { IngestResult } from "./types";
import { MAX_FILE_SIZES } from "./types";

export type { IngestResult, IngestErrorCode } from "./types";

export async function ingest(
  buffer: Buffer,
  filename: string,
): Promise<IngestResult> {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();

  if (ext === ".doc") {
    return {
      ok: false,
      code: "UNSUPPORTED_FORMAT",
      message:
        ".doc isn't supported. Open it in Word and Save As .docx or PDF.",
    };
  }

  const supported = new Set([".txt", ".docx", ".pdf"]);
  if (!supported.has(ext)) {
    return {
      ok: false,
      code: "UNSUPPORTED_FORMAT",
      message:
        "We support .txt, .docx, and .pdf files. Save your resume as one of these and try again.",
    };
  }

  const maxSize = MAX_FILE_SIZES[ext] ?? MAX_FILE_SIZES[".txt"];
  if (buffer.length > maxSize) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `File is too large (${(buffer.length / 1_048_576).toFixed(1)} MB). Maximum is ${(maxSize / 1_048_576).toFixed(0)} MB.`,
    };
  }

  switch (ext) {
    case ".txt":
      return extractText(buffer);
    case ".docx":
      return extractDocx(buffer);
    case ".pdf":
      return extractPdf(buffer);
    default:
      return { ok: false, code: "UNSUPPORTED_FORMAT", message: "Unsupported format." };
  }
}
