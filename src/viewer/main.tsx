import "@fontsource/architects-daughter/400.css";
import "@fontsource/reenie-beanie/400.css";
import "@fontsource/barlow-semi-condensed/400.css";
import "@fontsource/barlow-semi-condensed/500.css";
import "@fontsource/barlow-semi-condensed/600.css";
import "./styles.css";

import { createRoot } from "react-dom/client";

import { cssVariables } from "../design-system/tokens";
import { App } from "./App";

// The tokens are the single source for every colour, size and face in the page.
const style = document.createElement("style");
style.textContent = cssVariables();
document.head.append(style);

createRoot(document.getElementById("root")!).render(<App />);
