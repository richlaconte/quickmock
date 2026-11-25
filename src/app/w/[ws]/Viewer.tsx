"use client";

import dynamic from "next/dynamic";
import type { ReactElement } from "react";

// The viewer reads the address bar and browser storage as it loads, so it only ever runs in the browser.
const App = dynamic(() => import("../../../viewer/App").then((m) => m.App), { ssr: false });

export function Viewer(): ReactElement {
  return (
    <div id="root">
      <App />
    </div>
  );
}
