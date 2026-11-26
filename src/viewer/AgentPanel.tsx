// The agent: whether one is connected, and the command that connects one. The
// same block sits on the front page and behind the Agent button on a flow.

import { useCallback, useEffect, useState, type ReactElement } from "react";

import type { AgentStatus } from "../shared/types";
import { getAgentStatus, newAgentKey, rememberedAgentKey, useServerEvents } from "./api";
import { cx } from "./kit/render";

/** An agent that called this recently is taken to be at work. */
const ACTIVE_MS = 5 * 60 * 1000;

function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `on ${new Date(iso).toLocaleDateString()}`;
}

/** When the agent was last heard from, kept fresh while the page is open. */
export function useAgentStatus(enabled = true): { status: AgentStatus | null; active: boolean; now: number } {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(() => {
    // Only the owner is told about the agent, so a guest's page does not ask.
    if (!enabled) return;
    getAgentStatus().then((next) => {
      setStatus(next);
      setNow(Date.now());
    }, () => undefined);
  }, [enabled]);
  useEffect(() => {
    refresh();
    // The server only says when an agent starts up; this is what notices it going quiet.
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  useServerEvents((event) => {
    // A flow event means the agent just changed something, or the connection came back.
    if (event.type === "agent" || event.type === "flow") refresh();
  });

  const active = Boolean(status?.lastSeen && now - new Date(status.lastSeen).getTime() < ACTIVE_MS);
  return { status, active, now };
}

export function AgentStatusLine({ status, active, now }: ReturnType<typeof useAgentStatus>): ReactElement {
  let text = "Checking for your agent";
  if (status) {
    if (!status.lastSeen) text = "No agent has connected lately.";
    else if (active) text = `Your agent is connected. It last called ${ago(status.lastSeen, now)}.`;
    else text = `No agent is at work. One last called ${ago(status.lastSeen, now)}.`;
  }
  return (
    <p className={cx("agent-status", active && "is-on")} role="status">
      <span className="agent-dot" aria-hidden="true" />
      {text}
    </p>
  );
}

/** The command that adds this workspace to an agent, or the button that makes a key for it. */
export function ConnectCommand(): ReactElement {
  const [agentKey, setAgentKey] = useState(rememberedAgentKey);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const makeKey = (): void => {
    setKeyError(null);
    newAgentKey().then(setAgentKey, (e: unknown) => setKeyError(e instanceof Error ? e.message : String(e)));
  };

  const command = `claude mcp add --transport http lowfi ${window.location.origin}/mcp --header "Authorization: Bearer ${agentKey ?? "qm_..."}"`;
  const copy = (): void => {
    void navigator.clipboard?.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <>
      {agentKey ? (
        <>
          <p>Run this once in a terminal. It adds this workspace to Claude Code for the project you are in.</p>
          <pre className="command">
            <code>{command}</code>
          </pre>
          <button type="button" className="bar-button" onClick={copy}>
            {copied ? "Copied" : "Copy command"}
          </button>
          <p className="quiet">The key in it is shown only in this tab. Anyone who has it can change the flows here, so treat it like a password.</p>
        </>
      ) : (
        <>
          <p>An agent gets in with this workspace's key. It is shown once, when it is made, so there is none to show you now.</p>
          <button type="button" className="bar-button" onClick={makeKey}>
            Make a new key
          </button>
          <p className="quiet">The key in use until now stops working, so an agent that is already connected has to be added again.</p>
        </>
      )}
      {keyError && (
        <p className="note-error" role="alert">
          {keyError}
        </p>
      )}
    </>
  );
}

/** The Agent button in a flow's bar. Owner only. */
export function AgentButton(): ReactElement {
  const [open, setOpen] = useState(false);
  const agent = useAgentStatus();

  return (
    <div className="share">
      <button
        type="button"
        className={cx("bar-button agent-button", agent.active && "is-live")}
        aria-expanded={open}
        title={agent.active ? "Your agent is connected" : "No agent is at work"}
        onClick={() => setOpen(!open)}
      >
        <span className="agent-dot" aria-hidden="true" />
        Agent
      </button>
      {open && (
        <div className="share-panel agent-panel" role="dialog" aria-label="Your agent">
          <h2>Your agent</h2>
          <AgentStatusLine {...agent} />
          <ConnectCommand />
          <p>Then ask for a change in plain words. Click a frame, say “this”, and the agent knows which one you mean.</p>
          <button type="button" className="text-button share-close" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
