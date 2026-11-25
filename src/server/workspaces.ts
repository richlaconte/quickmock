// Workspaces, and who may do what in one. There are no accounts: a workspace
// is opened with links that carry secrets.
//
//   the owner link   whoever made the workspace. Kept in a cookie after the first visit.
//   the guest link   handed out while sharing is on. Read, click through, write notes.
//   the agent key    what an MCP client sends to /mcp. The only thing that can change a flow.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import cancelSubscription from "../../examples/cancel-subscription.json";
import signIn from "../../examples/sign-in.json";
import teamMembers from "../../examples/team-members.json";
import type { Role } from "../shared/types";
import { validateFlow } from "../shared/validate";
import { query } from "./db";
import { FlowStore } from "./store";

export const WORKSPACE_ID = /^[a-z0-9]{12}$/;
const SECRET = /^[A-Za-z0-9_-]{16,64}$/;

export const ownerCookie = (ws: string): string => `qm_o_${ws}`;
export const guestCookie = (ws: string): string => `qm_g_${ws}`;

interface WorkspaceRow {
  id: string;
  owner_hash: string;
  key_hash: string;
  share_key: string | null;
}

const hash = (secret: string): string => createHash("sha256").update(secret).digest("hex");

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function randomId(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(randomBytes(12), (b) => alphabet[b % alphabet.length]).join("");
}

const secret = (): string => randomBytes(24).toString("base64url");
const agentKey = (ws: string): string => `qm_${ws}_${secret()}`;

// Looked up on every request, pointer reports included, so remembered for a few seconds per instance.
const CACHE_MS = 10000;
const cache = new Map<string, { row: WorkspaceRow | undefined; at: number }>();

async function load(ws: string, fresh = false): Promise<WorkspaceRow | undefined> {
  if (!WORKSPACE_ID.test(ws)) return undefined;
  const cached = cache.get(ws);
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.row;
  const rows = await query<WorkspaceRow>("select id, owner_hash, key_hash, share_key from workspaces where id = $1", [ws]);
  if (cache.size > 5000) cache.clear();
  cache.set(ws, { row: rows[0], at: Date.now() });
  return rows[0];
}

export interface NewWorkspace {
  id: string;
  ownerToken: string;
  agentKey: string;
}

/** The example flows every new workspace starts with. */
const EXAMPLES: [string, unknown][] = [
  ["cancel-subscription", cancelSubscription],
  ["sign-in", signIn],
  ["team-members", teamMembers],
];

export async function createWorkspace(): Promise<NewWorkspace> {
  const id = randomId();
  const ownerToken = secret();
  const key = agentKey(id);
  await query("insert into workspaces (id, owner_hash, key_hash) values ($1, $2, $3)", [id, hash(ownerToken), hash(key)]);
  const store = new FlowStore(id);
  for (const [flowId, spec] of EXAMPLES) {
    const result = validateFlow(spec);
    if (result.flow) await store.save(flowId, result.flow, result.issues, "Created", undefined, true);
  }
  return { id, ownerToken, agentKey: key };
}

export async function workspaceExists(ws: string): Promise<boolean> {
  return Boolean(await load(ws));
}

/** Who a request is, from the cookies it carries. Undefined when it may not come in at all. */
export async function roleOf(ws: string, cookie: (name: string) => string | undefined, fresh = false): Promise<Role | undefined> {
  const row = await load(ws, fresh);
  if (!row) return undefined;
  const owner = cookie(ownerCookie(ws));
  if (owner && SECRET.test(owner) && same(hash(owner), row.owner_hash)) return "owner";
  const guest = cookie(guestCookie(ws));
  if (guest && row.share_key && same(guest, row.share_key)) return "guest";
  return undefined;
}

/** The workspace an agent key opens, if it is a real one. */
export async function workspaceForKey(key: string): Promise<string | undefined> {
  const match = /^qm_([a-z0-9]{12})_[A-Za-z0-9_-]{16,64}$/.exec(key);
  if (!match) return undefined;
  // Never from the cache: a key that was replaced must stop working at once.
  const row = await load(match[1], true);
  return row && same(hash(key), row.key_hash) ? row.id : undefined;
}

/** Replace the agent key. The old one stops working. */
export async function rotateAgentKey(ws: string): Promise<string> {
  const key = agentKey(ws);
  await query("update workspaces set key_hash = $2 where id = $1", [ws, hash(key)]);
  cache.delete(ws);
  return key;
}

export async function shareKey(ws: string): Promise<string | undefined> {
  return (await load(ws, true))?.share_key ?? undefined;
}

/** Turn sharing on, with a new key every time, or off. Old guest links stop working either way. */
export async function setSharing(ws: string, on: boolean): Promise<string | undefined> {
  const key = on ? randomBytes(16).toString("base64url") : null;
  await query("update workspaces set share_key = $2 where id = $1", [ws, key]);
  cache.delete(ws);
  return key ?? undefined;
}
