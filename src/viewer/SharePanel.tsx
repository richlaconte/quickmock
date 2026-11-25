// The Share button: opens a second, key-protected door so other people can
// look at the board while quickmock runs on this computer.

import { useCallback, useEffect, useState, type ReactElement } from "react";

import type { ShareStatus } from "../shared/types";
import { getSharing, setSharing, useServerEvents } from "./api";
import { cx } from "./kit/render";

const OFF: ShareStatus = { on: false, starting: false, links: [] };

function CopyRow({ label, value }: { label: string; value: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <label className="share-row">
      <span>{label}</span>
      <input readOnly value={value} onFocus={(e) => e.target.select()} />
      <button type="button" className="bar-button" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </label>
  );
}

export function ShareButton({ flowId }: { flowId: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ShareStatus>(OFF);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getSharing().then(setStatus, () => undefined);
  }, []);
  useEffect(refresh, [refresh]);
  useServerEvents((event) => {
    // A flow event with no id means the connection came back, and the server may have restarted with sharing off.
    if (event.type === "share" || (event.type === "flow" && !event.id)) refresh();
  });

  const turn = (on: boolean): void => {
    setBusy(true);
    setFailed(null);
    setSharing(on).then(
      (next) => {
        setStatus(next);
        setBusy(false);
      },
      (e: unknown) => {
        setFailed(e instanceof Error ? e.message : String(e));
        setBusy(false);
      },
    );
  };

  // Links open straight on this flow. The part after # stays in the browser; the server never sees it.
  const here = (url: string): string => `${url}#/f/${encodeURIComponent(flowId)}`;
  const network = status.links.filter((link) => link.label !== "This computer");
  const local = status.links.find((link) => link.label === "This computer");
  const starting = busy || status.starting;
  const problem = failed ?? status.error;

  return (
    <div className="share">
      <button type="button" className={cx("bar-button", status.on && "is-on")} aria-expanded={open} onClick={() => setOpen(!open)}>
        {status.on ? "Sharing" : "Share"}
      </button>
      {open && (
        <div className="share-panel" role="dialog" aria-label="Share this board">
          <h2>Share this board</h2>
          {!status.on ? (
            <>
              <p>
                Other people open a link in their browser while quickmock runs on this computer. You see each other's pointers, and they can click
                through the prototype and leave notes and sticky notes.
              </p>
              <p>They cannot reach your agent, change a flow, or see anything else on this computer.</p>
              <button type="button" className="bar-button" disabled={starting} onClick={() => turn(true)}>
                {starting ? "Getting the shared copy ready" : "Start sharing"}
              </button>
              {starting && <p className="quiet">This takes a few seconds the first time.</p>}
            </>
          ) : (
            <>
              {network.length > 0 ? (
                <>
                  <p>For people on the same network as this computer:</p>
                  {network.map((link) => (
                    <CopyRow key={link.url} label="Link" value={here(link.url)} />
                  ))}
                </>
              ) : (
                <p>This computer is not on a network other people can reach, so there is no link for them yet.</p>
              )}
              {local && (
                <>
                  <p>
                    For someone elsewhere, run a tunnel to port {status.port} (for example <code>cloudflared tunnel --url http://localhost:{status.port}</code>
                    ) and add this to the address it gives you:
                  </p>
                  <CopyRow label="Add" value={here(`/?key=${status.key ?? ""}`)} />
                </>
              )}
              <p className="quiet">
                Anyone with a link can get in until you stop. Stopping makes these links useless, and starting again makes new ones. If macOS asks
                whether to allow incoming connections, allow it.
              </p>
              <button type="button" className="bar-button" disabled={starting} onClick={() => turn(false)}>
                Stop sharing
              </button>
            </>
          )}
          {problem && (
            <p className="note-error" role="alert">
              {problem}
            </p>
          )}
          <button type="button" className="text-button share-close" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}
