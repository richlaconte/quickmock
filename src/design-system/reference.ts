// The design system, written out for an agent. Generated from the registry so
// that what the agent reads is exactly what the validator enforces.

import { FUNCTIONS } from "../shared/expr";
import { COMMON_PROPS, COMPONENTS, GROUPS, componentDef, type ComponentDef, type PropDef } from "./components";
import { PATTERNS } from "./patterns";
import { RULES } from "./rules";
import { materials, principles } from "./tokens";

export function signature(name: string, p: PropDef): string {
  const star = p.required ? "*" : "";
  const t = p.type;
  switch (t.kind) {
    case "text":
      return `${name}${star} (text)`;
    case "name":
      return `${name}${star} (name)`;
    case "number":
      return `${name}${star} (${t.min}-${t.max}${p.default !== undefined ? `, default ${p.default}` : ""})`;
    case "boolean":
      return `${name}${star} (true|false)`;
    case "enum":
      return `${name}${star} (${t.values.join("|")})`;
    case "event":
      return `${name}${star} (event)`;
    case "bind":
    case "var":
      return `${name}${star} (variable)`;
    case "strings":
      return `${name}${star} (list of texts)`;
    case "rows":
      return `${name}${star} (list of rows of texts)`;
    case "set":
      return `${name}${star} ({variable: value})`;
    case "children":
      return `${name}${star} (components)`;
    case "items":
      return `${name}${star} (list of {${Object.entries(t.shape)
        .map(([k, v]) => `${k}${v.required ? "*" : ""}`)
        .join(", ")}})`;
    case "object":
      return `${name}${star} ({${Object.entries(t.shape)
        .map(([k, v]) => `${k}${v.required ? "*" : ""}`)
        .join(", ")}})`;
  }
}

function componentBlock(def: ComponentDef): string {
  const props = Object.entries(def.props).map(([name, p]) => signature(name, p));
  const lines = [`- **${def.type}**: ${def.summary}`, `  props: ${props.length ? props.join(", ") : "none"}`];
  if (def.rules.length) lines.push(`  rules: ${def.rules.join(" ")}`);
  return lines.join("\n");
}

export function renderComponents(): string {
  const out: string[] = [
    `## Components (${COMPONENTS.length})`,
    "",
    "These are the only components. A prop marked * is required. For a choice, the first value is the default.",
    `Every component also accepts: ${Object.entries(COMMON_PROPS)
      .map(([name, p]) => `${signature(name, p)}: ${p.doc}`)
      .join(" ")}`,
    "Any text prop can show a variable with {name}.",
  ];
  for (const group of GROUPS) {
    out.push("", `### ${group}`);
    for (const def of COMPONENTS.filter((c) => c.group === group)) out.push(componentBlock(def));
  }
  return out.join("\n");
}

/** Full detail for one component: every prop explained, plus a valid example. */
export function renderComponentDetail(type: string): string | undefined {
  const def = componentDef(type);
  if (!def) return undefined;
  const describe = (props: Record<string, PropDef>, indent: string): string[] =>
    Object.entries(props).flatMap(([name, p]) => {
      const line = `${indent}- ${signature(name, p)}: ${p.doc}`;
      if (p.type.kind === "items" || p.type.kind === "object") return [line, ...describe(p.type.shape, `${indent}  `)];
      return [line];
    });
  return [
    `# ${def.type}`,
    def.summary,
    "",
    "Props (* required; for a choice, the first value is the default):",
    ...(Object.keys(def.props).length ? describe(def.props, "") : ["- none"]),
    ...describe(COMMON_PROPS, ""),
    ...(def.rules.length ? ["", "Rules:", ...def.rules.map((r) => `- ${r}`)] : []),
    ...(def.topLevelOnly ? ["", "Only directly in a state's layout."] : []),
    "",
    "Example:",
    "```json",
    JSON.stringify(def.example, null, 2),
    "```",
  ].join("\n");
}

export function renderPatterns(): string {
  const out: string[] = ["## Patterns", "", "Reach for these before inventing a structure. Each lists the states it needs."];
  for (const p of PATTERNS) {
    out.push("", `### ${p.name} (${p.id})`, p.when, "States:", ...p.states.map((s) => `- ${s}`), "Wiring:", ...p.wiring.map((w) => `- ${w}`));
  }
  return out.join("\n");
}

export function renderRules(): string {
  const line = (code: string, summary: string): string => `- ${code}: ${summary}`;
  const of = (kind: "flow" | "design", severity: "warning" | "info"): string[] =>
    RULES.filter((r) => r.kind === kind && r.severity === severity).map((r) => line(r.code, r.summary));
  return [
    "## What lint checks",
    "",
    "Errors reject the change: anything outside this design system (unknown component or prop, missing required prop, wrong value) or a reference to a frame that does not exist. Fix them and send it again.",
    "Warnings and info are returned with every create and patch. Fix warnings; weigh info.",
    "",
    "Flow warnings:",
    ...of("flow", "warning"),
    "Flow info:",
    ...of("flow", "info"),
    "Design warnings:",
    ...of("design", "warning"),
    "Design info:",
    ...of("design", "info"),
  ].join("\n");
}

export function renderFormat(): string {
  return `## The flow spec

A flow is one JSON object. Ids are lowercase-with-dashes. A frame is written "screen.state".

\`\`\`json
{
  "name": "Cancel subscription",
  "description": "Optional one-liner.",
  "device": "desktop",
  "start": "account.default",
  "data": { "simulateFailure": false },
  "screens": [
    {
      "id": "reason",
      "title": "Why are you leaving?",
      "states": [
        {
          "id": "default",
          "note": "One line on what this state is for.",
          "questions": ["Should annual plans see a refund amount here?"],
          "layout": [
            { "type": "heading", "level": 1, "text": "Why are you leaving?" },
            { "type": "radio", "bind": "reason", "label": "Pick the closest reason", "options": ["Too expensive", "Something else"] },
            { "type": "button", "label": "Continue", "event": "continue", "variant": "primary" }
          ]
        },
        {
          "id": "invalid",
          "note": "Continue was pressed with nothing picked.",
          "layout": [
            { "type": "heading", "level": 1, "text": "Why are you leaving?" },
            { "type": "alert", "tone": "error", "text": "Pick a reason to continue." },
            { "type": "radio", "bind": "reason", "label": "Pick the closest reason", "options": ["Too expensive", "Something else"] },
            { "type": "button", "label": "Continue", "event": "continue", "variant": "primary" }
          ]
        }
      ]
    }
  ],
  "transitions": [
    { "from": "reason.default", "on": "continue", "when": "reason != ''", "to": "offer" },
    { "from": "reason.default", "on": "continue", "to": "reason.invalid" },
    { "from": "reason.*", "on": "keep", "to": "account.default" },
    { "from": "confirm.submitting", "after": 1200, "when": "simulateFailure", "to": "confirm.failed" },
    { "from": "confirm.submitting", "after": 1200, "to": "done" }
  ]
}
\`\`\`

That excerpt shows the shape; its transitions mention screens it leaves out. For a complete, lint-clean flow, read one of the seeded examples with get_flow (list_flows shows them).

Flow: name*, start*, screens*, transitions*, description, device ("desktop"|"mobile"), data.
Screen: id*, states*, title.
State: id*, layout* (components, top to bottom), note, questions (margin notes), preview (data used when the state is shown directly), end (true marks an intended end of the flow), over (for a modal state: the frame whose page sits behind it).
Transition: from*, to*, and exactly one of on or after; plus when, set, label.

### How it behaves

- Events. A component with an \`event\` fires it when clicked. An input fires "change:<variable>" whenever its bound variable changes. An event with no listening transition does nothing (and lint says so).
- Data. Every \`bind\` is a variable, starting as "" (or false for a checkbox). Put other variables and starting values in the flow's \`data\`. \`set\` writes variables: on a component it runs before transitions are checked, on a transition it runs as it fires.
- from. "screen.state" is one frame, "screen.*" is every state of a screen, "*" is everywhere (use it for navigation).
- to. "screen.state", or just "screen" for its first state.
- Which transition runs. Among those matching the frame and the event, the most specific \`from\` wins (exact, then "screen.*", then "*"); within the same specificity, the first whose \`when\` passes. So list guarded transitions first and the unguarded fallback last.
- after. Milliseconds after entering the frame. Give a loading state one \`after\` per outcome.
- Guards (\`when\`). Comparisons == != < > <= >=, joined with && || !, over variables, 'text', numbers, true and false. Functions: ${Object.values(FUNCTIONS)
    .map((f) => f.doc)
    .join("; ")}.
- over. A modal state names the frame it sits on instead of repeating that page: {"id": "confirm", "over": "member.default", "layout": [{"type": "modal", "title": "Remove Dana?", "children": [...]}]}. The page is drawn behind the modal and cannot be used. Its layout must be exactly one modal, and \`over\` must point at a plain page (no modal, no \`over\` of its own). Change the page once and every modal over it follows.
- A state that looks different is a different state. To show a field only when "Something else" is picked, make a second state that has the field and move between the two on "change:reason".
- preview. The board draws each frame with the starting data plus that state's \`preview\`, so set it wherever a frame should show filled-in values (the picked radio option, the typed email that failed).`;
}

export function renderIntro(): string {
  return [
    "# lowfi.design design system",
    "",
    "lowfi.design turns one flow spec into two views of the same thing: a board with a pen-and-ink frame for every state of every screen, and a working prototype that runs the spec. It is for testing layout, wording and flow before anyone spends time on visual design. The sketch look is deliberate: reviewers should judge structure, not styling.",
    "",
    "## Principles",
    ...principles.map((p, i) => `${i + 1}. ${p}`),
    "",
    "## Materials",
    "You only ever draw in ink. The other materials belong to the tool:",
    ...materials.map((m) => `- ${m.name}: ${m.meaning}`),
  ].join("\n");
}

export type ReferenceSection = "all" | "format" | "components" | "patterns" | "rules";

/** The reference an agent reads before it designs anything. */
export function renderReference(section: ReferenceSection = "all"): string {
  switch (section) {
    case "format":
      return renderFormat();
    case "components":
      return renderComponents();
    case "patterns":
      return renderPatterns();
    case "rules":
      return renderRules();
    case "all":
      return [renderIntro(), renderFormat(), renderComponents(), renderPatterns(), renderRules()].join("\n\n");
  }
}
