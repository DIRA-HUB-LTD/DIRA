#!/usr/bin/env node
// Diagnose the Fetch MCP path step by step: config -> /health -> MCP connect ->
// tool discovery -> one real fetch per live education source.
//   npm run fetch:diagnose
// Reads FETCH_MCP_URL / FETCH_MCP_TOKEN (and DIRA_EDUCATION_SOURCES) from the
// environment or .env.local. Never prints the token.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { randomUUID } from "node:crypto";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // optional
  }
}

const SOURCES = {
  IB: "https://www.ibo.org/",
  EEF: "https://educationendowmentfoundation.org.uk/",
  AMI: "https://montessori-ami.org/",
  WWC: "https://ies.ed.gov/ncee/wwc/",
};

let failed = false;
const ok = (message) => console.log(`  OK    ${message}`);
const bad = (message, hint) => {
  failed = true;
  console.log(`  FAIL  ${message}${hint ? `\n        → ${hint}` : ""}`);
};

async function main() {
  console.log("1. Configuration");
  const enabled = process.env.FETCH_MCP_ENABLED === "true";
  const transport = process.env.FETCH_MCP_TRANSPORT?.trim() || "stdio";
  const endpoint = process.env.FETCH_MCP_URL?.trim();
  const token = process.env.FETCH_MCP_TOKEN?.trim();
  enabled ? ok("FETCH_MCP_ENABLED=true") : bad("FETCH_MCP_ENABLED is not true", "Live retrieval is off; only cached pages are used.");
  if (transport !== "http") {
    bad(
      `FETCH_MCP_TRANSPORT=${transport}`,
      "On Vercel this must be 'http' (stdio launches uvx, which Vercel cannot run).",
    );
  } else ok("FETCH_MCP_TRANSPORT=http");
  if (!endpoint) return bad("FETCH_MCP_URL is not set", "Set it to https://<your-railway-app>/mcp");
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return bad("FETCH_MCP_URL is not a valid URL");
  }
  if (url.protocol !== "https:" || url.search || url.hash || url.username) {
    return bad("FETCH_MCP_URL must be https with no query, fragment or credentials");
  }
  url.pathname.endsWith("/mcp") ? ok(`FETCH_MCP_URL path is ${url.pathname}`) : bad(`FETCH_MCP_URL path is ${url.pathname}`, "The gateway serves MCP at /mcp.");
  if (!token || token.length < 32 || /\s/.test(token)) {
    return bad("FETCH_MCP_TOKEN is missing, shorter than 32 characters, or contains spaces", "It must equal FETCH_MCP_AUTH_TOKEN on the Railway service.");
  }
  ok(`FETCH_MCP_TOKEN present (${token.length} characters)`);

  console.log("\n2. Gateway health");
  try {
    const health = await fetch(new URL("/health", url), { signal: AbortSignal.timeout(15_000) });
    health.ok ? ok(`GET /health -> ${health.status}`) : bad(`GET /health -> ${health.status}`, "Check the Railway deployment logs.");
  } catch (error) {
    return bad(`GET /health failed (${error.name})`, "The Railway service is down, asleep, or the host is wrong.");
  }

  console.log("\n3. MCP connection and tool discovery");
  const client = new Client({ name: "dira-fetch-diagnose", version: "1.0.0" }, { capabilities: {} });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: { authorization: `Bearer ${token}`, "x-dira-correlation-id": randomUUID() },
        },
      }),
      { timeout: 20_000 },
    );
    ok("Connected");
  } catch (error) {
    return bad(
      `MCP connect failed (${error.message?.slice(0, 120) ?? error.name})`,
      "A 401 means FETCH_MCP_TOKEN does not match FETCH_MCP_AUTH_TOKEN on Railway.",
    );
  }
  try {
    const tools = await client.listTools(undefined, { timeout: 15_000 });
    tools.tools.some((tool) => tool.name === "fetch") ? ok("Gateway advertises the fetch tool") : bad("No fetch tool advertised");

    console.log("\n4. One live fetch per source");
    const keys = (process.env.DIRA_EDUCATION_SOURCES ?? "AMI,WWC")
      .split(",")
      .map((key) => key.trim().toUpperCase())
      .filter((key) => key in SOURCES);
    for (const key of keys) {
      const startedAt = Date.now();
      try {
        const result = await client.callTool(
          { name: "fetch", arguments: { url: SOURCES[key], max_length: 4000, start_index: 0, raw: false } },
          undefined,
          { timeout: 30_000 },
        );
        const text = (result.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join(" ");
        if (result.isError) {
          bad(`${key}: ${text.slice(0, 160)}`, key === "IB" || key === "EEF" ? "This site blocks automated requests; leave it out of DIRA_EDUCATION_SOURCES." : undefined);
        } else {
          ok(`${key}: ${text.length} characters in ${Date.now() - startedAt} ms`);
        }
      } catch (error) {
        bad(`${key}: ${error.name}`);
      }
    }
  } finally {
    await client.close();
  }
}

main()
  .catch((error) => bad(`Unexpected error: ${error.message}`))
  .finally(() => {
    console.log(failed ? "\nResult: problems found (see FAIL lines)." : "\nResult: Fetch MCP path is healthy.");
    process.exitCode = failed ? 1 : 0;
  });
