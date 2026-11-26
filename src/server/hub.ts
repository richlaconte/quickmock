// The hub: every open viewer holds one event stream here. Flow and note changes
// go out to all of them, and so does presence: who is looking, at which flow and
// frame, and where their pointer is.
//
// A page's stream and its reports may land on different function instances, so
// nothing is kept in this process: events travel over a channel per workspace,
// and who is here lives in two small hashes beside it.

import { createHash, randomBytes } from "node:crypto";

import { tokens } from "../design-system/tokens";
import type { Person, Role, ServerEvent, ViewState } from "../shared/types";
import { backend } from "./backend";

/** An event on its way to the pages of one workspace, and which of them should get it. */
interface Envelope {
  event?: ServerEvent;
  /** Everyone but this person. */
  not?: string;
  /** Only people who have this flow open. */
  flow?: string;
  /** Only the owner's pages. */
  owners?: boolean;
  /** Sharing was turned off or restarted: guests' streams check whether they may stay. */
  recheck?: boolean;
}

/** How long someone stays listed after their page closes, so a reload keeps their colour. */
const GRACE_MS = 2500;
const BEAT_MS = 15000;
/** Someone whose stream has not reported in for this long is gone, however it ended. */
const STALE_MS = 50000;
/** A stream ends itself before the platform would cut it; the page reconnects at once. */
const STREAM_MS = 270000;
const MAX_PEOPLE = 200;
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

const channel = (ws: string): string => `qm:${ws}:events`;
const peopleKey = (ws: string): string => `qm:${ws}:people`;
const seenKey = (ws: string): string => `qm:${ws}:seen`;

/** The public id for a page. Other pages only ever see this, never the secret it is made from. */
function pidOf(ws: string, secret: string): string {
  return `p${createHash("sha256").update(`${ws}:${secret}`).digest("hex").slice(0, 12)}`;
}

function clip(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, max) : undefined;
}

function coordinate(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.round(Math.max(-50000, Math.min(50000, value)) * 10) / 10;
}

async function publish(ws: string, envelope: Envelope): Promise<void> {
  await backend().publish(channel(ws), JSON.stringify(envelope));
}

/** Send an event to every open page of a workspace. */
export async function send(ws: string, event: ServerEvent, to: Omit<Envelope, "event"> = {}): Promise<void> {
  await publish(ws, { ...to, event });
}

/** Tell guests' streams to check whether the share link still lets them in. */
export async function recheckGuests(ws: string): Promise<void> {
  await publish(ws, { recheck: true });
}

/** Everyone who is here. People whose stream stopped reporting are dropped on the way. */
export async function people(ws: string): Promise<Person[]> {
  const store = backend();
  const [listed, seen] = await Promise.all([store.hgetall(peopleKey(ws)), store.hgetall(seenKey(ws))]);
  const now = Date.now();
  const here: Person[] = [];
  const gone: string[] = [];
  for (const [pid, json] of Object.entries(listed)) {
    const at = Number((seen[pid] ?? "0").split(":")[0]);
    if (now - at > STALE_MS) gone.push(pid);
    else here.push(JSON.parse(json) as Person);
  }
  if (gone.length) {
    await Promise.all([store.hdel(peopleKey(ws), ...gone), store.hdel(seenKey(ws), ...gone)]);
    for (const pid of gone) await send(ws, { type: "left", pid });
  }
  return here;
}

async function join(ws: string, pid: string, role: Role): Promise<Person | undefined> {
  const store = backend();
  const existing = await store.hget(peopleKey(ws), pid);
  if (existing) return JSON.parse(existing) as Person;
  const others = await people(ws);
  // Far more pages than any team has. Past this, new ones watch without being listed.
  if (others.length >= MAX_PEOPLE) return undefined;
  const used = new Set(others.map((p) => p.color));
  const palette = tokens.people;
  const color = palette.find((c) => !used.has(c)) ?? palette[parseInt(pid.slice(1, 7), 16) % palette.length];
  const person: Person = { pid, name: role === "guest" ? "Guest" : "Host", color, guest: role === "guest" };
  await store.hset(peopleKey(ws), pid, JSON.stringify(person));
  return person;
}

/**
 * Open an event stream for a page. `secret` is the id the page chose; without one it only watches.
 * `mayStay` is asked again when sharing changes, so a guest's stream ends when the link stops working.
 */
export function openStream(ws: string, secret: string | undefined, role: Role, signal: AbortSignal, mayStay: () => Promise<boolean>): { stream: ReadableStream<Uint8Array>; closed: Promise<void> } {
  const encoder = new TextEncoder();
  const store = backend();
  const conn = randomBytes(6).toString("hex");
  const pid = secret && CLIENT_ID.test(secret) ? pidOf(ws, secret) : undefined;
  let finish: () => void = () => undefined;
  const ended = new Promise<void>((resolve) => (finish = resolve));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (text: string): void => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false;
          finish();
        }
      };
      const emit = (event: ServerEvent): void => write(`data: ${JSON.stringify(event)}\n\n`);
      write("retry: 1000\n\n");

      const me = pid ? await join(ws, pid, role).catch(() => undefined) : undefined;
      const beat = async (): Promise<void> => {
        if (me) await store.hset(seenKey(ws), me.pid, `${Date.now()}:${conn}`).catch(() => undefined);
      };
      await beat();

      // Which flow each person has open, to route pointers. Kept per stream from the events going past.
      const flowOf = new Map<string, string | undefined>();
      const stop = await store.subscribe(channel(ws), (message) => {
        const envelope = JSON.parse(message) as Envelope;
        if (envelope.recheck) {
          if (role === "guest") void mayStay().then((ok) => !ok && finish(), finish);
          return;
        }
        const event = envelope.event;
        if (!event) return;
        if (event.type === "person") flowOf.set(event.person.pid, event.person.flowId);
        if (envelope.owners && role !== "owner") return;
        // Pages that did not say who they are get changes, but nothing about people.
        if (!me) {
          if (envelope.flow || ["person", "left", "cursor"].includes(event.type)) return;
        } else {
          if (envelope.not === me.pid) return;
          if (envelope.flow && envelope.flow !== flowOf.get(me.pid)) return;
        }
        emit(event);
      });

      if (me) {
        const everyone = await people(ws).catch(() => [me]);
        for (const person of everyone) flowOf.set(person.pid, person.flowId);
        emit({ type: "hello", you: me.pid, role, people: everyone, cursors: [] });
        await send(ws, { type: "person", person: me }, { not: me.pid });
      }

      const timer = setInterval(() => {
        // Keep idle streams alive through proxies.
        write(": keep-alive\n\n");
        void beat();
      }, BEAT_MS);
      const limit = setTimeout(finish, STREAM_MS);
      signal.addEventListener("abort", finish);

      await ended;
      open = false;
      clearInterval(timer);
      clearTimeout(limit);
      stop();
      try {
        controller.close();
      } catch {
        // Already closed from the other side.
      }
    },
    cancel() {
      finish();
    },
  });

  // After the page goes: wait a moment in case it was a reload, then take the person off the list.
  const closed = ended.then(async () => {
    if (!pid) return;
    await new Promise((resolve) => setTimeout(resolve, GRACE_MS));
    const latest = await store.hget(seenKey(ws), pid);
    if (latest && latest.split(":")[1] !== conn) return;
    await Promise.all([store.hdel(peopleKey(ws), pid), store.hdel(seenKey(ws), pid)]);
    await send(ws, { type: "left", pid });
  });

  return { stream, closed };
}

/** A page reports what it is doing: its name, the flow and frame it is on, where its pointer is. */
export async function update(ws: string, secret: unknown, body: unknown, role: Role): Promise<boolean> {
  if (typeof secret !== "string" || !CLIENT_ID.test(secret) || typeof body !== "object" || body === null) return false;
  const raw = body as Record<string, unknown>;
  const pid = pidOf(ws, secret);

  // A pointer that moved and nothing else: pass it on without looking anything up. This is most reports.
  if (raw.only === "cursor") {
    const flow = clip(raw.flowId, 80);
    if (!flow) return true;
    const cursor = raw.cursor as { x?: unknown; y?: unknown } | null | undefined;
    const x = cursor ? coordinate(cursor.x) : undefined;
    const y = cursor ? coordinate(cursor.y) : undefined;
    await send(ws, x !== undefined && y !== undefined ? { type: "cursor", pid, x, y } : { type: "cursor", pid }, { not: pid, flow });
    return true;
  }

  const person = await join(ws, pid, role);
  if (!person) return false;
  const before = JSON.stringify(person);
  const flowBefore = person.flowId;

  const name = clip(raw.name, 24);
  if (name !== undefined) person.name = name || (person.guest ? "Guest" : "Host");
  if ("flowId" in raw) {
    const flowId = clip(raw.flowId, 80);
    if (flowId) person.flowId = flowId;
    else delete person.flowId;
  }
  if ("frame" in raw) {
    const frame = clip(raw.frame, 120);
    if (frame) person.frame = frame;
    else delete person.frame;
  }
  if (person.flowId !== flowBefore && flowBefore) {
    // They went to another flow: take their pointer off the board they left.
    await send(ws, { type: "cursor", pid }, { not: pid, flow: flowBefore });
  }
  if (JSON.stringify(person) !== before) {
    await backend().hset(peopleKey(ws), pid, JSON.stringify(person));
    await send(ws, { type: "person", person }, { not: pid });
  }

  if ("cursor" in raw && person.flowId) {
    const cursor = raw.cursor as { x?: unknown; y?: unknown } | null;
    const x = cursor ? coordinate(cursor.x) : undefined;
    const y = cursor ? coordinate(cursor.y) : undefined;
    await send(ws, x !== undefined && y !== undefined ? { type: "cursor", pid, x, y } : { type: "cursor", pid }, { not: pid, flow: person.flowId });
  }
  return true;
}

// ── what the owner is looking at, for the agent's get_selection ─────────────

const viewKey = (ws: string): string => `qm:${ws}:view`;

export async function setView(ws: string, view: ViewState): Promise<void> {
  await backend().set(viewKey(ws), JSON.stringify(view), 24 * 60 * 60);
}

const agentKey = (ws: string): string => `qm:${ws}:agent`;

/** How long after its last request an agent still counts as at work. */
const AGENT_QUIET_MS = 60 * 1000;

/**
 * Note that an agent just used this workspace's key. The owner's pages are told
 * when it starts up after being quiet, not on every request.
 */
export async function agentSeen(ws: string): Promise<void> {
  const store = backend();
  const before = await store.get(agentKey(ws));
  const now = new Date();
  await store.set(agentKey(ws), now.toISOString(), 30 * 24 * 60 * 60);
  if (!before || now.getTime() - new Date(before).getTime() > AGENT_QUIET_MS) await send(ws, { type: "agent" }, { owners: true });
}

/** When an agent last used this workspace's key, if one has lately. */
export async function agentLastSeen(ws: string): Promise<string | undefined> {
  return backend().get(agentKey(ws));
}

export async function getView(ws: string): Promise<ViewState | undefined> {
  const saved = await backend().get(viewKey(ws));
  return saved ? (JSON.parse(saved) as ViewState) : undefined;
}
