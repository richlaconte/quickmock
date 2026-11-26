// The front door: what lowfi.design is, and the one button that makes a workspace.

import type { ReactElement } from "react";

import { Start } from "./Start";

export default function Landing(): ReactElement {
  return (
    <div className="landing">
      <header className="flowbar">
        <span className="wordmark">lowfi.design</span>
      </header>
      <main className="landing-main">
        <h1>Sketch the whole flow before anyone builds it.</h1>
        <p className="landing-lede">
          Describe a flow to your coding agent. It writes one spec, and lowfi.design draws it twice: a board with a frame for every state of every
          screen, and a prototype you can click through. All in pen and ink, so people react to the layout, the words and the behaviour instead of
          the styling.
        </p>
        <Start />
        <ol className="landing-steps">
          <li>
            <h2>Start a workspace</h2>
            <p>No account. You get a private link that makes the workspace yours, and a key for your agent.</p>
          </li>
          <li>
            <h2>Connect your agent</h2>
            <p>One command adds lowfi.design to Claude Code, or any agent that speaks MCP. Then ask for a flow in plain words.</p>
          </li>
          <li>
            <h2>Review it together</h2>
            <p>Share a link. Everyone sees each other's pointers and leaves notes on the board; the agent works through them.</p>
          </li>
          <li>
            <h2>Build from the brief</h2>
            <p>When the flow is agreed, lowfi.design turns it into a build spec: every state, the transitions and an acceptance check for each.</p>
          </li>
        </ol>
      </main>
    </div>
  );
}
