// Design tokens for the pen-and-ink system.
// Every value the kit and the viewer draw with comes from here.

export const tokens = {
  color: {
    paper: "#FBFCFD",
    ink: "#1D2740",
    graphite: "#6F7684",
    red: "#C2253D",
    blue: "#3F9BCB",
    blueWash: "#CFE6F3",
    highlight: "#FFE95C",
    sticky: "#FFF4AE",
  },
  /**
   * Coloured pencils, one per person looking at the board. None is red, blue
   * or yellow: those already mean something.
   */
  people: ["#2E8B57", "#8A4FD0", "#D2691E", "#D0409A", "#0E8C8C", "#7A6A1F", "#8C5A3C", "#6B3A7A"],
  /** Stroke widths in px, named like fineliner sizes. */
  pen: { fine: 1.1, regular: 1.6, bold: 2.4 },
  /** How much lines wobble. Tight for controls, loose for containers and arrows. */
  rough: { tight: 0.8, loose: 1.4 },
  font: {
    hand: `"Architects Daughter", "Comic Sans MS", cursive`,
    scrawl: `"Reenie Beanie", "Architects Daughter", cursive`,
    print: `"Barlow Semi Condensed", "Arial Narrow", system-ui, sans-serif`,
  },
  /** Type sizes in px. */
  type: { h1: 28, h2: 23, h3: 19, body: 16, small: 13 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  control: { height: 40 },
  device: {
    desktop: { width: 880, height: 600, boardScale: 0.38 },
    mobile: { width: 380, height: 720, boardScale: 0.5 },
  },
} as const;

export type PenName = keyof typeof tokens.pen;
export type RoughName = keyof typeof tokens.rough;
export type InkColor = "ink" | "graphite" | "red" | "blue" | "paper" | "highlight" | "sticky";

/** The materials everything is drawn in. Each one means exactly one thing. */
export const materials = [
  {
    token: "ink",
    name: "Ink",
    meaning: "The design. Every component is drawn in ink; there is no other colour to choose.",
  },
  {
    token: "graphite",
    name: "Pencil",
    meaning: "Secondary: hints, placeholders, disabled controls and skeletons.",
  },
  {
    token: "red",
    name: "Red pencil",
    meaning: "Critique: the notes people write, open questions, lint findings and error messages.",
  },
  {
    token: "blue",
    name: "Non-photo blue",
    meaning: "Construction: guides, selection and where the prototype is now. Never part of the design.",
  },
  {
    token: "highlight",
    name: "Highlighter",
    meaning: "What changed in the last revision.",
  },
  {
    token: "sticky",
    name: "Sticky notes",
    meaning: "Thoughts that are not tied to one frame. Anyone looking at the board can stick one anywhere.",
  },
  {
    token: "people",
    name: "Coloured pencils",
    meaning: "Other people. Everyone looking at the board gets a pencil colour for their cursor and their place in the flow.",
  },
] as const;

export const principles = [
  "Ink is the design. Everything you specify is drawn in one ink. There are no colour, font, size or spacing props, so do not try to style.",
  "States, not hidden conditionals. Anything that looks different is its own state (default, empty, loading, invalid, failed), so it gets its own frame on the board.",
  "Real words. Labels and messages are what gets tested, so write the real ones. A button says what happens: \"Cancel plan\", not \"Submit\".",
  "Draw the unhappy paths. Every async step has a failure branch, every list has an empty state, every form has an invalid state.",
  "Ask in the margin. When you assume something nobody told you, add it to that state's `questions` instead of deciding silently.",
] as const;

/** CSS custom properties for the tokens, injected once by the viewer. */
export function cssVariables(): string {
  const c = tokens.color;
  const lines = [
    `--qm-paper:${c.paper}`,
    `--qm-ink:${c.ink}`,
    `--qm-graphite:${c.graphite}`,
    `--qm-red:${c.red}`,
    `--qm-blue:${c.blue}`,
    `--qm-blue-wash:${c.blueWash}`,
    `--qm-highlight:${c.highlight}`,
    `--qm-sticky:${c.sticky}`,
    `--qm-font-hand:${tokens.font.hand}`,
    `--qm-font-scrawl:${tokens.font.scrawl}`,
    `--qm-font-print:${tokens.font.print}`,
    `--qm-h1:${tokens.type.h1}px`,
    `--qm-h2:${tokens.type.h2}px`,
    `--qm-h3:${tokens.type.h3}px`,
    `--qm-body:${tokens.type.body}px`,
    `--qm-small:${tokens.type.small}px`,
    `--qm-xs:${tokens.space.xs}px`,
    `--qm-sm:${tokens.space.sm}px`,
    `--qm-md:${tokens.space.md}px`,
    `--qm-lg:${tokens.space.lg}px`,
    `--qm-xl:${tokens.space.xl}px`,
    `--qm-xxl:${tokens.space.xxl}px`,
    `--qm-control:${tokens.control.height}px`,
  ];
  return `:root{${lines.join(";")}}`;
}
