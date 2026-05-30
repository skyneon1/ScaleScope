import type { NextRequest } from "next/server";
import { fetchRepoSnapshot } from "@/lib/github/fetch";

export const runtime = "nodejs";

/** Preview the detected repo metadata/manifests before running a full analysis. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return Response.json({ error: "Missing ?url=" }, { status: 400 });
  try {
    const snap = await fetchRepoSnapshot(url);
    return Response.json({
      name: snap.name,
      description: snap.description,
      primaryLanguage: snap.primaryLanguage,
      topics: snap.topics,
      manifests: Object.keys(snap.files),
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
