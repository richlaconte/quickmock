// Patterns: the compositions that come up in almost every flow, with the states
// each one needs. They are guidance for whoever composes a flow, and they are
// drawn on the style-guide page.

import type { FlowNode } from "../shared/types";

export interface Pattern {
  id: string;
  name: string;
  /** When to reach for it. */
  when: string;
  /** The states it needs, and why. */
  states: string[];
  /** How the states connect. */
  wiring: string[];
  /** One representative state, as a layout. */
  example: FlowNode[];
}

export const PATTERNS: Pattern[] = [
  {
    id: "form",
    name: "Form",
    when: "Collecting input from someone.",
    states: [
      "default: labelled fields and one primary button that names the outcome",
      "invalid: the same form with `error` on each field that is wrong",
      "submitting: a `loading` component in place of the buttons",
      "failed: the form again with an error `alert` that offers Try again",
    ],
    wiring: [
      "submit with a guard that checks the fields → submitting",
      "submit with no guard, listed after it → invalid",
      "submitting → the next screen, or failed (see Async step)",
    ],
    example: [
      { type: "heading", level: 1, text: "Invite a teammate" },
      {
        type: "input",
        bind: "patternEmail",
        label: "Work email",
        kind: "email",
        placeholder: "name@company.com",
        error: "Enter an email address, like name@company.com.",
      },
      { type: "select", bind: "patternRole", label: "Role", options: ["Viewer", "Editor", "Admin", "Billing", "Owner"], placeholder: "Choose a role" },
      {
        type: "row",
        justify: "end",
        children: [
          { type: "button", label: "Cancel", event: "cancel", variant: "quiet" },
          { type: "button", label: "Send invite", event: "send", variant: "primary" },
        ],
      },
    ],
  },
  {
    id: "async-step",
    name: "Async step",
    when: "Anything that waits on a server: saving, paying, sending, loading.",
    states: [
      "submitting (or loading): a `loading` component that says what is happening",
      "failed: an error `alert` that says what went wrong, what did not change, and offers Try again",
      "the success state or the next screen",
    ],
    wiring: [
      "put \"simulateFailure\": false in the flow's data",
      "{from: x.submitting, after: 1200, when: \"simulateFailure\", to: x.failed} first",
      "{from: x.submitting, after: 1200, to: next} second, as the fallback",
      "x.failed, on Try again → x.submitting",
    ],
    example: [
      { type: "heading", level: 1, text: "Cancel your plan" },
      { type: "loading", text: "Cancelling your plan" },
    ],
  },
  {
    id: "collection",
    name: "Collection",
    when: "A list or table of things.",
    states: [
      "loading: a `skeleton` where the items will be",
      "empty: an `empty` component with the first action",
      "default: the `list` or `table` with realistic items",
      "failed: an error `alert` with Try again",
    ],
    wiring: [
      "start on loading, then `after` → default, with a guarded `after` → failed before it",
      "reach empty with a guard on a variable such as hasItems, or leave it as a state people jump to",
    ],
    example: [
      {
        type: "row",
        justify: "between",
        children: [
          { type: "heading", level: 1, text: "Team" },
          { type: "button", label: "Invite someone", event: "invite", variant: "primary" },
        ],
      },
      {
        type: "list",
        items: [
          { title: "Dana Whitfield", subtitle: "dana@northwind.co", meta: "Admin", event: "open-member" },
          { title: "Sam Okafor", subtitle: "sam@northwind.co", meta: "Editor", event: "open-member" },
        ],
      },
    ],
  },
  {
    id: "confirm-destructive",
    name: "Confirm a destructive action",
    when: "Deleting, removing, cancelling: anything that cannot be undone easily.",
    states: [
      "the page, with the `danger` button",
      "confirm: `over` the page, with only a `modal` in its layout that names what will be lost, one way out and one danger button",
    ],
    wiring: [
      "danger button on the page → the confirm state",
      "Cancel in the modal → back to the page",
      "danger button in the modal → the async step that does it",
    ],
    example: [
      { type: "heading", level: 1, text: "Dana Whitfield" },
      { type: "text", text: "Admin since March", tone: "muted" },
      {
        type: "modal",
        title: "Remove Dana from the team?",
        children: [
          { type: "text", text: "Dana will lose access to every project straight away." },
          {
            type: "row",
            justify: "end",
            children: [
              { type: "button", label: "Keep Dana", event: "close" },
              { type: "button", label: "Remove from team", event: "remove", variant: "danger" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "wizard",
    name: "Wizard",
    when: "One task split into a few steps.",
    states: [
      "one screen per step, each starting with the same `steps` component",
      "an invalid state on every step that has a required answer",
    ],
    wiring: [
      "Continue with a guard on the answer → next step; Continue with no guard → this step's invalid state",
      "Back → the previous step, from every state of the screen (from: \"step.*\")",
    ],
    example: [
      { type: "steps", items: ["Reason", "Offer", "Confirm"], current: 1 },
      { type: "heading", level: 1, text: "Why are you leaving?" },
      { type: "radio", bind: "patternReason", label: "Pick the closest reason", options: ["Too expensive", "Missing a feature", "Something else"] },
      {
        type: "row",
        justify: "between",
        children: [
          { type: "button", label: "Keep my plan", event: "keep", variant: "quiet" },
          { type: "button", label: "Continue", event: "continue", variant: "primary" },
        ],
      },
    ],
  },
  {
    id: "app-shell",
    name: "App shell",
    when: "Screens that share the same navigation.",
    states: ["every state of every screen starts with the same `nav`, with the current item `active`"],
    wiring: ["one transition per destination with from: \"*\", so navigation works from any state"],
    example: [
      {
        type: "nav",
        brand: "Northwind",
        items: [
          { label: "Projects", event: "nav-projects" },
          { label: "Team", event: "nav-team", active: true },
          { label: "Billing", event: "nav-billing" },
        ],
      },
      { type: "heading", level: 1, text: "Team" },
      { type: "text", text: "Three people have access to this workspace." },
    ],
  },
];
