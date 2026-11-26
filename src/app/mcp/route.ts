// The MCP endpoint an agent connects to (Streamable HTTP), for every workspace.
// The key in the Authorization header says which workspace, and is the only way in.
//
// Stateless: every request gets a fresh server and transport, so any number of
// agent sessions can connect and nothing needs cleaning up between them.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import pkg from "../../../package.json";
import { agentSeen, getView } from "../../server/hub";
import { buildMcpServer } from "../../server/mcp";
import { NoteStore } from "../../server/notes";
import { FlowStore } from "../../server/store";
import { workspaceForKey } from "../../server/workspaces";

export const dynamic = "force-dynamic";

const rpcError = (status: number, code: number, message: string, headers?: HeadersInit): Response =>
  Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers });

export async function POST(request: Request): Promise<Response> {
  const header = request.headers.get("authorization") ?? "";
  const key = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  const ws = key ? await workspaceForKey(key) : undefined;
  if (!ws) {
    return rpcError(401, -32001, "This endpoint needs a lowfi.design agent key: send it as \"Authorization: Bearer qm_...\". The workspace's front page has the command.", {
      "WWW-Authenticate": "Bearer",
    });
  }

  // So the viewer can say whether an agent is connected. It must never fail the request.
  await agentSeen(ws).catch((error: unknown) => console.error("Could not note the agent:", error));

  const origin = new URL(request.url).origin;
  const server = buildMcpServer({
    store: new FlowStore(ws),
    notes: new NoteStore(ws),
    baseUrl: `${origin}/w/${ws}`,
    view: () => getView(ws),
    version: pkg.version,
  });
  try {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch (error) {
    console.error("MCP request failed:", error);
    return rpcError(500, -32603, "Internal server error");
  }
}

const methodNotAllowed = (): Response => rpcError(405, -32000, "Method not allowed.", { Allow: "POST" });

export { methodNotAllowed as GET, methodNotAllowed as DELETE };
