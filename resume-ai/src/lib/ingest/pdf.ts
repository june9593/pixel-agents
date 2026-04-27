import type { IngestResult } from "./types";

export interface PdfPageLike {
  getTextContent(): Promise<{ items: { str: string }[] }>;
}

export interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
}

interface PdfJsLike {
  getDocument(opts: {
    data: Uint8Array;
  }): { promise: Promise<PdfDocLike> };
}

const MIN_EXTRACTED_CHARS = 50;

let _pdfjs: PdfJsLike | null = null;
async function defaultPdfJs(): Promise<PdfJsLike> {
  if (!_pdfjs) {
    _pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as PdfJsLike;
  }
  return _pdfjs;
}

export async function extractPdf(
  buffer: Buffer,
  deps?: PdfJsLike,
): Promise<IngestResult> {
  const pdfjs = deps ?? (await defaultPdfJs());

  let doc: PdfDocLike;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "PasswordException"
    ) {
      return {
        ok: false,
        code: "PDF_ENCRYPTED",
        message:
          "This PDF is password-protected. Remove the password and re-upload.",
      };
    }
    return {
      ok: false,
      code: "EXTRACTION_FAILED",
      message:
        "Could not read this PDF. Try a different file or paste the text.",
    };
  }

  const chunks: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ("str" in item) chunks.push(item.str);
    }
  }

  const text = chunks.join(" ").replace(/\s+/g, " ").trim();
  if (text.length < MIN_EXTRACTED_CHARS) {
    return {
      ok: false,
      code: "PDF_NO_TEXT",
      message:
        "This PDF appears to be scanned or image-only. Upload a text-based PDF, or paste the content directly.",
    };
  }
  return { ok: true, text };
}
