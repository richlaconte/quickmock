// The flow a person makes from the viewer with no agent: one screen, one
// state, and a line saying what to do next. A flow cannot be emptier than
// this, since every state has to draw something.

import type { Flow } from "./types";

export const BLANK_FLOW: Flow = {
  name: "Untitled flow",
  description: "A blank flow. Ask your agent to sketch it, and the board fills in here.",
  start: "start",
  screens: [
    {
      id: "start",
      title: "Start",
      states: [
        {
          id: "default",
          note: "Nothing is drawn yet.",
          end: true,
          layout: [
            { type: "heading", level: 1, text: "Untitled flow" },
            { type: "empty", title: "Nothing here yet", text: "Ask your agent to sketch this flow." },
          ],
        },
      ],
    },
  ],
  transitions: [],
};
