import { expect, test } from "bun:test";
import { buildProviderList } from "../src/providers/build.ts";

test("buildProviderList: mempertahankan id unik tiap provider", () => {
  const cfg = {
    providers: [
      { id: "alpha", baseUrl: "https://alpha.example/v1", apiKey: "k1", models: ["m-a"] },
      { id: "beta", baseUrl: "https://beta.example/v1", apiKey: "k2", models: ["m-b"] },
      { id: "anthro", baseUrl: "https://api.anthropic.com", apiKey: "k3", models: ["claude-sonnet-4"], providerHint: "anthropic" },
    ],
  };
  const list = buildProviderList(cfg);
  expect(list.map((p) => p.id)).toEqual(["alpha", "beta", "anthro"]);
});
