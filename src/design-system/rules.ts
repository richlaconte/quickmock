// The rules lint checks, in one list. The validator emits these codes; the agent
// reference and the style-guide page describe them from here.

import type { Severity } from "../shared/types";

export interface Rule {
  code: string;
  severity: Severity;
  kind: "flow" | "design";
  summary: string;
}

export const RULES: Rule[] = [
  // Flow: does the thing hang together?
  { code: "dead-end", severity: "warning", kind: "flow", summary: "A state nothing leads out of, unless it is marked \"end\": true." },
  { code: "unreachable", severity: "warning", kind: "flow", summary: "A state nothing leads to." },
  { code: "unhandled-event", severity: "warning", kind: "flow", summary: "A button, link or row fires an event that no transition listens for." },
  { code: "never-fires", severity: "warning", kind: "flow", summary: "A transition waits for an event that nothing in its source state fires." },
  { code: "shadowed", severity: "warning", kind: "flow", summary: "A transition listed after an unguarded one with the same source and trigger." },
  { code: "no-failure-path", severity: "warning", kind: "flow", summary: "A loading state that can only succeed." },
  { code: "loading-never-ends", severity: "warning", kind: "flow", summary: "A loading state with no timed transition out." },
  { code: "timer-no-fallback", severity: "warning", kind: "flow", summary: "Timed transitions that are all guarded, so the prototype can get stuck." },
  { code: "unknown-variable", severity: "warning", kind: "flow", summary: "A guard or a piece of copy reads a variable that is never defined." },
  { code: "guard-no-fallback", severity: "info", kind: "flow", summary: "An event that does nothing when its guard fails." },
  { code: "no-empty-state", severity: "info", kind: "flow", summary: "A screen with a list or table but no empty state." },
  { code: "no-invalid-state", severity: "info", kind: "flow", summary: "A screen that collects input but never shows a validation error." },

  // Design: is each state well made?
  { code: "one-primary", severity: "warning", kind: "design", summary: "More than one primary button in a state." },
  { code: "unlabelled-input", severity: "warning", kind: "design", summary: "An input, select or radio group without a label." },
  { code: "modal-trap", severity: "warning", kind: "design", summary: "A modal with no way out." },
  { code: "placeholder-copy", severity: "warning", kind: "design", summary: "Lorem ipsum or other stand-in copy." },
  { code: "nested-card", severity: "warning", kind: "design", summary: "A card inside a card." },
  { code: "no-title", severity: "info", kind: "design", summary: "A state with no heading." },
  { code: "vague-label", severity: "info", kind: "design", summary: "A label such as Submit or OK that does not say what happens." },
  { code: "long-label", severity: "info", kind: "design", summary: "A button label longer than a few words." },
  { code: "dense", severity: "info", kind: "design", summary: "A state with too much on it." },
  { code: "repeated-page", severity: "info", kind: "design", summary: "A modal state that copies another state's page behind it, where \"over\" would name that state instead." },
];
