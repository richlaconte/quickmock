import type { AgentStatus, FlowPayload, FlowSummary, ReviewNote, Role, ShareStatus, ViewState } from "../shared/types";

import { API, WORKSPACE } from "./workspace";

// The event stream moved to live.ts, where one connection serves the whole page.
export { useServerEvents } from "./live";

export async function getFlows(): Promise<{ flows: FlowSummary[] }> {
  const res = await fetch(`${API}/flows`);
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return (await res.json()) as { flows: FlowSummary[] };
}

export interface Session {
  role: Role;
  /** Owner only: the link that opens this workspace as its owner in another browser. */
  ownerLink?: string;
  share?: ShareStatus;
  limits?: { flows: number };
}

/** Whether this page belongs to the person who made the workspace or to a guest on the share link. */
export async function getSession(): Promise<Session> {
  const res = await fetch(`${API}/session`);
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return (await res.json()) as Session;
}

async function ownerPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const answer = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(answer.error ?? `The server answered ${res.status}.`);
  return answer;
}

/** Turn sharing on or off. Turning it on makes a new link; turning it off makes the old one useless. */
export function setSharing(on: boolean): Promise<ShareStatus> {
  return ownerPost<ShareStatus>("share", { on });
}

/** Make a blank flow in this workspace. Owner only. */
export function newBlankFlow(): Promise<FlowPayload> {
  return ownerPost<FlowPayload>("flows", {});
}

export async function getSharing(): Promise<ShareStatus> {
  const res = await fetch(`${API}/share`);
  if (!res.ok) return { on: false };
  return (await res.json()) as ShareStatus;
}

/** When the agent last used this workspace's key. Owner only; a guest gets nothing. */
export async function getAgentStatus(): Promise<AgentStatus> {
  const res = await fetch(`${API}/agent`);
  if (!res.ok) return {};
  return (await res.json()) as AgentStatus;
}

// The agent key is shown once, when it is made. It is kept for this tab so the
// connect command on the front page can include it until the tab is closed.
const KEY_STORE = `quickmock.key.${WORKSPACE}`;

export function rememberedAgentKey(): string | undefined {
  try {
    return sessionStorage.getItem(KEY_STORE) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Make a new agent key. The one before it stops working. */
export async function newAgentKey(): Promise<string> {
  const { agentKey } = await ownerPost<{ agentKey: string }>("key", {});
  try {
    sessionStorage.setItem(KEY_STORE, agentKey);
  } catch {
    // It is still shown on this page.
  }
  return agentKey;
}

export async function getFlow(id: string): Promise<FlowPayload> {
  const res = await fetch(`${API}/flows/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error(`There is no flow called "${id}".`);
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return (await res.json()) as FlowPayload;
}

/** The build brief for a flow, as Markdown. */
export async function getBrief(id: string, target: string): Promise<string> {
  const res = await fetch(`${API}/flows/${encodeURIComponent(id)}/brief?target=${encodeURIComponent(target)}`);
  const text = await res.text();
  if (!res.ok) throw new Error(text || `The server answered ${res.status}.`);
  return text;
}

// ── notes the person writes ─────────────────────────────────────────────────

async function notesJson<T>(res: Response): Promise<T> {
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
    throw new Error(`The server answered ${res.status}.`);
  }
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
  return body;
}

const notesUrl = (id: string, noteId?: string): string =>
  `${API}/flows/${encodeURIComponent(id)}/notes${noteId ? `/${encodeURIComponent(noteId)}` : ""}`;

export async function getNotes(id: string): Promise<ReviewNote[]> {
  return (await notesJson<{ notes: ReviewNote[] }>(await fetch(notesUrl(id)))).notes;
}

export interface NewNote {
  frame: string;
  text: string;
  target?: { path: string; type: string; summary?: string };
  /** For a sticky note: its offset from the frame's top-left corner, in board units. */
  sticky?: { dx: number; dy: number };
  author?: string;
}

export async function addNote(id: string, note: NewNote): Promise<ReviewNote> {
  const res = await fetch(notesUrl(id), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(note),
  });
  return (await notesJson<{ note: ReviewNote }>(res)).note;
}

export async function setNoteDone(id: string, noteId: string, done: boolean): Promise<ReviewNote> {
  const res = await fetch(notesUrl(id, noteId), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ done }),
  });
  return (await notesJson<{ note: ReviewNote }>(res)).note;
}

/** Change a note's words, or move a sticky note to a new place. */
export async function changeNote(
  id: string,
  noteId: string,
  change: { text: string } | { frame: string; sticky: { dx: number; dy: number } },
): Promise<ReviewNote> {
  const res = await fetch(notesUrl(id, noteId), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(change),
  });
  return (await notesJson<{ note: ReviewNote }>(res)).note;
}

export async function deleteNote(id: string, noteId: string): Promise<void> {
  const res = await fetch(notesUrl(id, noteId), { method: "DELETE" });
  if (!res.ok) await notesJson<Record<string, never>>(res);
}

/** Tell the server what is on screen, so an agent can resolve "this". */
export function postView(view: Omit<ViewState, "at">): void {
  void fetch(`${API}/view`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(view),
    keepalive: true,
  }).catch(() => undefined);
}
