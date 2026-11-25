// The server side: workspaces and who may open them, the stores in Postgres,
// and the hub. These need a database, so they run when DATABASE_URL is set
// (it is read from .env.local) and are skipped otherwise. Redis is not needed:
// without REDIS_URL the hub keeps its state in this process.

import assert from "node:assert/strict";
import { after, test } from "node:test";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // No such file.
  }
}
delete process.env.REDIS_URL;
delete process.env.KV_URL;

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL is not set";

const { query } = await import("../src/server/db");
const hub = await import("../src/server/hub");
const { limitsFor } = await import("../src/server/limits");
const { NoteStore } = await import("../src/server/notes");
const { FlowStore, StaleFlowError } = await import("../src/server/store");
const workspaces = await import("../src/server/workspaces");
const { validateFlow } = await import("../src/shared/validate");
import type { ServerEvent } from "../src/shared/types";

const made: string[] = [];
async function workspace(): Promise<Awaited<ReturnType<typeof workspaces.createWorkspace>>> {
  const ws = await workspaces.createWorkspace();
  made.push(ws.id);
  return ws;
}

after(async () => {
  if (skip) return;
  for (const id of made) await query("delete from workspaces where id = $1", [id]);
  await (globalThis as { quickmockPool?: { end: () => Promise<void> } }).quickmockPool?.end();
});

const cookies = (jar: Record<string, string>) => (name: string) => jar[name];

test("a new workspace starts with the examples, and is opened only by its own secrets", { skip }, async () => {
  const ws = await workspace();
  const other = await workspace();
  assert.match(ws.id, workspaces.WORKSPACE_ID);
  assert.deepEqual(await new FlowStore(ws.id).ids(), ["cancel-subscription", "sign-in", "team-members"]);

  const owner = cookies({ [workspaces.ownerCookie(ws.id)]: ws.ownerToken });
  assert.equal(await workspaces.roleOf(ws.id, owner), "owner");
  assert.equal(await workspaces.roleOf(ws.id, cookies({})), undefined);
  assert.equal(await workspaces.roleOf(ws.id, cookies({ [workspaces.ownerCookie(ws.id)]: other.ownerToken })), undefined);
  assert.equal(await workspaces.roleOf("nosuchspace1", owner), undefined);

  assert.equal(await workspaces.workspaceForKey(ws.agentKey), ws.id);
  assert.equal(await workspaces.workspaceForKey(ws.agentKey.slice(0, -1) + "x"), undefined);
  assert.equal(await workspaces.workspaceForKey(`qm_${other.id}_${ws.agentKey.split("_").slice(2).join("_")}`), undefined, "a key opens only its own workspace");
  const replaced = await workspaces.rotateAgentKey(ws.id);
  assert.equal(await workspaces.workspaceForKey(ws.agentKey), undefined, "the old key stops at once");
  assert.equal(await workspaces.workspaceForKey(replaced), ws.id);
});

test("a guest link works while sharing is on, and a new one is made each time", { skip }, async () => {
  const ws = await workspace();
  assert.equal(await workspaces.shareKey(ws.id), undefined, "sharing starts off");
  const first = (await workspaces.setSharing(ws.id, true))!;
  const guest = cookies({ [workspaces.guestCookie(ws.id)]: first });
  assert.equal(await workspaces.roleOf(ws.id, guest), "guest");
  await workspaces.setSharing(ws.id, false);
  assert.equal(await workspaces.roleOf(ws.id, guest), undefined);
  const second = (await workspaces.setSharing(ws.id, true))!;
  assert.notEqual(second, first);
  assert.equal(await workspaces.roleOf(ws.id, guest), undefined, "an old link stays dead");
});

test("flows keep their revisions, the order of their keys, and refuse a write made from an old version", { skip }, async () => {
  const ws = await workspace();
  const store = new FlowStore(ws.id);
  const first = (await store.get("sign-in"))!;
  assert.equal(first.meta.rev, 1);
  const again = validateFlow(JSON.parse(JSON.stringify(first.spec)));
  assert.equal(JSON.stringify(again.flow), JSON.stringify(first.spec), "the spec comes back exactly as it was written");

  const changed = { ...first.spec, description: "Changed" };
  const saved = await store.save("sign-in", changed, first.issues, "Described it", first);
  assert.deepEqual([saved.meta.rev, saved.meta.lastChange?.summary, saved.meta.lastChange?.changed], [2, "Described it", []]);
  await assert.rejects(store.save("sign-in", changed, first.issues, "From the old version", first), StaleFlowError);
  assert.equal(await store.freeId("sign-in"), "sign-in-2");
  assert.equal((await store.list())[0].id, "sign-in", "the newest change comes first");
  assert.equal(await new FlowStore((await workspace()).id).get("sign-in").then((p) => p?.meta.rev), 1, "another workspace has its own copy");
});

test("notes are kept beside the flow, with ids that are never reused", { skip }, async () => {
  const ws = await workspace();
  const store = new NoteStore(ws.id);
  const flow = "team-members";
  const first = (await store.add(flow, { frame: "team.default", text: "Move the seat count up" }))!;
  const second = (await store.add(flow, {
    frame: "team.default",
    text: "Make this secondary",
    target: { path: "layout[1].children[1]", type: "button", summary: "Invite someone" },
  }))!;
  assert.deepEqual([first.id, second.id], ["n1", "n2"]);
  assert.equal((await store.open(flow)).length, 2);
  assert.deepEqual(await store.list("sign-in"), [], "each flow has its own notes");
  assert.equal(await store.add("no-such-flow", { frame: "a.b", text: "x" }), undefined);

  const resolved = await store.resolve(flow, "n2", "agent", "  Changed it to the default button.  ");
  assert.deepEqual([resolved?.done?.by, resolved?.done?.reply], ["agent", "Changed it to the default button."]);
  assert.deepEqual((await store.open(flow)).map((n) => n.id), ["n1"]);
  assert.deepEqual([...(await store.openCounts())], [[flow, 1]]);
  assert.equal(await store.resolve(flow, "n9", "agent", "x"), undefined);

  assert.equal((await store.reopen(flow, "n2"))?.done, undefined);
  assert.equal(await store.remove(flow, "n2"), true);
  assert.equal(await store.remove(flow, "n2"), false);
  assert.equal((await store.add(flow, { frame: "team.empty", text: "Third" }))?.id, "n3", "a deleted note's id is not handed out again");
  assert.deepEqual((await store.list(flow)).map((n) => [n.id, n.frame, n.text]), [
    ["n1", "team.default", "Move the seat count up"],
    ["n3", "team.empty", "Third"],
  ]);
});

test("a sticky note keeps its place beside a frame, and can be moved and rewritten", { skip }, async () => {
  const ws = await workspace();
  const store = new NoteStore(ws.id);
  const flow = "team-members";
  const sticky = (await store.add(flow, { frame: "team.default", text: "Drawer instead?", sticky: { dx: -240, dy: 30 }, author: "Lena" }, true))!;
  assert.deepEqual([sticky.sticky, sticky.author, sticky.guest], [{ dx: -240, dy: 30 }, "Lena", true]);
  const plain = (await store.add(flow, { frame: "team.default", text: "From the owner" }))!;
  assert.equal(plain.guest, undefined, "only notes from the share link are marked as a guest's");

  assert.equal((await store.update(flow, sticky.id, { text: "Drawer instead of a modal?" }))?.text, "Drawer instead of a modal?");
  const moved = await store.update(flow, sticky.id, { frame: "team.empty", sticky: { dx: 12, dy: 400 } });
  assert.deepEqual([moved?.frame, moved?.sticky], ["team.empty", { dx: 12, dy: 400 }]);
  // An ordinary note is tied to its frame: a move is not something it has.
  assert.equal((await store.update(flow, plain.id, { frame: "team.empty", sticky: { dx: 1, dy: 1 } }))?.frame, "team.default");
  assert.equal(await store.update(flow, "n99", { text: "x" }), undefined);

  // Fill the flow up to its limit in one statement, then try one more.
  const limit = limitsFor(ws.id).notesPerFlow;
  await query(
    `insert into notes (ws, flow_id, id, seq, body)
     select $1, $2, 'x' || n, 1000 + n, '{"id":"x","frame":"team.default","text":"filler","at":"2026-01-01T00:00:00Z"}' from generate_series(1, $3::int) n`,
    [ws.id, flow, limit - 2],
  );
  assert.equal(await store.add(flow, { frame: "team.default", text: "One too many" }), undefined, "a flow's notes cannot grow without end");
});

/** Read a page's event stream into a list, the way a browser would. */
function listen(stream: ReadableStream<Uint8Array>): { events: ServerEvent[]; until: (test: (events: ServerEvent[]) => boolean) => Promise<void> } {
  const events: ServerEvent[] = [];
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = stream.getReader();
  void (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) if (part.startsWith("data: ")) events.push(JSON.parse(part.slice(6)) as ServerEvent);
    }
  })();
  const until = async (test: (events: ServerEvent[]) => boolean): Promise<void> => {
    for (let i = 0; i < 100 && !test(events); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(test(events), `still waiting; got ${JSON.stringify(events)}`);
  };
  return { events, until };
}

test("the hub tells each page who else is here and where their pointer is", { skip }, async () => {
  const ws = (await workspace()).id;
  const stay = async (): Promise<boolean> => true;
  const hostGone = new AbortController();
  const guestGone = new AbortController();
  const host = listen(hub.openStream(ws, "host-secret-0001", "owner", hostGone.signal, stay).stream);
  await host.until((e) => e.some((x) => x.type === "hello"));
  const hello = host.events.find((x) => x.type === "hello")!;
  assert.ok(hello.type === "hello" && hello.role === "owner" && hello.people.length === 1 && hello.people[0].name === "Host");

  const guestStream = hub.openStream(ws, "guest-secret-0001", "guest", guestGone.signal, stay);
  const guest = listen(guestStream.stream);
  await guest.until((e) => e.some((x) => x.type === "hello"));
  await host.until((e) => e.some((x) => x.type === "person" && x.person.guest));
  const guestHello = guest.events.find((x) => x.type === "hello")!;
  assert.ok(guestHello.type === "hello" && guestHello.people.length === 2);
  const colours = guestHello.type === "hello" ? guestHello.people.map((p) => p.color) : [];
  assert.notEqual(colours[0], colours[1], "everyone gets their own pencil");
  assert.ok(!JSON.stringify(guest.events).includes("host-secret"), "nobody is told another page's secret");

  // Both open the same flow; the guest names themselves and moves their pointer.
  assert.equal(await hub.update(ws, "host-secret-0001", { flowId: "sign-in" }, "owner"), true);
  assert.equal(await hub.update(ws, "guest-secret-0001", { name: "  Lena  ", flowId: "sign-in", frame: "sign-in.default" }, "guest"), true);
  await host.until((e) => e.some((x) => x.type === "person" && x.person.name === "Lena" && x.person.frame === "sign-in.default"));
  await guest.until((e) => e.some((x) => x.type === "person" && x.person.flowId === "sign-in" && !x.person.guest));
  assert.equal(await hub.update(ws, "guest-secret-0001", { only: "cursor", flowId: "sign-in", cursor: { x: 12.34, y: 99999 } }, "guest"), true);
  await host.until((e) => e.some((x) => x.type === "cursor" && x.x === 12.3 && x.y === 50000));
  assert.ok(!guest.events.some((x) => x.type === "cursor"), "a page is not sent its own pointer");

  // On another flow, the host no longer gets the guest's pointer.
  await hub.update(ws, "host-secret-0001", { flowId: "team-members" }, "owner");
  await guest.until((e) => e.some((x) => x.type === "person" && x.person.flowId === "team-members"));
  const before = host.events.filter((x) => x.type === "cursor").length;
  await hub.update(ws, "guest-secret-0001", { only: "cursor", flowId: "sign-in", cursor: { x: 1, y: 2 } }, "guest");
  await hub.send(ws, { type: "list" });
  await host.until((e) => e.some((x) => x.type === "list"));
  assert.equal(host.events.filter((x) => x.type === "cursor").length, before);

  assert.equal(await hub.update(ws, "short", {}, "guest"), false, "a report needs a real client id");

  // The guest closes their page: after a moment they are gone for everyone.
  guestGone.abort();
  await guestStream.closed;
  await host.until((e) => e.some((x) => x.type === "left"));
  assert.deepEqual((await hub.people(ws)).map((p) => p.name), ["Host"]);

  await hub.setView(ws, { flowId: "sign-in", selectedFrame: "sign-in.default", at: "now" });
  assert.equal((await hub.getView(ws))?.selectedFrame, "sign-in.default");
  hostGone.abort();
});
