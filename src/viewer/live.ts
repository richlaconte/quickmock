// The live side of a page: one event stream from the server, shared by
// everything on the page, and what this page tells the server about itself.
//
// Changes to flows and notes arrive here, and so does presence: who else has
// the board open, which frame they are on, and where their pointer is.

import { useEffect, useRef, useSyncExternalStore } from "react";

import type { Person, Role, ServerEvent } from "../shared/types";
import { API } from "./workspace";

// ── who this page is ────────────────────────────────────────────────────────

/** A random id. */
function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The secret this page identifies itself with. It lasts as long as the tab, so a reload keeps the same colour. */
const clientId = ((): string => {
  try {
    const saved = sessionStorage.getItem("quickmock.client");
    if (saved) return saved;
    const made = randomId();
    sessionStorage.setItem("quickmock.client", made);
    return made;
  } catch {
    return randomId();
  }
})();

const NAME_KEY = "quickmock.name";

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

// ── the event stream ────────────────────────────────────────────────────────

type Listener = (event: ServerEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let opened = false;

// ── presence, as two small stores ───────────────────────────────────────────
// People change rarely; pointers change many times a second. Keeping them
// apart means only the cursor layer redraws when someone moves their mouse.

export interface Presence {
  /** This page's own entry, once the server has said hello. */
  me?: Person;
  role?: Role;
  /** Everyone else who is connected. */
  others: Person[];
  /** The name typed on this device, or "" when none has been chosen. */
  name: string;
}

let people = new Map<string, Person>();
let myPid: string | undefined;
let myRole: Role | undefined;
let myName = savedName();
let presence: Presence = { others: [], name: myName };
const presenceListeners = new Set<() => void>();

function publishPresence(): void {
  presence = {
    me: myPid ? people.get(myPid) : undefined,
    role: myRole,
    others: [...people.values()].filter((p) => p.pid !== myPid),
    name: myName,
  };
  for (const listener of presenceListeners) listener();
}

export type Cursors = ReadonlyMap<string, { x: number; y: number }>;
let cursors: Cursors = new Map();
const cursorListeners = new Set<() => void>();

function setCursor(pid: string, at?: { x: number; y: number }): void {
  const next = new Map(cursors);
  if (at) next.set(pid, at);
  else if (!next.delete(pid)) return;
  cursors = next;
  for (const listener of cursorListeners) listener();
}

function receive(event: ServerEvent): void {
  switch (event.type) {
    case "hello":
      myPid = event.you;
      myRole = event.role;
      people = new Map(event.people.map((p) => [p.pid, p]));
      cursors = new Map(event.cursors.map((c) => [c.pid, { x: c.x, y: c.y }]));
      for (const listener of cursorListeners) listener();
      publishPresence();
      // The server may have restarted and forgotten us: say again who and where we are.
      announce({});
      return;
    case "person":
      people = new Map(people).set(event.person.pid, event.person);
      publishPresence();
      return;
    case "left":
      if (people.has(event.pid)) {
        people = new Map(people);
        people.delete(event.pid);
        publishPresence();
      }
      setCursor(event.pid);
      return;
    case "cursor":
      setCursor(event.pid, event.x !== undefined && event.y !== undefined ? { x: event.x, y: event.y } : undefined);
      return;
    default:
      for (const listener of listeners) listener(event);
  }
}

// Whether the server is answering. It takes a few seconds of silence to count as gone,
// so a restart or a blip does not flash a warning.
let online = true;
let offlineTimer: number | undefined;
const onlineListeners = new Set<() => void>();

function setOnline(next: boolean): void {
  if (offlineTimer !== undefined) {
    window.clearTimeout(offlineTimer);
    offlineTimer = undefined;
  }
  if (online === next) return;
  online = next;
  for (const listener of onlineListeners) listener();
}

function connect(): void {
  source = new EventSource(`${API}/events?client=${encodeURIComponent(clientId)}`);
  source.onopen = () => {
    setOnline(true);
    // After a reconnect anything may have changed while we were away.
    if (opened) {
      for (const listener of listeners) {
        listener({ type: "list" });
        listener({ type: "flow" });
      }
    }
    opened = true;
  };
  source.onerror = () => {
    // The browser keeps trying by itself. Only say something if it stays down.
    if (online && offlineTimer === undefined) offlineTimer = window.setTimeout(() => setOnline(false), 4000);
  };
  source.onmessage = (message) => {
    try {
      receive(JSON.parse(message.data as string) as ServerEvent);
    } catch {
      // ignore malformed events
    }
  };
}

/** Listen for changes on the server. One connection serves every listener on the page. */
export function onServerEvent(listener: Listener): () => void {
  listeners.add(listener);
  if (!source) connect();
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe to changes on the server. After a reconnect, everything is treated as changed. */
export function useServerEvents(handler: Listener): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => onServerEvent((event) => latest.current(event)), []);
}

function subscribeOnline(listener: () => void): () => void {
  onlineListeners.add(listener);
  if (!source) connect();
  return () => {
    onlineListeners.delete(listener);
  };
}

/** False once the server has not answered for a few seconds: the connection dropped, or sharing was turned off. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => online);
}

function subscribePresence(listener: () => void): () => void {
  presenceListeners.add(listener);
  if (!source) connect();
  return () => {
    presenceListeners.delete(listener);
  };
}

/** Who is here. Redraws when someone arrives, leaves, renames themselves or moves to another frame. */
export function usePresence(): Presence {
  return useSyncExternalStore(subscribePresence, () => presence);
}

function subscribeCursors(listener: () => void): () => void {
  cursorListeners.add(listener);
  return () => {
    cursorListeners.delete(listener);
  };
}

/** Other people's pointers on the board, by person. Redraws on every move, so use it in one small component. */
export function useCursors(): Cursors {
  return useSyncExternalStore(subscribeCursors, () => cursors);
}

// ── what this page reports ──────────────────────────────────────────────────

interface Report {
  name?: string;
  flowId?: string | null;
  frame?: string | null;
  cursor?: { x: number; y: number } | null;
}

/** Everything this page has said about itself. Each report sends all of it, so a restarted server catches up at once. */
const state: Report = { name: myName };
let dirty = false;
/** True while the pointer is the only thing that changed since the last report. Those are most reports, and the cheapest. */
let cursorOnly = true;
let inFlight = false;
let timer: number | undefined;
let sentAt = 0;
/** Pointers are reported at most this often. Every report is a request, so this is also what a moving pointer costs. */
const EVERY_MS = 80;

function flush(): void {
  timer = undefined;
  if (!dirty || inFlight) return;
  dirty = false;
  inFlight = true;
  sentAt = Date.now();
  const body = cursorOnly ? { client: clientId, only: "cursor", flowId: state.flowId, cursor: state.cursor } : { ...state, client: clientId };
  cursorOnly = true;
  fetch(`${API}/presence`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  })
    .catch(() => undefined)
    .finally(() => {
      inFlight = false;
      if (dirty) schedule();
    });
}

function schedule(): void {
  if (inFlight || timer !== undefined) return;
  timer = window.setTimeout(flush, Math.max(0, EVERY_MS - (Date.now() - sentAt)));
}

/** Tell everyone else something about this page: its flow, its frame, where its pointer is. */
export function announce(report: Report): void {
  Object.assign(state, report);
  const keys = Object.keys(report);
  if (keys.length === 0 || keys.some((key) => key !== "cursor")) cursorOnly = false;
  dirty = true;
  schedule();
}

/** Choose the name other people see. It is remembered on this device. */
export function setMyName(name: string): void {
  myName = name.trim().slice(0, 24);
  try {
    localStorage.setItem(NAME_KEY, myName);
  } catch {
    // The name still holds for this page.
  }
  publishPresence();
  announce({ name: myName });
}

/** The name to put on notes this page writes: the one the person chose, or none if they have not chosen one. */
export function myAuthorName(): string {
  return myName;
}
