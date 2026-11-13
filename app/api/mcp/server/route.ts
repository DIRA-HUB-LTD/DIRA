import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveMcpAccess } from "@/lib/auth/mcp-access";
import { createDiraMcpServer } from "@/lib/mcp-tools/dira-server";

export const runtime = "nodejs";

async function handleMcpRequest(request: Request): Promise<Response> {
  const suppliedToken = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1];

  let access;
  try {
    access = await resolveMcpAccess(suppliedToken);
  } catch (error) {
    console.error("Dira MCP access check failed:", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "Dira MCP access check failed" }, { status: 503 });
  }
  if (!access) {
    if (!process.env.DIRA_MCP_ACCESS_TOKEN && !suppliedToken) {
      return Response.json(
        { error: "Dira MCP server access is not configured" },
        { status: 503 },
      );
    }
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A per-teacher token pins every tool call to that teacher and school.
  const teacherContext = access.kind === "teacher" ? access.context : null;
  const server = createDiraMcpServer(
    teacherContext ? { resolveContext: async () => teacherContext } : {},
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 64 * 1024,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    console.error("Dira MCP request failed:", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "Dira MCP request failed" }, { status: 500 });
  } finally {
    try {
      await server.close();
    } catch (error) {
      console.error("Dira MCP cleanup failed:", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}

export const POST = handleMcpRequest;
export const GET = handleMcpRequest;
export const DELETE = handleMcpRequest;
