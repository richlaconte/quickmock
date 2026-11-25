import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { COMPONENTS, COMPONENT_TYPES } from "../src/design-system/components";
import { PATTERNS } from "../src/design-system/patterns";
import { renderComponentDetail, renderReference } from "../src/design-system/reference";
import { RULES } from "../src/design-system/rules";
import { TARGET_IDS, buildTarget } from "../src/design-system/targets";
import { renderBuildBrief } from "../src/shared/brief";
import { ExprError, exprVariables, parseExpr, passes } from "../src/shared/expr";
import {
  dataForFrame,
  describeTransition,
  initialData,
  interpolate,
  pageBehind,
  pickTransition,
  reachableFrames,
  resolveRef,
  timedTransitions,
} from "../src/shared/machine";
import { noteAuthor, noteWhere, openNotes, orphanedNotes } from "../src/shared/notes";
import { diffFlows } from "../src/shared/patch";
import type { Flow, FlowNode, Issue, ReviewNote } from "../src/shared/types";
import { countIssues, formatIssue, validateFlow } from "../src/shared/validate";
import { NOTE_MAX_LENGTH, readNoteInput, readNotePatch } from "../src/server/notes";
import { computeBoard } from "../src/viewer/Board";
import { STICKY_WIDTH, anchorFor, initials, stickyPosition } from "../src/viewer/BoardLive";
import { Device, RENDERERS, STATIC_CONTEXT, StateLayout } from "../src/viewer/kit/render";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const examplesDir = join(root, "examples");

function loadExample(name: string): unknown {
  return JSON.parse(readFileSync(join(examplesDir, name), "utf8"));
}

/** The smallest valid flow around a layout, for testing one thing at a time. */
function flowWith(layout: FlowNode[], extra: Partial<Flow> = {}): Flow {
  return {
    name: "Test",
    start: "home.default",
    screens: [{ id: "home", states: [{ id: "default", end: true, layout }] }],
    transitions: [],
    ...extra,
  };
}

function codes(issues: Issue[]): string[] {
  return issues.map((i) => i.code);
}

// ── guards ──────────────────────────────────────────────────────────────────

test("guards evaluate comparisons, logic and functions", () => {
  const data = { reason: "Something else", seats: "3", agreed: true, email: "a@b.co", empty: "" };
  assert.equal(passes("reason == 'Something else'", data), true);
  assert.equal(passes("reason != ''", data), true);
  assert.equal(passes("empty != ''", data), false);
  assert.equal(passes("seats >= 3 && agreed", data), true);
  assert.equal(passes("seats > 3 || !agreed", data), false);
  assert.equal(passes("isEmail(email) && len(reason) > 5", data), true);
  assert.equal(passes("contains(reason, 'ELSE')", data), true);
  assert.equal(passes("empty(empty) and not empty(reason)", data), true);
  assert.equal(passes("(seats == 3) && (agreed === true)", data), true);
  assert.equal(passes(undefined, data), true);
  assert.equal(passes("missing == ''", data), true, "unknown variables read as empty text");
});

test("guards report readable errors", () => {
  assert.throws(() => parseExpr("reason = 'x'"), ExprError);
  assert.throws(() => parseExpr("reason =="), ExprError);
  assert.throws(() => parseExpr("nope(reason)"), /unknown function/);
  assert.throws(() => parseExpr("len(a, b)"), /takes 1 argument/);
  assert.throws(() => parseExpr("'unterminated"), /unterminated/);
  assert.deepEqual(exprVariables("isEmail(email) && len(password) >= 8 && !agreed").sort(), ["agreed", "email", "password"]);
});

// ── the design system is internally consistent ──────────────────────────────

test("every component example is valid in its own design system", () => {
  for (const def of COMPONENTS) {
    const layout: FlowNode[] = def.topLevelOnly
      ? [{ type: "heading", level: 1, text: "Page" }, def.example]
      : [{ type: "heading", level: 1, text: "Page" }, def.example];
    const result = validateFlow(flowWith(layout));
    const errors = result.issues.filter((i) => i.severity === "error");
    assert.deepEqual(errors.map(formatIssue), [], `example for ${def.type}`);
  }
});

test("every pattern example is valid", () => {
  for (const pattern of PATTERNS) {
    const result = validateFlow(flowWith(pattern.example));
    const errors = result.issues.filter((i) => i.severity === "error");
    assert.deepEqual(errors.map(formatIssue), [], `pattern ${pattern.id}`);
  }
});

test("for every choice prop, the first value is the default", () => {
  for (const def of COMPONENTS) {
    for (const [name, prop] of Object.entries(def.props)) {
      if (prop.type.kind === "enum") {
        assert.equal(prop.default, prop.type.values[0], `${def.type}.${name}`);
      }
    }
  }
});

test("the agent reference covers every component and stays small", () => {
  const reference = renderReference();
  for (const type of COMPONENT_TYPES) assert.ok(reference.includes(`**${type}**`), `reference mentions ${type}`);
  for (const rule of RULES) assert.ok(reference.includes(rule.code), `reference mentions rule ${rule.code}`);
  // Claude Code warns when one tool result passes 10,000 tokens; stay well under.
  assert.ok(reference.length < 30000, `reference is ${reference.length} characters`);
  assert.ok(renderComponentDetail("button")?.includes('"type": "button"'));
  assert.equal(renderComponentDetail("nope"), undefined);
});

// ── the examples ────────────────────────────────────────────────────────────

test("seeded examples have no errors and no warnings", () => {
  const files = readdirSync(examplesDir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 3);
  for (const file of files) {
    const result = validateFlow(loadExample(file));
    const problems = result.issues.filter((i) => i.severity !== "info");
    assert.deepEqual(problems.map(formatIssue), [], file);
    assert.ok(result.flow, file);
    const reached = reachableFrames(result.flow!);
    assert.ok(reached.size > 3, `${file} reaches ${reached.size} frames`);
  }
});

test("lint only emits documented rule codes for warnings and info", () => {
  const known = new Set(RULES.map((r) => r.code));
  const messy = flowWith(
    [
      { type: "button", label: "Submit", event: "go", variant: "primary" },
      { type: "button", label: "OK", event: "go2", variant: "primary" },
      { type: "input", bind: "x" },
      { type: "text", text: "Lorem ipsum dolor sit amet {nobody}" },
      { type: "card", children: [{ type: "card", children: [{ type: "text", text: "Inner" }] }] },
      { type: "list", items: [{ title: "Row", event: "open" }] },
      { type: "loading" },
    ],
    {
      screens: [
        {
          id: "home",
          states: [
            {
              id: "default",
              layout: [
                { type: "button", label: "Submit", event: "go", variant: "primary" },
                { type: "button", label: "OK", event: "go2", variant: "primary" },
                { type: "input", bind: "x" },
                { type: "text", text: "Lorem ipsum dolor sit amet {nobody}" },
                { type: "card", children: [{ type: "card", children: [{ type: "text", text: "Inner" }] }] },
                { type: "list", items: [{ title: "Row", event: "open" }] },
              ],
            },
            { id: "orphan", layout: [{ type: "modal", children: [{ type: "text", text: "Stuck" }] }] },
            { id: "busy", layout: [{ type: "heading", text: "Busy" }, { type: "loading" }] },
          ],
        },
      ],
      transitions: [
        { from: "home.default", on: "go", when: "x != '' && ghost", to: "home.busy" },
        { from: "home.default", on: "go2", to: "home.busy" },
        { from: "home.default", on: "go2", to: "home.default" },
        { from: "home.default", on: "never", to: "home.busy" },
        { from: "home.busy", after: 500, to: "home.default" },
      ],
    },
  );
  const result = validateFlow(messy);
  assert.equal(countIssues(result.issues).errors, 0, result.issues.map(formatIssue).join("\n"));
  const found = new Set(codes(result.issues));
  for (const code of found) assert.ok(known.has(code), `undocumented rule code: ${code}`);
  for (const expected of [
    "one-primary",
    "unlabelled-input",
    "placeholder-copy",
    "nested-card",
    "unknown-variable",
    "unreachable",
    "modal-trap",
    "unhandled-event",
    "never-fires",
    "shadowed",
    "no-failure-path",
    "guard-no-fallback",
    "no-empty-state",
    "no-invalid-state",
    "vague-label",
    "no-title",
  ]) {
    assert.ok(found.has(expected), `expected lint to report ${expected}; got ${[...found].join(", ")}`);
  }
});

// ── rejecting what is outside the system ────────────────────────────────────

test("unknown components are rejected with the right replacement", () => {
  const result = validateFlow(flowWith([{ type: "dropdown", bind: "x", options: ["a"] }]));
  const issue = result.issues.find((i) => i.code === "unknown-component");
  assert.ok(issue);
  assert.match(issue!.fix ?? "", /Use select/);
  assert.equal(result.flow, undefined);
});

test("styling props and wrong prop names are rejected with a hint", () => {
  const result = validateFlow(
    flowWith([
      { type: "button", text: "Save", event: "save", color: "blue" },
      { type: "text", label: "Hello" },
      { type: "input", name: "email", label: "Email" },
    ]),
  );
  const fixes = result.issues.filter((i) => i.code === "unknown-prop").map((i) => i.fix ?? "");
  assert.ok(fixes.some((f) => /Use "label"/.test(f)));
  assert.ok(fixes.some((f) => /no styling props/.test(f)));
  assert.ok(fixes.some((f) => /Use "text"/.test(f)));
  assert.ok(fixes.some((f) => /Use "bind"/.test(f)));
  assert.ok(codes(result.issues).includes("missing-prop"));
});

test("structural mistakes are reported with paths", () => {
  const result = validateFlow({
    name: "Broken",
    start: "nowhere",
    screens: [
      {
        id: "Home Page",
        states: [{ id: "default", layout: [] }],
      },
      {
        id: "list",
        states: [
          {
            id: "default",
            layout: [
              { type: "table", columns: ["A", "B"], rows: [["only one"]] },
              { type: "steps", items: ["One"], current: 3 },
              { type: "row", children: [{ type: "modal", children: [{ type: "text", text: "x" }] }] },
            ],
          },
        ],
      },
    ],
    transitions: [{ from: "list.default", to: "list.default" }, { from: "list.default", on: "x", when: "a =", to: "list" }],
    theme: "dark",
  });
  const found = codes(result.issues);
  for (const expected of ["unknown-field", "bad-id", "table-shape", "steps-range", "misplaced-component", "bad-trigger", "bad-guard"]) {
    assert.ok(found.includes(expected), `expected ${expected}; got ${found.join(", ")}`);
  }
  assert.ok(result.issues.every((i) => i.severity === "error"));
});

test("references to missing frames are errors that list the real ones", () => {
  const result = validateFlow(
    flowWith([{ type: "button", label: "Go on", event: "go" }], {
      transitions: [{ from: "home.default", on: "go", to: "hom.default" }],
    }),
  );
  const issue = result.issues.find((i) => i.code === "unknown-frame");
  assert.ok(issue);
  assert.match(issue!.fix ?? "", /Did you mean "home"/);
});

// ── the machine ─────────────────────────────────────────────────────────────

test("the most specific transition wins, then the first whose guard passes", () => {
  const flow = validateFlow(loadExample("cancel-subscription.json")).flow!;
  const data = initialData(flow);
  assert.equal(data.simulateFailure, false);
  assert.equal(data.reason, "");

  assert.equal(pickTransition(flow, "reason.default", "continue", data)?.transition.to, "reason.invalid");
  assert.equal(pickTransition(flow, "reason.default", "continue", { ...data, reason: "It costs too much" })?.transition.to, "offer.default");
  assert.equal(pickTransition(flow, "reason.other", "keep", data)?.transition.to, "account.default", "screen.* covers every state");
  assert.equal(pickTransition(flow, "done.default", "nav-billing", data)?.transition.to, "account.default");
  assert.equal(pickTransition(flow, "done.default", "nav-billing", { ...data, cancelled: true })?.transition.to, "account.cancelled");
  assert.equal(pickTransition(flow, "reason.default", "change:reason", { ...data, reason: "Something else" })?.transition.to, "reason.other");
  assert.equal(pickTransition(flow, "reason.default", "nothing", data), undefined);

  const timed = timedTransitions(flow, "confirm.submitting");
  assert.equal(timed.length, 1);
  assert.equal(timed[0].after, 1400);
  assert.deepEqual(timed[0].candidates.map((c) => c.transition.to), ["confirm.failed", "done.default"]);

  assert.equal(resolveRef(flow, "offer"), "offer.default");
  assert.equal(resolveRef(flow, "offer.nope"), undefined);
});

test("arrows are labelled in the words on the control", () => {
  const flow = validateFlow(loadExample("cancel-subscription.json")).flow!;
  const label = (from: string, on: string): string =>
    describeTransition(flow, flow.transitions.find((t) => t.from === from && t.on === on)!);
  assert.equal(label("account.default", "cancel"), "“Cancel plan”");
  assert.equal(label("reason.default", "continue"), "“Continue” if reason != ''");
  assert.equal(label("reason.other", "change:reason"), "reason changes if reason != 'Something else'");
  assert.equal(describeTransition(flow, flow.transitions.find((t) => t.after !== undefined && !t.when)!), "after 1.4s");
});

test("interpolation fills known variables and leaves unknown ones", () => {
  assert.equal(interpolate("Invite sent to {email}. {unknown}", { email: "a@b.co" }), "Invite sent to a@b.co. {unknown}");
});

// ── a modal over another frame's page ───────────────────────────────────────

/** A page with a button that opens a confirmation, written with or without `over`. */
function modalFlow(confirm: Record<string, unknown>): Flow {
  const page: FlowNode[] = [
    { type: "heading", level: 1, text: "Dana Whitfield" },
    { type: "button", label: "Remove from team", event: "remove", variant: "danger" },
  ];
  return {
    name: "Remove a member",
    start: "member.default",
    screens: [
      {
        id: "member",
        states: [
          { id: "default", layout: page },
          { id: "confirm", ...confirm } as Flow["screens"][number]["states"][number],
          { id: "gone", end: true, layout: [{ type: "heading", level: 1, text: "Dana was removed" }] },
        ],
      },
    ],
    transitions: [
      { from: "member.default", on: "remove", to: "member.confirm" },
      { from: "member.confirm", on: "close", to: "member.default" },
      { from: "member.confirm", on: "confirm-remove", to: "member.gone" },
    ],
  };
}

const CONFIRM_MODAL: FlowNode = {
  type: "modal",
  title: "Remove Dana from the team?",
  children: [
    { type: "button", label: "Keep Dana", event: "close" },
    { type: "button", label: "Remove from team", event: "confirm-remove", variant: "danger" },
  ],
};

test("a state drawn over another frame borrows that frame's page", () => {
  const flow = modalFlow({ over: "member.default", layout: [CONFIRM_MODAL] });
  const result = validateFlow(flow);
  assert.deepEqual(result.issues.map(formatIssue), []);
  const confirm = flow.screens[0].states[1];
  assert.deepEqual(pageBehind(flow, confirm), flow.screens[0].states[0].layout);
  assert.equal(pageBehind(flow, flow.screens[0].states[0]), undefined);
});

test("over must point at a plain page and leave only a modal in the layout", () => {
  const page: FlowNode = { type: "heading", level: 1, text: "Dana Whitfield" };
  const cases: [string, Record<string, unknown>, string][] = [
    ["a page repeated beside over", { over: "member.default", layout: [page, CONFIRM_MODAL] }, "over-needs-modal"],
    ["no modal at all", { over: "member.default", layout: [page] }, "over-needs-modal"],
    ["a frame that does not exist", { over: "member.nope", layout: [CONFIRM_MODAL] }, "unknown-frame"],
    ["itself", { over: "member.confirm", layout: [CONFIRM_MODAL] }, "bad-over"],
    ["not text", { over: 3, layout: [CONFIRM_MODAL] }, "bad-field"],
  ];
  for (const [what, confirm, code] of cases) {
    const result = validateFlow(modalFlow(confirm));
    assert.equal(result.flow, undefined, `${what} should be rejected`);
    assert.ok(codes(result.issues).includes(code), `${what}: expected ${code}, got ${codes(result.issues).join(", ")}`);
  }

  // A modal state cannot sit over another modal state.
  const chained = modalFlow({ over: "member.default", layout: [CONFIRM_MODAL] });
  chained.screens[0].states.push({ id: "sure", over: "member.confirm", layout: [CONFIRM_MODAL] });
  chained.transitions.push({ from: "member.confirm", on: "confirm-remove", when: "false", to: "member.sure" });
  const result = validateFlow(chained);
  const issue = result.issues.find((i) => i.code === "bad-over");
  assert.ok(issue, codes(result.issues).join(", "));
  assert.match(issue.fix ?? "", /member\.default/);
});

test("copying a page behind a modal is flagged, and over fixes it", () => {
  const page: FlowNode[] = [
    { type: "heading", level: 1, text: "Dana Whitfield" },
    { type: "button", label: "Remove from team", event: "remove", variant: "danger" },
  ];
  const copied = validateFlow(modalFlow({ layout: [...page, CONFIRM_MODAL] }));
  const issue = copied.issues.find((i) => i.code === "repeated-page");
  assert.ok(issue, copied.issues.map(formatIssue).join("\n"));
  assert.equal(issue.frame, "member.confirm");
  assert.match(issue.fix ?? "", /"over": "member\.default"/);
  // Controls on the page behind a modal are out of reach either way, so they are not counted as unhandled.
  assert.ok(!codes(copied.issues).includes("unhandled-event"));
});

test("a frame over a page is marked changed when the page changes", () => {
  const before = modalFlow({ over: "member.default", layout: [CONFIRM_MODAL] });
  const after = structuredClone(before);
  after.screens[0].states[0].layout.push({ type: "text", text: "Admin since March" });
  const diff = diffFlows(before, after);
  assert.deepEqual(diff.changed.sort(), ["member.confirm", "member.default"]);
  assert.deepEqual(diff.added, []);
});

// ── the build brief ─────────────────────────────────────────────────────────

test("the build brief lists every state, transition and open question", () => {
  const files = readdirSync(examplesDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const flow = validateFlow(loadExample(file)).flow!;
    for (const target of TARGET_IDS) {
      const brief = renderBuildBrief(flow, { target, url: "http://localhost:4747/#/f/x" });
      const states = flow.screens.flatMap((s) => s.states.map((st) => `${s.id}.${st.id}`));
      for (const ref of states) assert.ok(brief.includes(`#### ${ref}`), `${file}: brief lists ${ref}`);
      const checks = brief.split("\n").filter((line) => line.startsWith("- [ ] "));
      assert.equal(checks.length, states.length + flow.transitions.length, `${file}: one check per state and per transition`);
      const rows = brief.split("\n").filter((line) => line.startsWith("| ") && line.includes(" is pressed (event: "));
      assert.ok(rows.length > 0, `${file}: transitions are described by the control's label`);
      for (const screen of flow.screens) {
        for (const state of screen.states) for (const question of state.questions ?? []) assert.ok(brief.includes(question), question);
      }
      assert.ok(brief.includes(buildTarget(target)!.name), `${file}: names the target ${target}`);
      // Claude Code warns when one tool result passes 10,000 tokens.
      assert.ok(brief.length < 30000, `${file}: brief is ${brief.length} characters`);
      assert.ok(!brief.includes("undefined"), `${file}: nothing unresolved in the brief`);
    }
  }
});

test("the build brief maps only the components a flow uses", () => {
  const flow = validateFlow(loadExample("sign-in.json")).flow!;
  const brief = renderBuildBrief(flow, { target: "shadcn" });
  const mapping = brief.slice(brief.indexOf("## Building it with"));
  assert.ok(mapping.includes("| input | Label with Input |"));
  assert.ok(!mapping.includes("| table |"), "sign-in has no table");
  assert.ok(!mapping.includes("| modal |"), "sign-in has no modal");
  // An unknown target falls back to the default instead of failing.
  assert.ok(renderBuildBrief(flow, { target: "nope" }).includes(buildTarget(undefined)!.name));
});

test("the build brief explains prototype stand-ins, fallbacks and pages behind modals", () => {
  const flow = validateFlow(loadExample("team-members.json")).flow!;
  const brief = renderBuildBrief(flow);
  assert.match(brief, /- simulateFailure: starts as false; a switch for trying a branch in the prototype/);
  assert.match(brief, /- inviteEmail: starts as ""; entered by the person/);
  assert.match(brief, /- member: starts as ""; set by the flow/);
  assert.ok(brief.includes("| invite.default | “Send invite” is pressed (event: send) | otherwise | invite.invalid |"));
  assert.ok(brief.includes("not (isEmail(inviteEmail))"), "a fallback's check spells out what must be false");
  assert.ok(brief.includes("- over team.default: that page stays visible behind the modal and cannot be used"));
  assert.ok(brief.includes("“Cancel” or “Close” is pressed (event: close)"), "every label that fires an event is named");
  assert.ok(!brief.includes("sets simulateFailure"), "resetting a prototype switch is not product behaviour");

  const one = renderBuildBrief(flow, { screen: "invite" });
  assert.ok(one.includes("#### invite.sending"));
  assert.ok(!one.includes("#### member.default"));
  assert.ok(one.includes("This brief covers one screen of 3"));
});

// ── the drawing kit ─────────────────────────────────────────────────────────

test("the kit draws every component in the design system, and nothing else", () => {
  assert.deepEqual(Object.keys(RENDERERS).sort(), [...COMPONENT_TYPES].sort());
});

test("every frame of every example renders", () => {
  const files = readdirSync(examplesDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const flow = validateFlow(loadExample(file)).flow!;
    for (const screen of flow.screens) {
      for (const state of screen.states) {
        const ref = `${screen.id}.${state.id}`;
        const context = { ...STATIC_CONTEXT, data: dataForFrame(flow, ref), seed: ref };
        const html = renderToStaticMarkup(
          createElement(Device, {
            device: flow.device ?? "desktop",
            seed: ref,
            children: createElement(StateLayout, { layout: state.layout, behind: pageBehind(flow, state), context }),
          }),
        );
        assert.ok(!html.includes("qm-unknown"), `${file} ${ref}: an unknown component was drawn`);
        assert.ok(html.includes("qm-screen"), `${file} ${ref}`);
        if (state.over !== undefined) {
          assert.ok(html.includes("qm-behind") && html.includes("qm-modal-layer"), `${file} ${ref}: modal over its page`);
        }
        // Copy reaches the page with its variables filled in from the frame's preview data.
        assert.ok(!/\{[A-Za-z_][A-Za-z0-9_]*\}/.test(html.replace(/<[^>]+>/g, "")), `${file} ${ref}: an unfilled {variable} was drawn`);
      }
    }
  }
});

test("every component and pattern specimen renders", () => {
  for (const def of COMPONENTS) {
    const context = { ...STATIC_CONTEXT, data: {}, seed: def.type };
    const html = renderToStaticMarkup(createElement(StateLayout, { layout: [def.example], context }));
    assert.ok(html.includes(`qm-${def.type}`), def.type);
  }
  for (const pattern of PATTERNS) {
    const context = { ...STATIC_CONTEXT, data: {}, seed: pattern.id };
    assert.ok(renderToStaticMarkup(createElement(StateLayout, { layout: pattern.example, context })).length > 0, pattern.id);
  }
});

// ── notes the person writes in the viewer ───────────────────────────────────

test("what a client sends is tidied into a note, or refused with a reason", () => {
  assert.deepEqual(readNoteInput({ frame: " team.default ", text: "  Too many buttons  " }), { frame: "team.default", text: "Too many buttons" });
  assert.deepEqual(readNoteInput({ frame: "team.default", text: "x", target: { path: "layout[0]", type: "nav", summary: "", extra: 1 } }), {
    frame: "team.default",
    text: "x",
    target: { path: "layout[0]", type: "nav" },
  });
  assert.deepEqual(readNoteInput({ frame: "team.default", text: "x", target: { path: "layout[0]" } }), { frame: "team.default", text: "x" });
  for (const bad of [undefined, null, "note", {}, { frame: "team.default" }, { frame: "team.default", text: "   " }, { text: "x" }, { frame: "a.b", text: "x".repeat(NOTE_MAX_LENGTH + 1) }]) {
    assert.equal(typeof readNoteInput(bad), "string", JSON.stringify(bad)?.slice(0, 40));
  }
});

test("open notes are written under their frame on the board and listed in the build brief", () => {
  const flow = validateFlow(loadExample("team-members.json")).flow!;
  const notes: ReviewNote[] = [
    { id: "n1", frame: "team.default", text: "Move the seat count up", at: "2026-01-01T00:00:00.000Z" },
    { id: "n2", frame: "team.default", text: "Already handled", at: "2026-01-01T00:00:00.000Z", done: { at: "2026-01-02T00:00:00.000Z", by: "agent", reply: "Done" } },
    { id: "n3", frame: "team.default", text: "Second", at: "2026-01-01T00:00:00.000Z" },
    { id: "n4", frame: "team.default", text: "Third", at: "2026-01-01T00:00:00.000Z" },
    { id: "n5", frame: "team.default", text: "Fourth", at: "2026-01-01T00:00:00.000Z" },
    {
      id: "n6",
      frame: "invite.default",
      text: "Default the role to Viewer",
      at: "2026-01-01T00:00:00.000Z",
      target: { path: "layout[0].children[1]", type: "select", summary: "Role" },
    },
    { id: "n7", frame: "billing.old", text: "On a frame that was removed", at: "2026-01-01T00:00:00.000Z" },
  ];

  const plain = computeBoard(flow);
  const board = computeBoard(flow, notes);
  const frame = (model: typeof board, ref: string) => model.frames.find((f) => f.ref === ref)!;
  assert.deepEqual(frame(board, "team.default").mine, ["Move the seat count up", "Second", "Third"], "done notes are left out");
  assert.equal(frame(board, "team.default").moreMine, 1);
  assert.ok(frame(board, "team.default").h > frame(plain, "team.default").h, "the frame grows to hold its notes");
  assert.deepEqual(frame(board, "team.empty").mine, []);
  assert.equal(frame(board, "team.empty").h, frame(plain, "team.empty").h);

  assert.equal(noteWhere(notes[5]), 'invite.default, the select "Role"');
  assert.deepEqual([...orphanedNotes(flow, notes)], ["n7"]);
  assert.equal(openNotes(notes).length, 6);

  const brief = renderBuildBrief(flow, { notes });
  assert.ok(brief.includes("## Review notes still open"));
  assert.ok(brief.includes('- invite.default, the select "Role": Default the role to Viewer'));
  assert.ok(!brief.includes("Already handled"), "notes that are done stay out of the brief");
  assert.ok(!renderBuildBrief(flow).includes("Review notes"), "no section when there are no notes");
  const one = renderBuildBrief(flow, { notes, screen: "invite" });
  assert.ok(one.includes("Default the role to Viewer") && !one.includes("Move the seat count up"), "a one-screen brief keeps to that screen's notes");
});

// ── sticky notes ────────────────────────────────────────────────────────────

test("sticky positions and edits from a client are tidied or refused", () => {
  const input = readNoteInput({ frame: "a.b", text: "x", sticky: { dx: 12.6, dy: 1e9 }, author: "  A very long name that goes on and on  " });
  assert.ok(typeof input !== "string");
  assert.deepEqual(input.sticky, { dx: 13, dy: 20000 }, "offsets are whole numbers within the board");
  assert.equal(input.author, "A very long name that go");
  assert.equal((readNoteInput({ frame: "a.b", text: "x", sticky: { dx: "1", dy: 2 } }) as { sticky?: unknown }).sticky, undefined);

  assert.deepEqual(readNotePatch({ text: "  New words  " }), { text: "New words" });
  assert.deepEqual(readNotePatch({ frame: "a.b", sticky: { dx: 1, dy: 2 } }), { frame: "a.b", sticky: { dx: 1, dy: 2 } });
  for (const bad of [null, {}, { text: "  " }, { sticky: { dx: 1, dy: 2 } }, { frame: "a.b", sticky: { dx: Number.NaN, dy: 2 } }, { text: "x".repeat(NOTE_MAX_LENGTH + 1) }]) {
    assert.equal(typeof readNotePatch(bad), "string", JSON.stringify(bad)?.slice(0, 40));
  }
});

test("on the board, a sticky note follows the frame it was put beside", () => {
  const flow = validateFlow(loadExample("team-members.json")).flow!;
  const notes: ReviewNote[] = [
    { id: "n1", frame: "team.default", text: "On the frame", at: "2026-01-01T00:00:00.000Z" },
    { id: "n2", frame: "team.default", text: "Beside it", at: "2026-01-01T00:00:00.000Z", sticky: { dx: -230, dy: 20 } },
  ];
  const board = computeBoard(flow, notes);
  const frame = board.frames.find((f) => f.ref === "team.default")!;
  assert.deepEqual(frame.mine, ["On the frame"], "a sticky note is drawn as a sticky, not written under the frame");
  assert.deepEqual(stickyPosition(board, notes[1]), { x: frame.x - 230, y: frame.y + 20 });
  assert.deepEqual(stickyPosition(board, { ...notes[1], frame: "gone.frame" }), { x: -230, y: 20 }, "one whose frame is gone still shows");

  // Dropped over a frame it anchors to that frame; dropped in the open it takes the closest one.
  const over = anchorFor(board, frame.x + 40, frame.y + 60);
  assert.deepEqual(over, { ref: "team.default", dx: 40, dy: 60 });
  const beside = anchorFor(board, frame.x - STICKY_WIDTH - 30, frame.y + 10)!;
  assert.equal(beside.ref, "team.default");
  assert.deepEqual(stickyPosition(board, { ...notes[1], frame: beside.ref, sticky: { dx: beside.dx, dy: beside.dy } }), {
    x: frame.x - STICKY_WIDTH - 30,
    y: frame.y + 10,
  });

  // The same sticky note lands in the same place for someone whose board is laid out differently.
  const taller = computeBoard(flow, [...notes, { id: "n3", frame: "team.loading", text: "Pushes things down", at: "2026-01-01T00:00:00.000Z" }]);
  const shifted = taller.frames.find((f) => f.ref === "team.default")!;
  assert.deepEqual(stickyPosition(taller, notes[1]), { x: shifted.x - 230, y: shifted.y + 20 });

  assert.equal(noteWhere(notes[1]), "a sticky note near team.default");
  assert.equal(noteAuthor({ ...notes[1], author: "Lena", guest: true }), "Lena (guest)");
  assert.equal(noteAuthor({ ...notes[1], guest: true }), "a guest");
  assert.equal(noteAuthor(notes[0]), "");
  assert.deepEqual([initials("Lena Fischer"), initials("dana"), initials("  "), initials("Mary Jane Watson")], ["LF", "DA", "?", "MJ"]);
  assert.ok(renderBuildBrief(flow, { notes: [{ ...notes[1], author: "Lena", guest: true }] }).includes("- a sticky note near team.default (Lena (guest)): Beside it"));
});
