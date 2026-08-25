export interface DetectedModel {
  id: string;
}

export interface DetectResult {
  models: string[];
  providerHint: "openai" | "anthropic" | "unknown";
}

function hybridHeaders(apiKey: string): Record<string, string>[] {
  if (!apiKey) return [{}];
  // hybrid: coba Bearer dan x-api-key
  return [
    { Authorization: `Bearer ${apiKey}`, "x-api-key": apiKey },
    { Authorization: `Bearer ${apiKey}` },
    { "x-api-key": apiKey },
  ];
}

async function tryFetchModels(baseUrl: string, headers: Record<string, string>, signal: AbortSignal): Promise<string[] | null> {
  const urls = [
    `${baseUrl.replace(/\/+$/, "")}/models`,
    `${baseUrl.replace(/\/+$/, "")}/v1/models`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, signal });
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: { id: string }[]; models?: { id: string }[] };
      const data = json.data ?? json.models ?? [];
      if (Array.isArray(data) && data.length) return data.map((m) => m.id).filter(Boolean);
      // anthropic format: {data: [{id, display_name}]}
      if (Array.isArray((json as unknown as { models: unknown }).models)) {
        return (json as unknown as { models: { id: string }[] }).models.map((m) => m.id);
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function detectModels(baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<DetectResult> {
  // CAP global 6s — jangan pernah biarkan user menunggu >6s pada gateway
  // yang offline (2 url × 3 header = sampai 30s sebelumnya).
  const sig = signal ?? AbortSignal.timeout(6000);
  for (const h of hybridHeaders(apiKey)) {
    if (sig.aborted) break;
    const models = await tryFetchModels(baseUrl, h, sig);
    if (models && models.length) {
      // Prioritas: baseUrl (anthropic.com → anthropic) → nama model (claude/gpt)
      // Gateway seperti b.ai, OpenRouter: baseUrl TIDAK anthropic → openai-compat
      const hint = baseUrl.includes("anthropic") ? "anthropic" : "openai";
      return { models, providerHint: hint as DetectResult["providerHint"] };
    }
  }
  return { models: [], providerHint: "unknown" };
}
