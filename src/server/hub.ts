// The hub: every open viewer holds one event stream here. Flow and note changes
// go out to all of them, and so does presence: who is looking, at which flow and
// frame, and where their pointer is on the board.

import type { IncomingMessage, ServerResponse } from "node:http";

import { tokens } from "../design-system/tokens";
import type { Person, Role, ServerEvent } from "../shared/types";

interface Member {
  person: Person;
  streams: Set<ServerResponse>;
  cursor?: { x: number; y: number };
  cursorAt: number;
  /** When its last stream closed. It is dropped shortly after, unless the page comes back. */
  goneAt?: number;
}

/** How long someone stays listed after their page closes, so a reload keeps their colour. */
const GRACE_MS = 2500;
const MAX_PEOPLE = 200;
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

function clip(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, max) : undefined;
}

function coordinate(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.round(Math.max(-50000, Math.min(50000, value)) * 10) / 10;
}

export class Hub {
  /** Keyed by the secret id a page makes up for itself. Other pages only ever see `pid`. */
  private members = new Map<string, Member>();
  /** Streams from pages that did not identify themselves: they get changes, but are nobody. */
  private watchers = new Set<ServerResponse>();
  private count = 0;
  private timer: NodeJS.Timeout;
  private beatAt = Date.now();

  constructor() {
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
  }

  close(): void {
    clearInterval(this.timer);
    for (const stream of this.streams()) stream.end();
  }

  private *streams(): Iterable<ServerResponse> {
    yield* this.watchers;
    for (const member of this.members.values()) yield* member.streams;
  }

  private write(stream: ServerResponse, event: ServerEvent): void {
    stream.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  /** Send to every open page, or to the ones a test lets through. */
  send(event: ServerEvent, to?: (member: Member) => boolean): void {
    if (!to) for (const stream of this.watchers) this.write(stream, event);
    for (const member of this.members.values()) {
      if (to && !to(member)) continue;
      for (const stream of member.streams) this.write(stream, event);
    }
  }

  /** Everyone who is here, oldest first. */
  people(): Person[] {
    return [...this.members.values()].filter((m) => m.streams.size > 0 || m.goneAt !== undefined).map((m) => m.person);
  }

  private member(secret: string, role: Role): Member | undefined {
    let member = this.members.get(secret);
    if (!member) {
      // Far more pages than any team has. Past this, new ones watch without being listed.
      if (this.members.size >= MAX_PEOPLE) return undefined;
      const used = new Set([...this.members.values()].map((m) => m.person.color));
      const palette = tokens.people;
      const color = palette.find((c) => !used.has(c)) ?? palette[this.count % palette.length];
      this.count += 1;
      member = {
        person: { pid: `p${this.count}`, name: role === "guest" ? "Guest" : "Host", color, guest: role === "guest" },
        streams: new Set(),
        cursorAt: 0,
      };
      this.members.set(secret, member);
    }
    return member;
  }

  /** Open an event stream for a page. `secret` is the id the page chose; without one it only watches. */
  open(req: IncomingMessage, res: ServerResponse, secret: string | undefined, role: Role): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Proxies and tunnels must not hold the stream back.
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 1000\n\n");

    if (!secret || !CLIENT_ID.test(secret)) {
      this.watchers.add(res);
      req.on("close", () => this.watchers.delete(res));
      return;
    }

    const member = this.member(secret, role);
    if (!member) {
      this.watchers.add(res);
      req.on("close", () => this.watchers.delete(res));
      return;
    }
    const arriving = member.streams.size === 0;
    member.streams.add(res);
    member.goneAt = undefined;

    const cursors: { pid: string; x: number; y: number }[] = [];
    for (const other of this.members.values()) {
      if (other !== member && other.cursor) cursors.push({ pid: other.person.pid, ...other.cursor });
    }
    this.write(res, { type: "hello", you: member.person.pid, role, people: this.people(), cursors });
    if (arriving) this.send({ type: "person", person: member.person }, (m) => m !== member);

    req.on("close", () => {
      member.streams.delete(res);
      if (member.streams.size === 0) {
        member.goneAt = Date.now();
        member.cursor = undefined;
        this.send({ type: "cursor", pid: member.person.pid }, (m) => m !== member);
      }
    });
  }

  /**
   * A page reports what it is doing: its name, the flow and frame it is on, where its pointer is.
   * `now` is an argument so a test can move the clock.
   */
  update(secret: unknown, body: unknown, role: Role, now = Date.now()): boolean {
    if (typeof secret !== "string" || !CLIENT_ID.test(secret) || typeof body !== "object" || body === null) return false;
    const raw = body as Record<string, unknown>;
    const member = this.member(secret, role);
    if (!member) return false;
    const person = member.person;
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
    if (person.flowId !== flowBefore && member.cursor) {
      // They went to another flow: take their pointer off the board they left.
      member.cursor = undefined;
      this.send({ type: "cursor", pid: person.pid }, (m) => m !== member && m.person.flowId === flowBefore);
    }
    if (JSON.stringify(person) !== before) this.send({ type: "person", person }, (m) => m !== member);
    if (person.flowId !== flowBefore && person.flowId) {
      // And show them the pointers that are already on the board they arrived at.
      for (const other of this.members.values()) {
        if (other === member || other.person.flowId !== person.flowId || !other.cursor) continue;
        for (const stream of member.streams) this.write(stream, { type: "cursor", pid: other.person.pid, ...other.cursor });
      }
    }

    if ("cursor" in raw) {
      const cursor = raw.cursor as { x?: unknown; y?: unknown } | null;
      const x = cursor ? coordinate(cursor.x) : undefined;
      const y = cursor ? coordinate(cursor.y) : undefined;
      const next = x !== undefined && y !== undefined ? { x, y } : undefined;
      const changed = next?.x !== member.cursor?.x || next?.y !== member.cursor?.y;
      // Pointers move fast: let at most one position through every 20 ms, but always let a pointer leave.
      if (changed && (!next || now - member.cursorAt >= 20)) {
        member.cursor = next;
        member.cursorAt = now;
        const sameFlow = (m: Member): boolean => m !== member && m.person.flowId === person.flowId;
        this.send(next ? { type: "cursor", pid: person.pid, ...next } : { type: "cursor", pid: person.pid }, sameFlow);
      }
    }
    return true;
  }

  /** Runs every second. Takes the time as an argument so a test can move the clock. */
  tick(now = Date.now()): void {
    // Keep idle streams alive through proxies.
    if (now - this.beatAt >= 20000) {
      this.beatAt = now;
      for (const stream of this.streams()) stream.write(": keep-alive\n\n");
    }
    // Let go of people whose page has closed.
    for (const [secret, member] of this.members) {
      const closed = member.streams.size === 0;
      // Someone who reported in without ever opening a stream is treated the same way.
      if (closed && member.goneAt === undefined) member.goneAt = now;
      if (closed && now - (member.goneAt ?? now) >= GRACE_MS) {
        this.members.delete(secret);
        this.send({ type: "left", pid: member.person.pid });
      }
    }
  }
}
