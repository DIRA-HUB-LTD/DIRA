import "server-only";

import { logAgentEvent } from "@/lib/agent/logger";

/**
 * Model provider configuration.
 *
 * Default: GLM-5.3 Flash on Z.AI's hosted API (ZAI_API_KEY).
 * Self-hosted open-weights: set DIRA_MODEL_BASE_URL to any OpenAI-compatible
 * endpoint (for example vLLM or Ollama serving an open-weights GLM or Qwen model
 * inside the school's or DIRA's own infrastructure) plus DIRA_MODEL_NAME. Learner
 * records then never leave infrastructure you control. DIRA_MODEL_API_KEY is
 * optional for local servers.
 *
 * The configuration is read once at start-up; restart the server after changing it.
 */
export const ZAI_MODEL = "glm-5.3-flash";
const ZAI_ENDPOINT = "https://api.z.ai/api/paas/v4/chat/completions";
const GLM_REQUEST_TIMEOUT_MS = 75_000;

export interface ModelConfig {
  provider: string;
  endpoint: string;
  model: string;
  apiKeyEnv: "ZAI_API_KEY" | "DIRA_MODEL_API_KEY";
  selfHosted: boolean;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

export function resolveModelConfig(env: NodeJS.ProcessEnv = process.env): ModelConfig {
  const baseUrl = env.DIRA_MODEL_BASE_URL?.trim();
  if (!baseUrl) {
    return {
      provider: "z.ai",
      endpoint: ZAI_ENDPOINT,
      model: ZAI_MODEL,
      apiKeyEnv: "ZAI_API_KEY",
      selfHosted: false,
    };
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new GlmConfigurationError("DIRA_MODEL_BASE_URL must be a valid URL");
  }
  const insecureAllowed =
    LOCAL_HOSTS.has(url.hostname) || env.DIRA_MODEL_ALLOW_INSECURE_HTTP === "true";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && insecureAllowed)) {
    throw new GlmConfigurationError(
      "DIRA_MODEL_BASE_URL must use https (http is allowed only for localhost, or with DIRA_MODEL_ALLOW_INSECURE_HTTP=true on a private network)",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new GlmConfigurationError("DIRA_MODEL_BASE_URL must not contain credentials or query strings");
  }
  const model = env.DIRA_MODEL_NAME?.trim();
  if (!model) {
    throw new GlmConfigurationError("DIRA_MODEL_NAME is required when DIRA_MODEL_BASE_URL is set");
  }
  return {
    provider: env.DIRA_MODEL_PROVIDER?.trim() || "self-hosted",
    endpoint: `${url.href.replace(/\/+$/, "")}/chat/completions`,
    model,
    apiKeyEnv: "DIRA_MODEL_API_KEY",
    selfHosted: true,
  };
}

function safeResolveModelConfig(): ModelConfig | null {
  try {
    return resolveModelConfig();
  } catch {
    return null;
  }
}

const STARTUP_MODEL_CONFIG = safeResolveModelConfig();

/** Model name recorded in logs and saved assessments. */
export const DIRA_AGENT_MODEL = STARTUP_MODEL_CONFIG?.model ?? ZAI_MODEL;

export interface AgentFunctionTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentFunctionCall {
  id: string;
  name: string;
  arguments: string;
}

export type AgentMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export interface AgentCompletion {
  content: string | null;
  toolCalls: AgentFunctionCall[];
  usage: ModelUsage | null;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface ModelCallContext {
  runId: string;
  workflow: string;
  attempt?: number;
}

export class GlmConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlmConfigurationError";
  }
}

export class GlmRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlmRequestError";
  }
}

function sanitizeDiagnostic(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_ -]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .slice(0, 500);
}

function describeRequestError(
  error: unknown,
  depth = 0,
): Record<string, unknown> {
  if (depth > 2) return {};
  if (!(error instanceof Error)) {
    return { errorMessage: sanitizeDiagnostic(String(error)) };
  }

  const details: Record<string, unknown> = {
    errorName: sanitizeDiagnostic(error.name),
    errorMessage: sanitizeDiagnostic(error.message),
  };
  const properties = error as Error & Record<string, unknown>;
  for (const key of ["code", "syscall", "hostname", "port"] as const) {
    const value = properties[key];
    if (typeof value === "string" || typeof value === "number") {
      details[key === "code" ? "errorCode" : key] =
        sanitizeDiagnostic(String(value));
    }
  }
  if (properties.cause !== undefined) {
    details.cause = describeRequestError(properties.cause, depth + 1);
  }
  return details;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTokenCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0
    ? value
    : null;
}

function parseUsage(value: unknown): ModelUsage | null {
  if (!isRecord(value)) return null;
  const inputTokens = readTokenCount(value.prompt_tokens);
  const outputTokens = readTokenCount(value.completion_tokens);
  if (inputTokens === null || outputTokens === null) return null;

  const details = isRecord(value.prompt_tokens_details)
    ? value.prompt_tokens_details
    : null;
  const cachedInputTokens =
    readTokenCount(details?.cached_tokens) ??
    readTokenCount(value.cached_tokens) ??
    0;
  if (cachedInputTokens > inputTokens) return null;

  return { inputTokens, outputTokens, cachedInputTokens };
}

function parseCompletion(value: unknown): AgentCompletion {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    throw new GlmRequestError("GLM returned an invalid completion response");
  }

  const message = value.choices[0];
  if (!isRecord(message) || !isRecord(message.message)) {
    throw new GlmRequestError("GLM returned no assistant message");
  }

  const assistant = message.message;
  const content =
    typeof assistant.content === "string" ? assistant.content : null;
  const rawToolCalls = assistant.tool_calls;
  const toolCalls: AgentFunctionCall[] = [];

  if (rawToolCalls !== undefined) {
    if (!Array.isArray(rawToolCalls)) {
      throw new GlmRequestError("GLM returned invalid tool calls");
    }
    for (const rawCall of rawToolCalls) {
      if (
        !isRecord(rawCall) ||
        typeof rawCall.id !== "string" ||
        !isRecord(rawCall.function) ||
        typeof rawCall.function.name !== "string" ||
        typeof rawCall.function.arguments !== "string"
      ) {
        throw new GlmRequestError("GLM returned a malformed tool call");
      }
      toolCalls.push({
        id: rawCall.id,
        name: rawCall.function.name,
        arguments: rawCall.function.arguments,
      });
    }
  }

  if (!content && toolCalls.length === 0) {
    throw new GlmRequestError("GLM returned neither a reply nor a tool call");
  }

  return { content, toolCalls, usage: parseUsage(value.usage) };
}

async function requestAgentCompletion(
  messages: AgentMessage[],
  tools: AgentFunctionTool[],
): Promise<AgentCompletion> {
  const config = resolveModelConfig();
  const apiKey = process.env[config.apiKeyEnv]?.trim();
  if (!apiKey && !config.selfHosted) {
    throw new GlmConfigurationError("ZAI_API_KEY is not configured");
  }

  const signal = AbortSignal.timeout(GLM_REQUEST_TIMEOUT_MS);
  const requestStartedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(
      config.endpoint,
      {
        method: "POST",
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          // Z.AI-specific; OpenAI-compatible self-hosted servers do not need it.
          ...(config.selfHosted ? {} : { reasoning_effort: "low" }),
          ...(tools.length === 0
            ? { response_format: { type: "json_object" } }
            : {}),
          ...(tools.length > 0
            ? {
                tools: tools.map((tool) => ({
                  type: "function",
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  },
                })),
                tool_choice: "auto",
              }
            : {}),
          temperature: 0.2,
          stream: false,
        }),
        signal,
      },
    );
  } catch (error) {
    const timedOut =
      signal.aborted ||
      (error instanceof Error && error.name === "TimeoutError");
    console.error("GLM request failed", {
      model: config.model,
      provider: config.provider,
      duration_ms: Date.now() - requestStartedAt,
      timeout_ms: GLM_REQUEST_TIMEOUT_MS,
      failure_type: timedOut ? "timeout" : "network",
      error: describeRequestError(error),
    });
    throw new GlmRequestError("Could not reach the configured GLM service");
  }

  if (!response.ok) {
    throw new GlmRequestError(
      `GLM service returned HTTP ${response.status}`,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new GlmRequestError("GLM returned a non-JSON response");
  }

  return parseCompletion(body);
}

export async function createAgentCompletion(
  messages: AgentMessage[],
  tools: AgentFunctionTool[],
  context?: ModelCallContext,
): Promise<AgentCompletion> {
  const startedAt = Date.now();
  const config = safeResolveModelConfig();
  try {
    if (!config) {
      resolveModelConfig(); // throws the specific configuration error
      throw new GlmConfigurationError("The model provider is not configured");
    }
    const completion = await requestAgentCompletion(messages, tools);
    if (context) {
      await logAgentEvent({
        run_id: context.runId,
        workflow: context.workflow,
        attempt: context.attempt,
        event_type: "model_call",
        agent_action: "model_call",
        tool_name: "glm.chat.completions",
        status: "success",
        provider: config.provider,
        model: config.model,
        usage: completion.usage,
        // Self-hosted models have no per-token bill; infrastructure cost is tracked separately.
        ...(config.selfHosted ? { cost_status: "not_applicable" as const } : {}),
        duration_ms: Date.now() - startedAt,
        metadata: {
          usage_available: completion.usage !== null,
          self_hosted: config.selfHosted,
        },
      });
    }
    return completion;
  } catch (error) {
    if (context) {
      await logAgentEvent({
        run_id: context.runId,
        workflow: context.workflow,
        attempt: context.attempt,
        event_type: "model_call",
        agent_action: "model_call",
        tool_name: "glm.chat.completions",
        status: "error",
        provider: config?.provider ?? "unconfigured",
        model: config?.model ?? DIRA_AGENT_MODEL,
        cost_status: "unknown",
        duration_ms: Date.now() - startedAt,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
    throw error;
  }
}
