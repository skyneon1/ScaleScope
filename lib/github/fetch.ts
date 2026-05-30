/**
 * Lightweight GitHub repo inspection: pulls the repo metadata and a set of
 * dependency/manifest files so the profiler can infer the stack. Works
 * unauthenticated for public repos; set GITHUB_TOKEN to raise rate limits.
 */

export interface RepoSnapshot {
  owner: string;
  repo: string;
  name: string;
  description: string;
  primaryLanguage: string;
  topics: string[];
  files: Record<string, string>;
  /** concatenated, truncated text for prompting / heuristics. */
  digest: string;
}

const MANIFESTS = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "Cargo.toml",
  "composer.json",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "next.config.js",
  "next.config.ts",
  "fly.toml",
  "vercel.json",
  "serverless.yml",
];

export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (!/github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "scalescope",
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function fetchRaw(owner: string, repo: string, branch: string, path: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "scalescope" } });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 6000); // cap per file
  } catch {
    return null;
  }
}

export async function fetchRepoSnapshot(url: string): Promise<RepoSnapshot> {
  const parsed = parseRepoUrl(url);
  if (!parsed) throw new Error("Not a valid GitHub repository URL.");
  const { owner, repo } = parsed;

  const metaRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: authHeaders(),
  });
  if (!metaRes.ok) {
    throw new Error(
      metaRes.status === 404
        ? "Repository not found (is it public?)."
        : `GitHub API error ${metaRes.status}.`,
    );
  }
  const meta = (await metaRes.json()) as {
    name: string;
    description: string | null;
    language: string | null;
    topics?: string[];
    default_branch: string;
  };

  const branch = meta.default_branch || "main";
  const files: Record<string, string> = {};
  await Promise.all(
    MANIFESTS.map(async (path) => {
      const content = await fetchRaw(owner, repo, branch, path);
      if (content) files[path] = content;
    }),
  );

  const digestParts: string[] = [
    `Repository: ${owner}/${repo}`,
    `Description: ${meta.description ?? "(none)"}`,
    `Primary language: ${meta.language ?? "unknown"}`,
    `Topics: ${(meta.topics ?? []).join(", ") || "(none)"}`,
  ];
  for (const [path, content] of Object.entries(files)) {
    digestParts.push(`\n--- ${path} ---\n${content}`);
  }

  return {
    owner,
    repo,
    name: meta.name,
    description: meta.description ?? "",
    primaryLanguage: meta.language ?? "",
    topics: meta.topics ?? [],
    files,
    digest: digestParts.join("\n").slice(0, 24_000),
  };
}
