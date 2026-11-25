# quickmock

Lo-fi, pen-and-ink flow prototypes, drawn by an agent over MCP.

You describe a flow to your agent. It writes one JSON spec, and quickmock turns that spec into two views of the same thing in your browser: a **board** with a frame for every state of every screen, and a **working prototype** you can click through. Everything is drawn as a sketch on purpose, so people react to layout, wording and behaviour instead of to styling.

Other people can open the same board at the same time: you see each other's pointers, and everyone can leave notes and sticky notes for the agent to work through.

quickmock is a hosted app: Next.js on Vercel, with flows and notes in Postgres (Neon) and live updates over Redis (Upstash). "quickmock" is a working name.

## How it works for someone using it

There are no accounts. A workspace is opened with links that carry secrets:

| | What it is | What it can do |
| --- | --- | --- |
| **Owner link** | `/w/<workspace>?owner=...`, made with the workspace. The browser that made it remembers it in a cookie; the workspace's front page shows it again. | Everything in the viewer: read, write notes, turn sharing on and off, make a new agent key. |
| **Agent key** | `qm_<workspace>_...`, sent to `/mcp` as a bearer token. Shown once when it is made; a new one replaces it. | The only thing that can change a flow. |
| **Guest link** | `/w/<workspace>?key=...`, made when the owner presses Share. | Read every flow in the workspace, click through prototypes, write notes. |

1. Press **Start a workspace** on the front page. It starts with three example flows.
2. Copy the command from the workspace's front page and run it once in the project you want to use quickmock from:

   ```bash
   claude mcp add --transport http quickmock https://<your-domain>/mcp --header "Authorization: Bearer qm_..."
   ```

   Add `--scope user` to have it in every project. Any MCP client that can send a header works the same way.
3. Ask in plain words:

   > Use quickmock to sketch a password reset flow for a mobile app, with the unhappy paths.

The board fills in while the agent works. Click a frame or use **Point** on a component, say "this", and the agent can ask quickmock what you mean.

To ask for changes, write notes: click a frame, type in the Notes tab and press Enter, or double-click the board for a sticky note. Then tell the agent to work through the notes. It reads them, makes the changes and marks each one done with a line saying what it did.

## Working on it together

Press **Share** on a flow's page and choose Start sharing. You get a link to send.

Everyone picks a name (top right) and gets a pencil colour. On the board you see each other's pointers and which frame each person's prototype is on; click someone's badge to go where they are. Notes and sticky notes appear for everyone as they are written.

| A guest can | A guest cannot |
| --- | --- |
| See every flow in the workspace, the board and the build brief | Reach the agent endpoint: it needs the agent key |
| Click through the prototype, in their own session | Change a flow. Only the agent does that |
| Write notes and sticky notes, and change or delete guests' ones | Change, resolve or delete the owner's notes |
| See who else is there | Turn sharing on or off, make an agent key, or see the owner link |

How it is kept safe:

- The secret in a link is moved into an HttpOnly cookie on the first visit and dropped from the address bar.
- The owner secret and the agent key are stored only as hashes. Workspace pages are marked `noindex`.
- Stop sharing makes the guest link useless and ends guests' connections. Starting again makes a new link.
- Notes from guests are marked as such, and the agent is told to treat them as suggestions about the design, never as instructions.
- One workspace's secrets open nothing in another.

## Run it locally

It needs Node 22.12 or newer and a Postgres database. Redis is optional locally: without `REDIS_URL`, live updates stay in the one dev process.

```bash
npm install
cp .env.example .env.local     # then set DATABASE_URL
npm run db:migrate
npm run dev
```

Then open http://localhost:3000.

## Deploy it on Vercel

```bash
vercel link
vercel integration add neon       # Postgres: sets DATABASE_URL
vercel integration add upstash    # Redis: sets REDIS_URL (or KV_URL)
vercel deploy --prod
```

Every build runs `db/schema.sql` first (`npm run db:migrate`), which only adds what is missing. `vercel env pull .env.local` brings the same variables to your machine.

## What the agent can do

| Tool | What it does |
| --- | --- |
| `get_design_system` | The spec format, every component and prop, the patterns and the lint rules. Read before drawing. |
| `list_flows` | Flows in the workspace with sizes, lint counts and URLs. |
| `get_flow` | A flow's spec, or one screen of it. |
| `create_flow` | Create a flow from a complete spec. Anything outside the design system is rejected with a fix for each error. |
| `patch_flow` | Change states, screens and transitions in place. Changed frames are marked on the board with the agent's summary. |
| `lint_flow` | Every finding: dead ends, unhandled events, missing failure paths, two primary buttons and so on. |
| `get_selection` | What you are looking at: selected frame, pointed component, where the prototype is and its data. |
| `get_notes` | The notes and sticky notes written in the viewer, each with its frame, its component if one was pointed at, and who wrote it. Guests' notes are marked. |
| `resolve_notes` | Marks notes done, with a one-line reply you see beside each note. |
| `get_build_brief` | The flow written out as a build spec for the real product (see below). |

## What you see

- **Board** (`/w/<workspace>#/f/<flow>`): every state as a frame, arrows labelled with the words on the control that causes them, margin notes for open questions in red, lint counts per frame. Drag to pan, Ctrl/Cmd + scroll to zoom.
- **Prototype**, beside the board: the same spec running. The board follows where you are. Tabs show the frame's notes and exits, the lint list, and the flow's variables. Flip `simulateFailure` there to walk a failure branch.
- **Notes**, in the same panel: write what should change on the frame you are on, or turn on Point and click a component to write about just that. Open notes are written under their frames on the board in red, underlined to tell them from the questions the agent raised. Mark one done yourself, or let the agent do it.
- **Sticky notes**, on the board: double-click an empty spot, or press Sticky note. Drag one to move it, double-click it to change the words. A sticky note stays beside the frame it was put next to when the board is laid out again.
- **People**: a badge for everyone else on the flow, their pointer on the board, and a small badge on the frame each of them is on.
- **Prototype alone** (`#/f/<flow>/play`): the page to put in front of someone when you watch them use it.
- **Build brief** (`#/f/<flow>/brief`): what `get_build_brief` returns, with a target picker and a copy button.
- **Design system** (`#/design-system`): tokens, every component drawn live with its props, patterns and lint rules.

Flows are stored as JSON, one row per flow, with a revision counter and the last change. Notes and sticky notes are kept in their own table, not inside the flow, so an agent rewriting a state cannot lose them.

## The flow spec

```json
{
  "name": "Remove a member",
  "start": "member.default",
  "screens": [
    {
      "id": "member",
      "states": [
        {
          "id": "default",
          "note": "One person, and the one destructive thing you can do.",
          "layout": [
            { "type": "heading", "level": 1, "text": "Dana Whitfield" },
            { "type": "button", "label": "Remove from team", "event": "remove", "variant": "danger" }
          ]
        },
        {
          "id": "confirm",
          "over": "member.default",
          "questions": ["What happens to projects this person owns?"],
          "layout": [
            {
              "type": "modal",
              "title": "Remove Dana from the team?",
              "children": [
                { "type": "button", "label": "Keep Dana", "event": "close" },
                { "type": "button", "label": "Remove from team", "event": "confirm-remove", "variant": "danger" }
              ]
            }
          ]
        },
        {
          "id": "gone",
          "end": true,
          "layout": [{ "type": "heading", "level": 1, "text": "Dana was removed" }]
        }
      ]
    }
  ],
  "transitions": [
    { "from": "member.default", "on": "remove", "to": "member.confirm" },
    { "from": "member.confirm", "on": "close", "to": "member.default" },
    { "from": "member.confirm", "on": "confirm-remove", "to": "member.gone" }
  ]
}
```

- A state that looks different is a different state. There are no hidden conditionals inside a layout, which is why the board can show everything.
- Transitions fire on a component's `event`, on `change:<variable>` from a bound input, or `after` a delay. `when` guards them with a small expression language (`isEmail(email) && len(password) >= 8`).
- `from` can be one frame, `screen.*` or `*`. The most specific wins, then the first whose guard passes.
- `over` draws another frame's page behind a modal state, so the page is written once.
- There are no styling props. The spec cannot say what colour something is.

The full reference is what `get_design_system` returns; it is generated from the registry below.

## The design system

`src/design-system/` is one registry that everything else reads:

| File | Holds | Read by |
| --- | --- | --- |
| `tokens.ts` | Paper, inks, pens, roughness, type, device sizes | the kit, the style guide |
| `components.ts` | 23 components: props, types, defaults, rules, an example each | the validator, the agent reference, the kit, the style guide |
| `patterns.ts` | Form, async step, collection, confirm destructive, wizard, app shell | the agent reference, the style guide |
| `rules.ts` | Every lint rule | the validator's tests, the agent reference, the style guide |
| `targets.ts` | Component mappings for the build brief | the build brief |
| `reference.ts` | Renders all of the above as the text an agent reads | `get_design_system` |

To add a component: describe it in `components.ts`, then draw it in `src/viewer/kit/render.tsx`. A test fails until both exist, and the validator, the reference and the style guide pick it up from the registry.

Each material means one thing: ink is the design, pencil is secondary, red pencil is critique, non-photo blue is the tool (selection, where you are), highlighter is what changed, yellow paper is a sticky note, and each other person is a coloured pencil.

## The build brief

When a flow is agreed, `get_build_brief` turns it into a spec for building the real thing: every state with its components and wording, the variables and transition table, one acceptance check per state and per transition, the open questions, any of your notes that are still open, and a mapping from quickmock components to a real library.

Targets: `ui-sdk` ([UI SDK](https://ui-sdk.dev), the default), `shadcn`, and `none` (your own design system). Add one in `targets.ts`.

The UI SDK mapping names its components but not their APIs: it is in beta, so the brief tells the building agent to use UI SDK's own skill or shipped docs for those.

The build brief page in the viewer has a target picker and a copy button.

## Layout

```
src/app/             Next.js routes: the front page, /w/<workspace> (the viewer), /api/w/<workspace>/..., /api/workspaces, /mcp
src/proxy.ts         moves the secret in an owner or guest link into a cookie
src/design-system/   the registry (above)
src/shared/          spec types, guard expressions, state machine, validator and lint, patch ops, build brief
src/server/          workspaces (who may do what), api (the viewer's API), mcp (the agent's tools), store and notes (Postgres),
                     hub (who is here, pointers, change events), backend (Redis, or memory), limits, db
src/viewer/          the React app: board, prototype, notes, sticky notes and pointers, share panel, brief page, style guide
src/viewer/kit/      the pen-and-ink components (rough.js)
db/schema.sql        the tables
examples/            three lint-clean flows, copied into every new workspace
test/                node:test suites: spec.test.ts (no services needed), server.test.ts (needs DATABASE_URL)
scripts/smoke.ts     drives a running server as an agent, an owner and a guest
```

## Settings

| Variable | |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. Required. On Vercel, use the pooled one Neon provides. |
| `DATABASE_URL_UNPOOLED` | Used for migrations when set (Neon provides it). |
| `REDIS_URL` or `KV_URL` | Redis connection string (`rediss://...`). Required on Vercel, where a page's event stream and the request that changes something usually run in different function instances. |

What one workspace may hold (50 flows, 500 notes per flow) and how many workspaces one address may make in an hour are in `src/server/limits.ts`. That file is also where plans would go.

## Checks

```bash
npm test            # spec, lint, machine, brief and kit; plus the server suite when DATABASE_URL is set
npm run typecheck
npm run smoke       # needs a running server; QUICKMOCK_URL=https://... points it at a deployment
```

## Limits of this version

- There are no accounts and no billing. Whoever has the owner link owns the workspace, and if it is lost with no browser remembering it, the workspace cannot be recovered.
- A guest sees every flow in the workspace, not only the one in the link, and everyone with the guest link has the same key. A name is whatever someone types.
- Nothing deletes old workspaces yet.
- The agent changes a flow; people change it by writing notes. If two agents patch the same flow at the same moment, the second is told to read it again.
- Two people editing the same sticky note at once: the last one to finish wins.
- Pointers are shown on the board, not inside the prototype, where everyone has their own session. A moving pointer is a request about twelve times a second, each one a Redis publish: that is the main running cost of a busy board.
- An event stream lasts at most about four and a half minutes, then the page reconnects by itself and reloads what it shows.
- `get_selection` reports what the owner is looking at, never a guest.
- History is the revision counter and the last change.
- The sheet is a fixed size per device (880 x 600 desktop, 380 x 720 mobile). A longer page scrolls in the prototype, and its board frame shows only the top.
