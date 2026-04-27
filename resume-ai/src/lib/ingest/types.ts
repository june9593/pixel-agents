export type IngestErrorCode =
  | "UNSUPPORTED_FORMAT"
  | "FILE_TOO_LARGE"
  | "PDF_ENCRYPTED"
  | "PDF_NO_TEXT"
  | "EXTRACTION_FAILED";

export type IngestResult =
  | { ok: true; text: string }
  | { ok: false; code: IngestErrorCode; message: string };

export const MAX_FILE_SIZES: Record<string, number> = {
  ".txt": 100_000,
  ".docx": 5_242_880,
  ".pdf": 10_485_760,
};

export const SUPPORTED_EXTENSIONS = [".txt", ".pdf", ".docx"] as const;
