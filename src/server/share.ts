// Sharing: a second door, for guests.
//
// The owner's door stays on 127.0.0.1 and keeps the agent endpoint and the dev
// server to itself. Turning sharing on opens this one on the network instead.
// It serves a built copy of the viewer and the guest side of the API, and lets
// nobody in without the key in the share link. Turning sharing off closes it;
// turning it on again makes a new key, so old links stop working.

import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

import express, { type RequestHandler, type Router } from "express";

import type { ShareStatus } from "../shared/types";

const COOKIE = "qm_share";

const LOCKED_PAGE = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>quickmock</title>
<body style="font: 16px/1.5 system-ui, sans-serif; max-width: 34em; margin: 12vh auto; padding: 0 20px; color: #1D2740">
<h1 style="font-size: 20px">This board is shared by link</h1>
<p>Open the full link you were sent, including the part after <code>?key=</code>. If it has stopped working, sharing was turned off or restarted: ask for a new link.</p>
</body>`;

function cookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

/** Let a request through only when it carries the key: in the link the first time, in a cookie after that. */
export function gate(key: string): RequestHandler {
  const expected = Buffer.from(key);
  const matches = (value: unknown): boolean => {
    if (typeof value !== "string") return false;
    const offered = Buffer.from(value);
    return offered.length === expected.length && timingSafeEqual(offered, expected);
  };
  return (req, res, next) => {
    if (matches(req.query.key)) {
      const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
      res.setHeader("Set-Cookie", `${COOKIE}=${key}; Path=/; HttpOnly; SameSite=Lax${secure}`);
      // Send the browser back without the key, so it does not sit in the address bar or the history.
      // The part of the link after # never reaches the server, and the browser carries it over.
      res.redirect(302, "/");
      return;
    }
    if (matches(cookies(req.headers.cookie)[COOKIE])) {
      next();
      return;
    }
    if (req.path.startsWith("/api/")) res.status(401).json({ error: "This board is shared by link. Open the full link you were sent." });
    else res.status(401).type("html").send(LOCKED_PAGE);
  };
}

/** The guests' side as an Express app: gate, guest API, then the built viewer. */
export function guestApp(key: string, api: Router, dist: string): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Robots-Tag", "noindex");
    next();
  });
  app.use(gate(key));
  app.use(express.json({ limit: "64kb" }));
  app.use("/api", api);
  // The agent endpoint lives on the owner's door only. Say so plainly instead of answering with the viewer.
  app.all("/mcp", (_req, res) => {
    res.status(404).json({ error: "There is no agent endpoint here." });
  });
  app.use(express.static(dist, { index: false }));
  app.use((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(404).end();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(join(dist, "index.html"));
  });
  return app;
}

/** Addresses other computers on the same network can use to reach this one. */
function networkAddresses(): string[] {
  const found: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const address of list ?? []) {
      if (address.family === "IPv4" && !address.internal) found.push(address.address);
    }
  }
  // Home and office networks first; whatever else is there (VPNs, virtual machines) after.
  const local = (a: string): number => (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a) ? 0 : 1);
  return found.sort((a, b) => local(a) - local(b));
}

export interface ShareOptions {
  /** The project folder, where the viewer is built from and into. */
  root: string;
  /** The port to open for guests. The next few are tried when it is taken. */
  port: number;
  /** Makes the guest side of the API. */
  api: () => Router;
}

export class Share extends EventEmitter {
  private server?: Server;
  private key?: string;
  private port?: number;
  private starting = false;
  private error?: string;

  constructor(private readonly options: ShareOptions) {
    super();
  }

  status(): ShareStatus {
    const status: ShareStatus = { on: Boolean(this.server), starting: this.starting, links: [] };
    if (this.error) status.error = this.error;
    if (this.server && this.key && this.port) {
      status.port = this.port;
      status.key = this.key;
      const link = (host: string): string => `http://${host}:${this.port}/?key=${this.key}`;
      status.links = [
        { label: "This computer", url: link("localhost") },
        ...networkAddresses().map((address) => ({ label: "Same network", url: link(address) })),
      ];
    }
    return status;
  }

  private changed(): void {
    this.emit("change");
  }

  /** Build the viewer as plain files, so guests are never served by the dev server. */
  private build(): Promise<void> {
    const vite = join(this.options.root, "node_modules", "vite", "bin", "vite.js");
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [vite, "build", "--logLevel", "warn"], {
        cwd: this.options.root,
        env: { ...process.env, NODE_ENV: "production" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
      const timer = setTimeout(() => child.kill(), 180000);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && existsSync(join(this.options.root, "dist", "index.html"))) resolve();
        else reject(new Error(`The viewer could not be built for sharing.\n${output.trim().split("\n").slice(-12).join("\n")}`));
      });
    });
  }

  private listen(app: express.Express): Promise<{ server: Server; port: number }> {
    const attempt = (port: number, left: number): Promise<{ server: Server; port: number }> =>
      new Promise((resolve, reject) => {
        const server = createServer(app);
        server.once("error", (error: NodeJS.ErrnoException) => {
          if (error.code === "EADDRINUSE" && left > 0) resolve(attempt(port + 1, left - 1));
          else reject(error);
        });
        // Every network interface: that is the point of sharing. The key is what keeps people out.
        server.listen(port, "0.0.0.0", () => resolve({ server, port }));
      });
    return attempt(this.options.port, 10);
  }

  async start(): Promise<ShareStatus> {
    if (this.server || this.starting) return this.status();
    this.starting = true;
    this.error = undefined;
    this.changed();
    try {
      await this.build();
      const key = randomBytes(16).toString("base64url");
      const app = guestApp(key, this.options.api(), join(this.options.root, "dist"));
      const { server, port } = await this.listen(app);
      this.server = server;
      this.key = key;
      this.port = port;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.starting = false;
    this.changed();
    return this.status();
  }

  async stop(): Promise<ShareStatus> {
    const server = this.server;
    this.server = undefined;
    this.key = undefined;
    this.port = undefined;
    this.error = undefined;
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Event streams never end by themselves, so close the guests' connections too.
        server.closeAllConnections();
      });
    }
    this.changed();
    return this.status();
  }
}
