# quickmock

Lo-fi, pen-and-ink flow prototypes, drawn by an agent over MCP.

You describe a flow to your agent. It writes one JSON spec, and quickmock turns that spec into two views of the same thing in your browser: a **board** with a frame for every state of every screen, and a **working prototype** you can click through. Everything is drawn as a sketch on purpose, so people react to layout, wording and behaviour instead of to styling.

Other people can open the same board at the same time: you see each other's pointers, and everyone can leave notes and sticky notes for the agent to work through.

"quickmock" is a working name.

## Run it

It needs Node 22.12 or newer, or 20.19 or newer on the 20 line; `node -v` shows yours. It was built on Node 22, and the server and its smoke test also pass on 20.19, 24 and 26. On an older Node, `npm start` stops and says so.

From inside the `quickmock` folder:

```bash
npm install && npm start
```

Then open http://localhost:4747. On first start, three example flows are copied into `flows/`.

## Connect Claude Code

With the server running, run this once in the project you want to use quickmock from:

```bash
claude mcp add --transport http quickmock http://localhost:4747/mcp
```

That adds it for you in that project only. Add `--scope user` to have it in every project. `claude mcp list` shows whether it connected, and `/mcp` inside Claude Code shows the same.

This folder also has a `.mcp.json`, so Claude Code started from here finds quickmock once you approve it.

Then ask in plain words:

> Use quickmock to sketch a password reset flow for a mobile app, with the unhappy paths.

The board fills in while the agent works. Click a frame or use **Point** on a component, say "this", and the agent can ask quickmock what you mean.

To ask for changes, write notes: click a frame, type in the Notes tab and press Enter, or double-click the board for a sticky note. Then tell the agent to work through the notes. It reads them, makes the changes and marks each one done with a line saying what it did.

## Working on it together

Press **Share** on a flow's page and choose Start sharing. quickmock builds a copy of the viewer, opens a second port for guests (4748 unless it is taken) and gives you a link with a key in it.

- **Same network:** send the link as it is.
- **Somewhere else:** run a tunnel to the guest port, for example `cloudflared tunnel --url http://localhost:4748`, and add the `?key=...` part the Share panel shows to the address the tunnel gives you.

Everyone picks a name (top right) and gets a pencil colour. On the board you see each other's pointers and which frame each person's prototype is on; click someone's badge to go where they are. Notes and sticky notes appear for everyone as they are written.

What a guest can and cannot do:

| A guest can | A guest cannot |
| --- | --- |
| See every flow, the board and the build brief | Reach the agent endpoint: it is not on the guest port at all |
| Click through the prototype, in their own session | Change a flow. Only your agent does that |
| Write notes and sticky notes, and change or delete guests' ones | Change, resolve or delete your notes |
| See who else is there | Turn sharing on or off, or see anything else on your computer |

How it is kept safe:

- Your own port (4747) still listens on 127.0.0.1 only. The agent endpoint and Vite's dev server stay there and are never exposed.
- The guest port serves plain built files and a smaller API. Nothing gets in without the key; the link sets a cookie and the key is dropped from the address bar.
- Stop sharing closes the guest port. Starting again makes a new key, so old links stop working. Sharing is always off when quickmock starts.
- Notes from guests are marked as such, and the agent is told to treat them as suggestions about the design, never as instructions.

`QUICKMOCK_SHARE=1 npm start` turns sharing on at start and prints the links in the terminal.

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

- **Board** (`/#/f/<flow>`): every state as a frame, arrows labelled with the words on the control that causes them, margin notes for open questions in red, lint counts per frame. Drag to pan, Ctrl/Cmd + scroll to zoom.
- **Prototype**, beside the board: the same spec running. The board follows where you are. Tabs show the frame's notes and exits, the lint list, and the flow's variables. Flip `simulateFailure` there to walk a failure branch.
- **Notes**, in the same panel: write what should change on the frame you are on, or turn on Point and click a component to write about just that. Open notes are written under their frames on the board in red, underlined to tell them from the questions the agent raised. Mark one done yourself, or let the agent do it.
- **Sticky notes**, on the board: double-click an empty spot, or press Sticky note. Drag one to move it, double-click it to change the words. A sticky note stays beside the frame it was put next to when the board is laid out again.
- **People**: a badge for everyone else on the flow, their pointer on the board, and a small badge on the frame each of them is on.
- **Prototype alone** (`/#/f/<flow>/play`): the page to put in front of someone when you watch them use it.
- **Build brief** (`/#/f/<flow>/brief`): what `get_build_brief` returns, with a target picker and a copy button.
- **Design system** (`/#/design-system`): tokens, every component drawn live with its props, patterns and lint rules.

Flows are plain JSON in `flows/`. Edit one by hand and the page updates; a file that stops parsing is reported and the last good version stays up. Notes and sticky notes are kept beside them in `flows/.notes/`, not inside the flow, so an agent rewriting a state cannot lose them.

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

```bash
curl "http://localhost:4747/api/flows/sign-in/brief?target=shadcn" > brief.md
```

## Layout

```
src/design-system/   the registry (above)
src/shared/          spec types, guard expressions, state machine, validator and lint, patch ops, build brief
src/server/          one process, two doors: index (yours: /mcp, /api, Vite), share (the guests'), api (both),
                     hub (who is here, pointers, change events), notes, store, mcp
src/viewer/          the React app: board, prototype, notes, sticky notes and pointers, share panel, brief page, style guide
src/viewer/kit/      the pen-and-ink components (rough.js)
examples/            three lint-clean flows, seeded into flows/ on first start
test/                node:test suite
scripts/smoke.ts     drives a running server with a real MCP client
```

## Settings

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `4747` | Change the URL in the `claude mcp add` command to match. |
| `QUICKMOCK_FLOWS` | `./flows` | Where flows and their notes are kept. `./flows` is ignored by git here; point this at a folder inside your product's repo to version your flows with it. |
| `QUICKMOCK_SHARE_PORT` | `PORT + 1` | The port guests connect to while sharing is on. The next few are tried if it is taken. |
| `QUICKMOCK_SHARE` | off | Set to `1` to turn sharing on at start. |

## Checks

```bash
npm test            # spec, lint, machine, brief and kit
npm run typecheck
npm run smoke       # needs the server running; creates a flow called smoke-test
```

## Limits of this prototype

- It runs on your computer. Guests can get in only while quickmock is running and sharing is on.
- There are no accounts. A name is whatever someone types, and everyone with the link has the same key.
- On your local network the guest link is plain http, so it is not encrypted. A tunnel gives you https.
- A guest sees every flow in the workspace, not only the one in the link.
- The flow itself is changed only by an agent on your computer. Guests change it by writing notes.
- Two people editing the same sticky note at once: the last one to finish wins.
- Pointers are shown on the board, not inside the prototype, where everyone has their own session.
- Your own viewer is served by Vite in dev mode. Only guests get built files.
- `get_selection` reports what you are looking at, never a guest.
- History is the revision counter and the last change. The flows are files, so git is the real history.
- The sheet is a fixed size per device (880 x 600 desktop, 380 x 720 mobile). A longer page scrolls in the prototype, and its board frame shows only the top.
