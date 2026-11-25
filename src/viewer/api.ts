import type { FlowPayload, FlowSummary, ReviewNote, Role, ShareStatus, ViewState } from "../shared/types";

// The event stream moved to live.ts, where one connection serves the whole page.
export { useServerEvents } from "./live";

export async function getFlows(): Promise<{ flows: FlowSummary[]; baseUrl?: string }> {
  const res = await fetch("/api/flows");
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return (await res.json()) as { flows: FlowSummary[]; baseUrl?: string };
}

/** Whether this page belongs to the person running quickmock or to a guest on the share link. */
export async function getSession(): Promise<{ role: Role; share?: ShareStatus }> {
  const res = await fetch("/api/session");
  // A server from before sharing existed has no such endpoint, and only its owner can reach it.
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) return { role: "owner" };
  return (await res.json()) as { role: Role; share?: ShareStatus };
}

/** Turn sharing on or off. Turning it on takes a few seconds: the viewer is built for guests first. */
export async function setSharing(on: boolean): Promise<ShareStatus> {
  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ on }),
  });
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
    throw new Error("Sharing needs the server restarted: stop quickmock with Ctrl+C and run npm start again.");
  }
  const body = (await res.json()) as ShareStatus & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
  return body;
}

export async function getSharing(): Promise<ShareStatus> {
  const res = await fetch("/api/share");
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) return { on: false, starting: false, links: [] };
  return (await res.json()) as ShareStatus;
}

export async function getFlow(id: string): Promise<FlowPayload> {
  const res = await fetch(`/api/flows/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error(`There is no flow called "${id}".`);
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  return (await res.json()) as FlowPayload;
}

/** The build brief for a flow, as Markdown. */
export async function getBrief(id: string, target: string): Promise<string> {
  const res = await fetch(`/api/flows/${encodeURIComponent(id)}/brief?target=${encodeURIComponent(target)}`);
  const text = await res.text();
  if (!res.ok) throw new Error(text || `The server answered ${res.status}.`);
  return text;
}

// ── notes the person writes ─────────────────────────────────────────────────

/** Read a notes response. A server from before notes existed answers these paths with a page, not JSON. */
async function notesJson<T>(res: Response): Promise<T> {
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
    throw new Error("Notes need the server restarted: stop quickmock with Ctrl+C and run npm start again.");
  }
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
  return body;
}

const notesUrl = (id: string, noteId?: string): string =>
  `/api/flows/${encodeURIComponent(id)}/notes${noteId ? `/${encodeURIComponent(noteId)}` : ""}`;

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
  void fetch("/api/view", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(view),
    keepalive: true,
  }).catch(() => undefined);
}
