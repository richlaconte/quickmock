// The front page: every flow in the workspace, and how to connect an agent.

import { useCallback, useEffect, useState, type ReactElement } from "react";

import type { FlowSummary } from "../shared/types";
import { AgentStatusLine, ConnectCommand, useAgentStatus } from "./AgentPanel";
import { getFlows, getSession, newBlankFlow, useServerEvents, type Session } from "./api";
import { usePresence } from "./live";
import { PeopleBar } from "./People";
import { links } from "./router";
import { CopyRow } from "./SharePanel";

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
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState(false);

  const load = useCallback(() => {
    getFlows().then(
      (result) => {
        setFlows(result.flows);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);
  useEffect(load, [load]);
  useServerEvents((event) => {
    if (event.type === "list" || event.type === "flow") load();
  });
  useEffect(() => {
    getSession().then(setSession, () => undefined);
  }, []);
  const presence = usePresence();
  const role = session?.role ?? presence.role;
  const agent = useAgentStatus(role === "owner");

  const makeBlank = (): void => {
    setMaking(true);
    setError(null);
    newBlankFlow().then(
      (flow) => {
        window.location.hash = links.flow(flow.id);
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setMaking(false);
      },
    );
  };

  return (
    <div className="page">
      <header className="flowbar">
        <a className="wordmark" href={links.list}>
          lowfi.design
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
            {role === "owner" && (
              <li>
                <button type="button" className="flow-row flow-new" disabled={making} onClick={makeBlank}>
                  <span className="flow-title">{making ? "Making a blank flow" : "Blank flow"}</span>
                  <span className="flow-desc">Start an empty flow, then ask your agent to sketch it.</span>
                </button>
              </li>
            )}
            {(flows ?? []).map((flow) => (
              <li key={flow.id}>
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
            <AgentStatusLine {...agent} />
            <ConnectCommand />
            <p>Then ask for a flow in plain words:</p>
            <p className="ask">Use lowfi.design to sketch a password reset flow for a mobile app, with the unhappy paths.</p>
            <p>The board fills in here while the agent works. Click a frame, say “this”, and the agent knows which one you mean.</p>
            {session?.ownerLink && (
              <>
                <h2>Your way back in</h2>
                <p>
                  There are no accounts. This link is what makes the workspace yours: this browser remembers it, and it is how you open the workspace
                  anywhere else. Keep it somewhere safe and do not share it.
                </p>
                <CopyRow label="Link" value={session.ownerLink} />
              </>
            )}
          </aside>
        )}
      </main>
    </div>
  );
}
