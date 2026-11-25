// The Share button: makes a guest link, so other people can look at the board,
// click through the prototype and leave notes.

import { useCallback, useEffect, useState, type ReactElement } from "react";

import type { ShareStatus } from "../shared/types";
import { getSharing, setSharing, useServerEvents } from "./api";
import { cx } from "./kit/render";

const OFF: ShareStatus = { on: false };

export function CopyRow({ label, value }: { label: string; value: string }): ReactElement {
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
    // A flow event with no id means the connection came back, and sharing may have changed meanwhile.
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

  // The link opens straight on this flow. The part after # stays in the browser; the server never sees it.
  const link = status.link ? `${status.link}#/f/${encodeURIComponent(flowId)}` : "";
  const problem = failed;

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
                Other people open a link in their browser. You see each other's pointers, and they can click through the prototype and leave notes
                and sticky notes.
              </p>
              <p>They see every flow in this workspace. They cannot reach your agent, change a flow, or change your notes.</p>
              <button type="button" className="bar-button" disabled={busy} onClick={() => turn(true)}>
                Start sharing
              </button>
            </>
          ) : (
            <>
              <p>Send this link to the people you want to look:</p>
              <CopyRow label="Link" value={link} />
              <p className="quiet">
                Anyone with the link can get in until you stop. Stopping makes this link useless, and starting again makes a new one.
              </p>
              <button type="button" className="bar-button" disabled={busy} onClick={() => turn(false)}>
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
