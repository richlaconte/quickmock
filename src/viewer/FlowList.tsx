// The front page: every flow in the workspace, and how to connect an agent.

import { useCallback, useEffect, useState, type ReactElement } from "react";

import type { FlowSummary } from "../shared/types";
import { getFlows, useServerEvents } from "./api";
import { usePresence } from "./live";
import { PeopleBar } from "./People";
import { links } from "./router";

function when(iso: string): string {
  if (!iso) return "";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function FlowList(): ReactElement {
  const [flows, setFlows] = useState<FlowSummary[] | null>(null);
  const [baseUrl, setBaseUrl] = useState(window.location.origin);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    getFlows().then(
      (result) => {
        setFlows(result.flows);
        if (result.baseUrl) setBaseUrl(result.baseUrl);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);
  useEffect(load, [load]);
  useServerEvents((event) => {
    if (event.type === "list" || event.type === "flow") load();
  });
  const { role } = usePresence();

  const command = `claude mcp add --transport http quickmock ${baseUrl}/mcp`;
  const copy = (): void => {
    void navigator.clipboard?.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="page">
      <header className="flowbar">
        <a className="wordmark" href={links.list}>
          quickmock
        </a>
        <span className="grow" />
        <PeopleBar />
        <a className="bar-link" href={links.system}>
          Design system
        </a>
      </header>
      <main className="home">
        <section className="home-flows" aria-labelledby="flows-heading">
          <h1 id="flows-heading">Flows</h1>
          {error && <p className="banner">{error}</p>}
          {flows && flows.length === 0 && (
            <p className="quiet">No flows yet. Connect an agent and ask it to sketch one, and it will appear here as it is drawn.</p>
          )}
          <ul className="flow-list">
            {(flows ?? []).map((flow) => (
              <li key={flow.id}>
                {flow.diskError ? (
                  <div className="flow-row is-broken">
                    <span className="flow-title">{flow.id}</span>
                    <span className="flow-desc">{flow.diskError}</span>
                  </div>
                ) : (
                  <a className="flow-row" href={links.flow(flow.id)}>
                    <span className="flow-title">{flow.name}</span>
                    {flow.description && <span className="flow-desc">{flow.description}</span>}
                    <span className="flow-facts">
                      <span>{flow.device}</span>
                      <span>
                        {flow.screens} screens, {flow.states} states
                      </span>
                      <span>revision {flow.rev}</span>
                      <span>{flow.warnings === 0 ? "lint clean" : `${flow.warnings} to fix`}</span>
                      <span>{when(flow.updatedAt)}</span>
                    </span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
        {role === "guest" ? (
          <aside className="home-connect" aria-labelledby="guest-heading">
            <h2 id="guest-heading">You are a guest here</h2>
            <p>Someone shared these sketches with you. Open one to see every screen laid out and to click through it as a prototype.</p>
            <p>Leave a note on any frame, or double-click the board for a sticky note. Everyone looking sees them, and so does the agent that draws the flow.</p>
            <p>The sketchy look is on purpose: it is the layout, the words and the flow that are up for discussion, not the styling.</p>
          </aside>
        ) : (
          <aside className="home-connect" aria-labelledby="connect-heading">
            <h2 id="connect-heading">Connect an agent</h2>
            <p>Run this once in a terminal. It adds quickmock to Claude Code for the project you are in.</p>
            <pre className="command">
              <code>{command}</code>
            </pre>
            <button type="button" className="bar-button" onClick={copy}>
              {copied ? "Copied" : "Copy command"}
            </button>
            <p>Then ask for a flow in plain words:</p>
            <p className="ask">Use quickmock to sketch a password reset flow for a mobile app, with the unhappy paths.</p>
            <p>The board fills in here while the agent works. Click a frame, say “this”, and the agent knows which one you mean.</p>
          </aside>
        )}
      </main>
    </div>
  );
}
