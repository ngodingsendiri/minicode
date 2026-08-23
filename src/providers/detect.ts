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
      const res = await fetch(url, { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]) });
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
  const sig = signal ?? AbortSignal.timeout(5000);
  for (const h of hybridHeaders(apiKey)) {
    if (sig.aborted) break;
    const models = await tryFetchModels(baseUrl, h, sig);
    if (models && models.length) {
      const hint = models.some((m) => m.includes("claude")) ? "anthropic" : models.some((m) => m.includes("gpt") || m.includes("o1")) ? "openai" : "unknown";
      return { models, providerHint: hint as DetectResult["providerHint"] };
    }
  }
  return { models: [], providerHint: "unknown" };
}
