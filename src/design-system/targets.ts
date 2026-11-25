// Build targets: how each quickmock component maps onto a real component
// library when a flow graduates from sketch to product. The brief itself is
// target-neutral; only this mapping changes.

export interface BuildTarget {
  id: string;
  name: string;
  /** Read by the agent that does the build. */
  intro: string[];
  /** quickmock component type → what to build it with. */
  map: Record<string, { use: string; note?: string }>;
}

const UI_SDK: BuildTarget = {
  id: "ui-sdk",
  name: "UI SDK (ui-sdk.dev)",
  intro: [
    "UI SDK supplies behaviour (keyboard, focus, selection, popups and the ARIA they need) and no styles. Bring the product's own design system for every visual decision.",
    "It is in beta and its APIs can change. Do not write its API from memory: install the skill (npx skills add vercel-labs/ui --skill ui-sdk) or read the Markdown docs shipped inside the installed package (node_modules/@ui-sdk/react/docs).",
    "The names below are the UI SDK components that most closely match each quickmock component. Check each one's current API before using it.",
    "Use its testing kit to check keyboard behaviour, focus and ARIA for each state once it is built.",
  ],
  map: {
    stack: { use: "plain layout", note: "No behaviour needed." },
    row: { use: "plain layout", note: "No behaviour needed." },
    card: { use: "a plain section with a heading" },
    divider: { use: "Separator" },
    modal: { use: "Dialog", note: "Alert Dialog when it confirms something destructive." },
    heading: { use: "plain h1 to h3", note: "Keep one h1 per screen." },
    text: { use: "plain text" },
    link: { use: "Button", note: "Styled as a link; a real anchor when it navigates to a URL." },
    button: { use: "Button" },
    input: {
      use: "Field with Label and Input",
      note: "Password Input for kind password, Number Input for number, Textarea for multiline. Put the error text in the Field.",
    },
    select: { use: "Field with Label and Select" },
    radio: { use: "Radio" },
    checkbox: { use: "Checkbox" },
    list: { use: "Listbox when rows can be pressed", note: "A plain list when they cannot." },
    table: { use: "plain table markup", note: "No table component was listed in UI SDK when this mapping was written." },
    image: { use: "plain img", note: "Avatar for shape circle." },
    badge: { use: "a plain inline element" },
    nav: { use: "Navigation Menu", note: "Tabs for kind tabs; a plain nav landmark for the bottom bar." },
    steps: { use: "an ordered list", note: "No direct counterpart; mark the current step with aria-current=\"step\"." },
    alert: {
      use: "a live region",
      note: "role=\"alert\" for errors, role=\"status\" otherwise. Toast only for messages that go away by themselves.",
    },
    loading: { use: "Progress (indeterminate)", note: "Or a status region with the text." },
    skeleton: { use: "plain placeholder elements", note: "Hide them from assistive technology." },
    empty: { use: "a plain block with a Button" },
  },
};

const SHADCN: BuildTarget = {
  id: "shadcn",
  name: "shadcn/ui",
  intro: [
    "Use the project's existing shadcn/ui components and theme. Add a missing component with the shadcn CLI instead of writing a look-alike.",
    "The names below are the usual counterparts. Component sets differ between versions, so check what the project has installed.",
  ],
  map: {
    stack: { use: "a flex column" },
    row: { use: "a flex row" },
    card: { use: "Card", note: "CardHeader with CardTitle for the title." },
    divider: { use: "Separator" },
    modal: { use: "Dialog", note: "AlertDialog when it confirms something destructive." },
    heading: { use: "plain h1 to h3", note: "Keep one h1 per screen." },
    text: { use: "plain text", note: "text-muted-foreground for the muted tone." },
    link: { use: "Button with variant link" },
    button: {
      use: "Button",
      note: "primary → default, default → outline, danger → destructive, quiet → ghost.",
    },
    input: { use: "Label with Input", note: "Textarea for multiline. Show the error text under the field." },
    select: { use: "Label with Select" },
    radio: { use: "RadioGroup" },
    checkbox: { use: "Checkbox with Label" },
    list: { use: "a plain list", note: "Each pressable row is a button or link." },
    table: { use: "Table" },
    image: { use: "plain img", note: "Avatar for shape circle." },
    badge: { use: "Badge" },
    nav: { use: "NavigationMenu", note: "Tabs for kind tabs, Sidebar for kind side." },
    steps: { use: "an ordered list", note: "No direct counterpart; mark the current step with aria-current=\"step\"." },
    alert: { use: "Alert", note: "variant destructive for errors." },
    loading: { use: "a spinner with the text", note: "Spinner if the project's version has it." },
    skeleton: { use: "Skeleton" },
    empty: { use: "a centred block with a Button", note: "Empty if the project's version has it." },
  },
};

const OWN: BuildTarget = {
  id: "none",
  name: "the product's own design system",
  intro: [
    "Map each quickmock component to the closest component in the product's design system. Where there is none, say so instead of inventing one.",
  ],
  map: {},
};

export const TARGETS: BuildTarget[] = [UI_SDK, SHADCN, OWN];

export const TARGET_IDS = TARGETS.map((t) => t.id);

export function buildTarget(id: string | undefined): BuildTarget | undefined {
  return TARGETS.find((t) => t.id === (id ?? "ui-sdk"));
}
