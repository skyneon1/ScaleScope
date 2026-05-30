/**
 * AI provider configuration. Models are addressed as plain "provider/model"
 * strings routed through the Vercel AI Gateway (set AI_GATEWAY_API_KEY locally,
 * automatic on Vercel). When no key is present the app falls back to the
 * deterministic heuristic profiler/advisor, so it always works offline.
 */
export function aiEnabled(): boolean {
  if (process.env.SCALESCOPE_NO_AI === "1") return false;
  return Boolean(
    process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN ||
      process.env.SCALESCOPE_MODEL,
  );
}

/** Model used for profiling & narration. Override with SCALESCOPE_MODEL. */
export function modelId(): string {
  return process.env.SCALESCOPE_MODEL || "anthropic/claude-sonnet-4.5";
}
