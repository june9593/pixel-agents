import { ingest } from "@/lib/ingest";
import { parseResumeText, type LlmFn } from "@/lib/parser";

export const routeConfig = { testLlm: undefined as LlmFn | undefined };

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  let rawText: string;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return Response.json({ error: "No file provided." }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await ingest(buffer, file.name);
    if (!result.ok) {
      const status =
        result.code === "UNSUPPORTED_FORMAT"
          ? 415
          : result.code === "FILE_TOO_LARGE"
            ? 413
            : 422;
      return Response.json(
        { error: result.message, code: result.code },
        { status },
      );
    }
    rawText = result.text;
  } else {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (typeof body.rawText !== "string" || !body.rawText.trim()) {
      return Response.json(
        { error: "rawText field is required" },
        { status: 400 },
      );
    }
    rawText = body.rawText;
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const resume = await parseResumeText(rawText, routeConfig.testLlm, apiKey);
    return Response.json({ resume });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Parsing failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
