// One local process.
//
// The owner's door, on 127.0.0.1 only:
//   /            the viewer (board, prototype, style guide), served by Vite
//   /mcp         the MCP endpoint an agent connects to (Streamable HTTP)
//   /api/*       what the viewer reads and writes, plus a live event stream
//
// The guests' door, opened only while sharing is on (see share.ts):
//   a built copy of the viewer and the guest side of /api, behind a key.

import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { localhostHostValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { createServer as createViteServer } from "vite";

import type { ViewState } from "../shared/types";
import { createApi } from "./api";
import { Hub } from "./hub";
import { buildMcpServer } from "./mcp";
import { NoteStore } from "./notes";
import { Share } from "./share";
import { FlowStore } from "./store";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4747);
const SHARE_PORT = Number(process.env.QUICKMOCK_SHARE_PORT ?? PORT + 1);
const baseUrl = `http://localhost:${PORT}`;
const flowsDir = process.env.QUICKMOCK_FLOWS ? resolve(process.env.QUICKMOCK_FLOWS) : join(root, "flows");

const store = new FlowStore(flowsDir, join(root, "examples"));
store.init();
// Notes and sticky notes people write in the viewer, kept beside the flows.
const notes = new NoteStore(flowsDir);
// Every open viewer, the owner's and the guests', is connected to the same hub.
const hub = new Hub();
store.on("change", (event) => hub.send(event));
notes.on("change", (event) => hub.send(event));

// What the owner is looking at, for the agent's get_selection.
let view: ViewState | undefined;

const share = new Share({ root, port: SHARE_PORT, api: () => createApi({ store, notes, hub, baseUrl }, "guest") });
share.on("change", () => {
  // Only the owner's pages show the share panel.
  hub.send({ type: "share" }, (member) => !member.person.guest);
  const status = share.status();
  if (status.error) console.error(`\n  Sharing could not start: ${status.error}\n`);
  else if (status.on) {
    console.log(["", "  Sharing is on. Anyone with one of these links can open the board:", ...status.links.map((l) => `    ${l.url}`), ""].join("\n"));
  } else if (!status.starting) console.log("\n  Sharing is off.\n");
});

const app = express();
// Only answer requests addressed to localhost, so a web page elsewhere cannot reach this server by DNS rebinding.
app.use(localhostHostValidation());
app.use(express.json({ limit: "8mb" }));

// ── MCP ─────────────────────────────────────────────────────────────────────
// Stateless: every request gets a fresh server and transport, so any number of
// agent sessions can connect and nothing needs cleaning up between them.

app.post("/mcp", async (req: Request, res: Response) => {
  const server = buildMcpServer({ store, notes, baseUrl, view: () => view, version: pkg.version });
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

const methodNotAllowed = (_req: Request, res: Response): void => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

// ── the API for the owner's viewer ──────────────────────────────────────────

app.use(
  "/api",
  createApi(
    {
      store,
      notes,
      hub,
      baseUrl,
      setView: (next) => {
        view = next;
      },
      share,
    },
    "owner",
  ),
);

// ── the viewer ──────────────────────────────────────────────────────────────

const httpServer = createHttpServer(app);

const vite = await createViteServer({
  root,
  configFile: join(root, "vite.config.ts"),
  appType: "spa",
  logLevel: "warn",
  // Hot reload shares our HTTP server, so the owner's side really is one port.
  server: { middlewareMode: true, host: HOST, hmr: { server: httpServer } },
});
app.use(vite.middlewares);

httpServer.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Stop the other process, or start on another port: PORT=4750 npm start`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

httpServer.listen(PORT, HOST, () => {
  const flows = store.list();
  console.log(
    [
      "",
      "  quickmock is running",
      "",
      `  Board and prototypes   ${baseUrl}`,
      `  MCP endpoint           ${baseUrl}/mcp`,
      `  Flows on disk          ${flowsDir} (${flows.length})`,
      "",
      "  Connect Claude Code, once:",
      `    claude mcp add --transport http quickmock ${baseUrl}/mcp`,
      "",
      "  To let other people in, press Share on a flow's page.",
      "",
    ].join("\n"),
  );
  // For running without a browser: QUICKMOCK_SHARE=1 npm start
  if (process.env.QUICKMOCK_SHARE === "1") void share.start();
});

function shutdown(): void {
  store.close();
  hub.close();
  void share.stop();
  void vite.close().finally(() => {
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
