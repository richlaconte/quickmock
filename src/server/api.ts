// The HTTP API behind the viewer. There are two doors onto it: the owner's,
// which only this computer can reach, and the guests', which is what a share
// link opens. Both get the same router with a different role.
//
// Guests can read flows, see who is here, and write notes. They cannot change
// the notes of the person who shared the board, start or stop sharing, or feed
// the agent's get_selection. The agent endpoint itself is not in this router
// at all, so it never appears on the guests' door.

import { Router, type Request, type Response } from "express";

import { TARGET_IDS } from "../design-system/targets";
import { renderBuildBrief } from "../shared/brief";
import { frameRefs } from "../shared/machine";
import type { Role, ShareStatus, ViewState } from "../shared/types";
import type { Hub } from "./hub";
import { NOTES_PER_FLOW, readNoteInput, readNotePatch, type NoteStore } from "./notes";
import type { FlowStore } from "./store";

export interface ApiContext {
  store: FlowStore;
  notes: NoteStore;
  hub: Hub;
  /** Where the owner's viewer is served, for the links an agent is given. */
  baseUrl: string;
  /** Owner's door only: remember what the owner is looking at. */
  setView?: (view: ViewState) => void;
  /** Owner's door only: turn sharing on and off. */
  share?: { status: () => ShareStatus; start: () => Promise<ShareStatus>; stop: () => Promise<ShareStatus> };
}

export function createApi(ctx: ApiContext, role: Role): Router {
  const { store, notes, hub } = ctx;
  const api = Router();
  const guest = role === "guest";

  const noFlow = (res: Response, id: string): void => {
    res.status(404).json({ error: `There is no flow "${id}".` });
  };
  // JSON only. A page on another site cannot send JSON here without being let in first, so it cannot write anything.
  const isJson = (req: Request): boolean => Boolean(req.is("application/json"));

  api.get("/session", (_req, res) => {
    res.json(guest ? { role } : { role, share: ctx.share?.status() });
  });

  // ── flows: read only, for everyone ─────────────────────────────────────────

  api.get("/flows", (_req, res) => {
    res.json(guest ? { flows: store.list() } : { flows: store.list(), baseUrl: ctx.baseUrl });
  });

  api.get("/flows/:id", (req, res) => {
    const payload = store.get(req.params.id);
    if (!payload) return noFlow(res, req.params.id);
    res.json(payload);
  });

  // The build brief as Markdown: curl it into a file, or read it on the viewer's brief page.
  api.get("/flows/:id/brief", (req, res) => {
    const payload = store.get(req.params.id);
    if (!payload) {
      res.status(404).type("text/plain").send(`There is no flow "${req.params.id}".`);
      return;
    }
    const target = typeof req.query.target === "string" ? req.query.target : undefined;
    const screen = typeof req.query.screen === "string" ? req.query.screen : undefined;
    if (target && !TARGET_IDS.includes(target)) {
      res.status(400).type("text/plain").send(`"${target}" is not a build target. Targets: ${TARGET_IDS.join(", ")}.`);
      return;
    }
    if (screen && !payload.spec.screens.some((s) => s.id === screen)) {
      res.status(400).type("text/plain").send(`Flow "${req.params.id}" has no screen "${screen}".`);
      return;
    }
    const brief = renderBuildBrief(payload.spec, {
      target,
      screen,
      url: guest ? undefined : `${ctx.baseUrl}/#/f/${req.params.id}`,
      notes: notes.open(req.params.id),
    });
    // Plain text, so a browser shows it instead of offering a download.
    res.type("text/plain; charset=utf-8").send(brief);
  });

  // ── notes and sticky notes ─────────────────────────────────────────────────

  api.get("/flows/:id/notes", (req, res) => {
    if (!store.get(req.params.id)) return noFlow(res, req.params.id);
    res.json({ notes: notes.list(req.params.id) });
  });

  api.post("/flows/:id/notes", (req, res) => {
    const payload = store.get(req.params.id);
    if (!payload) return noFlow(res, req.params.id);
    const input = isJson(req) ? readNoteInput(req.body) : "Send the note as JSON.";
    if (typeof input === "string") {
      res.status(400).json({ error: input });
      return;
    }
    if (!frameRefs(payload.spec).includes(input.frame)) {
      res.status(400).json({ error: `This flow has no frame "${input.frame}".` });
      return;
    }
    const note = notes.add(req.params.id, input, guest);
    if (!note) {
      res.status(409).json({ error: `This flow already has ${NOTES_PER_FLOW} notes. Delete some before adding more.` });
      return;
    }
    res.status(201).json({ note });
  });

  /** The note a request is about, if this door may change it. Answers the request itself when it may not. */
  const editable = (req: Request<{ id: string; noteId: string }>, res: Response): boolean => {
    const note = store.get(req.params.id) ? notes.get(req.params.id, req.params.noteId) : undefined;
    if (!note) {
      res.status(404).json({ error: `There is no note "${req.params.noteId}" on this flow.` });
      return false;
    }
    if (guest && !note.guest) {
      res.status(403).json({ error: "Only the person who shared this board can change their own notes." });
      return false;
    }
    return true;
  };

  api.patch("/flows/:id/notes/:noteId", (req, res) => {
    if (!editable(req, res)) return;
    if (!isJson(req)) {
      res.status(400).json({ error: "Send the change as JSON." });
      return;
    }
    const { id, noteId } = req.params;
    const done = (req.body as { done?: unknown }).done;
    if (typeof done === "boolean") {
      res.json({ note: done ? notes.resolve(id, noteId, "person") : notes.reopen(id, noteId) });
      return;
    }
    const patch = readNotePatch(req.body);
    if (typeof patch === "string") {
      res.status(400).json({ error: patch });
      return;
    }
    const frames = frameRefs(store.get(id)!.spec);
    if (patch.frame && !frames.includes(patch.frame)) {
      res.status(400).json({ error: `This flow has no frame "${patch.frame}".` });
      return;
    }
    res.json({ note: notes.update(id, noteId, patch) });
  });

  api.delete("/flows/:id/notes/:noteId", (req, res) => {
    if (!editable(req, res)) return;
    notes.remove(req.params.id, req.params.noteId);
    res.status(204).end();
  });

  // ── live: one event stream per page, and what each page reports back ───────

  api.get("/events", (req, res) => {
    const client = typeof req.query.client === "string" ? req.query.client : undefined;
    hub.open(req, res, client, role);
  });

  api.post("/presence", (req, res) => {
    const body = req.body as { client?: unknown } | undefined;
    if (!isJson(req) || !hub.update(body?.client, body, role)) {
      res.status(400).json({ error: "Send who you are as JSON, with the \"client\" id your page chose." });
      return;
    }
    res.status(204).end();
  });

  // ── the owner's door only ──────────────────────────────────────────────────

  if (!guest) {
    // What the owner is looking at, so their agent can resolve "this". Guests clicking around must not change it.
    api.post("/view", (req, res) => {
      const body = req.body as Partial<ViewState> | undefined;
      if (isJson(req) && body && typeof body.flowId === "string") {
        ctx.setView?.({ ...body, flowId: body.flowId, at: new Date().toISOString() } as ViewState);
      }
      res.status(204).end();
    });

    api.get("/share", (_req, res) => {
      res.json(ctx.share?.status() ?? { on: false, starting: false, links: [] });
    });

    api.post("/share", async (req, res) => {
      const on = (req.body as { on?: unknown } | undefined)?.on;
      if (!isJson(req) || typeof on !== "boolean" || !ctx.share) {
        res.status(400).json({ error: `Send {"on": true} or {"on": false}.` });
        return;
      }
      res.json(on ? await ctx.share.start() : await ctx.share.stop());
    });
  }

  // Anything else under /api does not exist. Say so as JSON, before a viewer's catch-all answers with a page.
  api.use((_req, res) => {
    res.status(404).json({ error: "There is no such endpoint." });
  });

  return api;
}
