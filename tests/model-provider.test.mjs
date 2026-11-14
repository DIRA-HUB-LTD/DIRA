import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const logged = vi.hoisted(() => []);
vi.mock("@/lib/agent/logger", () => ({
  logAgentEvent: vi.fn(async (event) => {
    logged.push(event);
    return true;
  }),
}));

import {
  createAgentCompletion,
  GlmConfigurationError,
  resolveModelConfig,
} from "../lib/models.ts";

function okResponse() {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    { status: 200 },
  );
}

describe("model provider configuration", () => {
  it("defaults to GLM-5.3 Flash on Z.AI", () => {
    expect(resolveModelConfig({})).toEqual({
      provider: "z.ai",
      endpoint: "https://api.z.ai/api/paas/v4/chat/completions",
      model: "glm-5.3-flash",
      apiKeyEnv: "ZAI_API_KEY",
      selfHosted: false,
    });
  });

  it("supports a self-hosted OpenAI-compatible open-weights server", () => {
    expect(
      resolveModelConfig({
        DIRA_MODEL_BASE_URL: "http://localhost:11434/v1/",
        DIRA_MODEL_NAME: "qwen3:8b",
        DIRA_MODEL_PROVIDER: "ollama",
      }),
    ).toEqual({
      provider: "ollama",
      endpoint: "http://localhost:11434/v1/chat/completions",
      model: "qwen3:8b",
      apiKeyEnv: "DIRA_MODEL_API_KEY",
      selfHosted: true,
    });
  });

  it("refuses plain http to a remote host unless explicitly allowed", () => {
    expect(() =>
      resolveModelConfig({ DIRA_MODEL_BASE_URL: "http://10.0.0.5:8000/v1", DIRA_MODEL_NAME: "m" }),
    ).toThrow(GlmConfigurationError);
    expect(
      resolveModelConfig({
        DIRA_MODEL_BASE_URL: "http://10.0.0.5:8000/v1",
        DIRA_MODEL_NAME: "m",
        DIRA_MODEL_ALLOW_INSECURE_HTTP: "true",
      }).endpoint,
    ).toBe("http://10.0.0.5:8000/v1/chat/completions");
  });

  it("requires a model name and rejects credentials in the URL", () => {
    expect(() => resolveModelConfig({ DIRA_MODEL_BASE_URL: "https://llm.example.org/v1" })).toThrow(
      /DIRA_MODEL_NAME/,
    );
    expect(() =>
      resolveModelConfig({
        DIRA_MODEL_BASE_URL: "https://user:pass@llm.example.org/v1",
        DIRA_MODEL_NAME: "m",
      }),
    ).toThrow(/credentials/);
  });
});

describe("requests to a self-hosted model", () => {
  beforeEach(() => {
    logged.length = 0;
    vi.stubEnv("DIRA_MODEL_BASE_URL", "http://localhost:8000/v1");
    vi.stubEnv("DIRA_MODEL_NAME", "open-weights-model");
    vi.stubEnv("ZAI_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => okResponse()));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("calls the configured endpoint without Z.AI-only parameters or a key", async () => {
    await createAgentCompletion([{ role: "user", content: "hi" }], [], {
      runId: "11111111-1111-4111-8111-111111111111",
      workflow: "test",
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("http://localhost:8000/v1/chat/completions");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("open-weights-model");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("logs the self-hosted provider and marks per-token cost as not applicable", async () => {
    await createAgentCompletion([{ role: "user", content: "hi" }], [], {
      runId: "11111111-1111-4111-8111-111111111111",
      workflow: "test",
    });
    expect(logged[0]).toMatchObject({
      provider: "self-hosted",
      model: "open-weights-model",
      cost_status: "not_applicable",
      metadata: { self_hosted: true },
    });
  });
});
