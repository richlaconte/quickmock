// The HTTP API behind the viewer, for one workspace: /api/w/<workspace>/...
//
// Two kinds of people reach it. The owner carries the secret from the owner
// link; guests carry the key from a share link. Guests can read flows, see who
// is here, and write notes. They cannot change the owner's notes, start or
// stop sharing, make an agent key, start a blank flow, or feed the agent's
// get_selection. Changing what a flow holds is not here at all: only an agent
// does that, over /mcp.

import { after, type NextRequest } from "next/server";

import { TARGET_IDS } from "../design-system/targets";
import { renderBuildBrief } from "../shared/brief";
import { BLANK_FLOW } from "../shared/blank";
import { frameRefs } from "../shared/machine";
import type { Role, ShareStatus, ViewState } from "../shared/types";
import { validateFlow } from "../shared/validate";
import * as hub from "./hub";
import { limitsFor } from "./limits";
import { NoteStore, readNoteInput, readNotePatch } from "./notes";
import { FlowStore, StaleFlowError, slugify } from "./store";
import { ownerCookie, roleOf, rotateAgentKey, setSharing, shareKey } from "./workspaces";

const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const plain = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
const empty = (): Response => new Response(null, { status: 204 });

/** JSON only. A page on another site cannot send JSON here with the owner's cookie, so it cannot write anything. */
async function readJson(request: NextRequest): Promise<unknown> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return undefined;
  const text = await request.text();
  if (text.length > 64 * 1024) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function handleApi(request: NextRequest, ws: string, path: string[]): Promise<Response> {
  const cookie = (name: string): string | undefined => request.cookies.get(name)?.value;
  const role = await roleOf(ws, cookie);
  if (!role) return json({ error: "This workspace is opened by link. Open the full link you were sent." }, 401);

  const guest = role === "guest";
  const method = request.method;
  const origin = request.nextUrl.origin;
  const home = `${origin}/w/${ws}`;
  const store = new FlowStore(ws);
  const notes = new NoteStore(ws);
  const [first, flowId, third, noteId] = path;
  const is = (verb: string, ...parts: (string | undefined)[]): boolean =>
    method === verb && path.length === parts.length && parts.every((part, i) => part === undefined || part === path[i]);

  const shareStatus = async (): Promise<ShareStatus> => {
    const key = await shareKey(ws);
    return key ? { on: true, link: `${home}?key=${key}` } : { on: false };
  };
  const noFlow = (): Response => json({ error: `There is no flow "${flowId}".` }, 404);

  if (is("GET", "session")) {
    if (guest) return json({ role });
    // The owner link is how the owner gets back in from another browser, so they can always read it here.
    return json({ role, ownerLink: `${home}?owner=${cookie(ownerCookie(ws))}`, share: await shareStatus(), limits: limitsFor(ws) });
  }

  // ── flows: read only, for everyone ─────────────────────────────────────────

  if (is("GET", "flows")) return json({ flows: await store.list() });

  if (is("GET", "flows", undefined)) {
    const payload = await store.get(flowId);
    return payload ? json(payload) : noFlow();
  }

  // The build brief as Markdown.
  if (is("GET", "flows", undefined, "brief")) {
    const payload = await store.get(flowId);
    if (!payload) return plain(`There is no flow "${flowId}".`, 404);
    const target = request.nextUrl.searchParams.get("target") ?? undefined;
    const screen = request.nextUrl.searchParams.get("screen") ?? undefined;
    if (target && !TARGET_IDS.includes(target)) return plain(`"${target}" is not a build target. Targets: ${TARGET_IDS.join(", ")}.`, 400);
    if (screen && !payload.spec.screens.some((s) => s.id === screen)) return plain(`Flow "${flowId}" has no screen "${screen}".`, 400);
    return plain(renderBuildBrief(payload.spec, { target, screen, url: `${home}#/f/${flowId}`, notes: await notes.open(flowId) }));
  }

  // ── notes and sticky notes ─────────────────────────────────────────────────

  if (first === "flows" && third === "notes" && path.length === 3) {
    const payload = await store.get(flowId);
    if (!payload) return noFlow();
    if (method === "GET") return json({ notes: await notes.list(flowId) });
    if (method === "POST") {
      const body = await readJson(request);
      const input = body === undefined ? "Send the note as JSON." : readNoteInput(body);
      if (typeof input === "string") return json({ error: input }, 400);
      if (!frameRefs(payload.spec).includes(input.frame)) return json({ error: `This flow has no frame "${input.frame}".` }, 400);
      const note = await notes.add(flowId, input, guest);
      if (!note) return json({ error: `This flow already has ${limitsFor(ws).notesPerFlow} notes. Delete some before adding more.` }, 409);
      return json({ note }, 201);
    }
  }

  if (first === "flows" && third === "notes" && path.length === 4 && (method === "PATCH" || method === "DELETE")) {
    const payload = await store.get(flowId);
    const note = payload ? await notes.get(flowId, noteId) : undefined;
    if (!payload || !note) return json({ error: `There is no note "${noteId}" on this flow.` }, 404);
    if (guest && !note.guest) return json({ error: "Only the person who shared this board can change their own notes." }, 403);

    if (method === "DELETE") {
      await notes.remove(flowId, noteId);
      return empty();
    }
    const body = await readJson(request);
    if (body === undefined) return json({ error: "Send the change as JSON." }, 400);
    const done = (body as { done?: unknown } | null)?.done;
    if (typeof done === "boolean") {
      return json({ note: done ? await notes.resolve(flowId, noteId, "person") : await notes.reopen(flowId, noteId) });
    }
    const patch = readNotePatch(body);
    if (typeof patch === "string") return json({ error: patch }, 400);
    if (patch.frame && !frameRefs(payload.spec).includes(patch.frame)) return json({ error: `This flow has no frame "${patch.frame}".` }, 400);
    return json({ note: await notes.update(flowId, noteId, patch) });
  }

  // ── live: one event stream per page, and what each page reports back ───────

  if (is("GET", "events")) {
    const client = request.nextUrl.searchParams.get("client") ?? undefined;
    const { stream, closed } = hub.openStream(ws, client, role, request.signal, async () => Boolean(await roleOf(ws, cookie, true)));
    // Keep the function alive after the page goes, long enough to take the person off the list.
    after(() => closed.catch(() => undefined));
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Proxies must not hold the stream back.
        "X-Accel-Buffering": "no",
      },
    });
  }

  if (is("POST", "presence")) {
    const body = (await readJson(request)) as { client?: unknown } | undefined;
    if (!body || !(await hub.update(ws, body.client, body, role))) {
      return json({ error: 'Send who you are as JSON, with the "client" id your page chose.' }, 400);
    }
    return empty();
  }

  // ── the owner only ─────────────────────────────────────────────────────────

  if (!guest) {
    // What the owner is looking at, so their agent can resolve "this". Guests clicking around must not change it.
    if (is("POST", "view")) {
      const body = (await readJson(request)) as Partial<ViewState> | undefined;
      if (body && typeof body.flowId === "string") {
        await hub.setView(ws, { ...body, flowId: body.flowId, at: new Date().toISOString() } as ViewState);
      }
      return empty();
    }

    // A blank flow, for the owner to start from before an agent has drawn anything.
    if (is("POST", "flows")) {
      if ((await readJson(request)) === undefined) return json({ error: "Send an empty JSON object." }, 400);
      const limits = limitsFor(ws);
      if ((await store.count()) >= limits.flows) {
        return json({ error: `This workspace already has ${limits.flows} flows, which is the most it can hold.` }, 409);
      }
      const result = validateFlow(BLANK_FLOW);
      if (!result.flow) throw new Error("The blank flow does not pass validation.");
      try {
        const id = await store.freeId(slugify(result.flow.name));
        return json(await store.save(id, result.flow, result.issues, "Created"), 201);
      } catch (error) {
        if (!(error instanceof StaleFlowError)) throw error;
        return json({ error: "Another flow was made at the same moment. Try again." }, 409);
      }
    }

    if (is("GET", "agent")) {
      const lastSeen = await hub.agentLastSeen(ws);
      return json(lastSeen ? { lastSeen } : {});
    }

    if (is("GET", "share")) return json(await shareStatus());

    if (is("POST", "share")) {
      const on = ((await readJson(request)) as { on?: unknown } | undefined)?.on;
      if (typeof on !== "boolean") return json({ error: 'Send {"on": true} or {"on": false}.' }, 400);
      await setSharing(ws, on);
      // Guests on the old link are let go, and the owner's other pages redraw the share panel.
      await hub.recheckGuests(ws);
      await hub.send(ws, { type: "share" }, { owners: true });
      return json(await shareStatus());
    }

    // A new agent key. The old one stops working, so this is also how a leaked key is taken back.
    if (is("POST", "key")) {
      if ((await readJson(request)) === undefined) return json({ error: "Send an empty JSON object." }, 400);
      return json({ agentKey: await rotateAgentKey(ws) });
    }
  }

  // Anything else under /api does not exist.
  return json({ error: "There is no such endpoint." }, 404);
}
