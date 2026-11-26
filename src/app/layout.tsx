import "@fontsource/architects-daughter/400.css";
import "@fontsource/reenie-beanie/400.css";
import "@fontsource/barlow-semi-condensed/400.css";
import "@fontsource/barlow-semi-condensed/500.css";
import "@fontsource/barlow-semi-condensed/600.css";
import "../viewer/styles.css";

import type { Metadata, Viewport } from "next";
import type { ReactElement, ReactNode } from "react";

import { cssVariables } from "../design-system/tokens";

export const metadata: Metadata = {
  title: "lowfi.design",
  description:
    "Lo-fi, pen-and-ink flow prototypes, drawn by your agent over MCP. One spec, two views: a board of every screen state and a prototype you can click through.",
  icons: { icon: "data:," },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en">
      <head>
        {/* The tokens are the single source for every colour, size and face in the page. */}
        <style dangerouslySetInnerHTML={{ __html: cssVariables() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
