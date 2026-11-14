import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

vi.mock("@/lib/db/client", () => ({ getPool: () => ({ query: vi.fn(), connect: vi.fn() }) }));

const { createDiraMcpServer } = await import("../lib/mcp-tools/dira-server.ts");

async function listTools(server) {
  const client = new Client({ name: "inventory-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

describe("public Dira MCP tool inventory", () => {
  it("exposes exactly these 15 tools", async () => {
    const tools = await listTools(createDiraMcpServer());
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        "assess_test_outcome",
        "build_evidence_summary",
        "check_evidence_readiness",
        "dispatch_one_due_follow_up",
        "draft_signed_summary",
        "get_learner_observations",
        "get_previous_suggestions",
        "list_due_follow_ups",
        "log_observation",
        "persist_test_suggestion",
        "prepare_daily_follow_up_queue",
        "regenerate_test_suggestion",
        "retrieve_education_resources",
        "save_call_observation_drafts",
        "suggest_test",
      ].sort(),
    );
  });

  it("has no tool that can accept, approve or send on a teacher's behalf", async () => {
    const tools = await listTools(createDiraMcpServer());
    for (const tool of tools) {
      expect(tool.name).not.toMatch(/accept|approve|send|share|notify/);
    }
  });

  it("acts as the teacher supplied by the caller, not the demo teacher", async () => {
    const resolveContext = vi.fn(async () => null);
    const server = createDiraMcpServer({ resolveContext });
    const client = new Client({ name: "context-test", version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: "check_evidence_readiness",
        arguments: { learner_id: "L1" },
      });
      expect(resolveContext).toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.structuredContent.error).toBe("teacher_context_unavailable");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
