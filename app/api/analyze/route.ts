import type { NextRequest } from "next/server";
import { AnalysisRequestSchema } from "@/lib/model/schema";
import { analyze } from "@/lib/analysis/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = AnalysisRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  const emit = (data: unknown) =>
    writer.write(encoder.encode(JSON.stringify(data) + "\n"));

  (async () => {
    try {
      const result = await analyze(parsed.data, emit as Parameters<typeof analyze>[1]);
      emit({ type: "done", result });
    } catch (err) {
      emit({ type: "error", message: (err as Error).message });
    } finally {
      writer.close();
    }
  })();

  return new Response(readable, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
