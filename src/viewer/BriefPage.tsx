// The build brief for a flow: what an agent gets from get_build_brief, shown
// as the same Markdown so it can be read and copied.

import { useEffect, useState, type ReactElement } from "react";

import { TARGETS } from "../design-system/targets";
import { getBrief, useServerEvents } from "./api";
import { links } from "./router";

export function BriefPage({ id }: { id: string }): ReactElement {
  const [target, setTarget] = useState(TARGETS[0].id);
  const [brief, setBrief] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [stamp, setStamp] = useState(0);

  // Reload when an agent changes this flow.
  useServerEvents((event) => {
    // Open notes are part of the brief, so it changes when they do.
    if ((event.type === "flow" && (event.id === undefined || event.id === id)) || (event.type === "notes" && event.id === id)) setStamp((n) => n + 1);
  });

  useEffect(() => {
    let live = true;
    getBrief(id, target).then(
      (text) => {
        if (!live) return;
        setBrief(text);
        setError(null);
      },
      (e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [id, target, stamp]);

  const copy = (): void => {
    if (!brief) return;
    void navigator.clipboard?.writeText(brief).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="page">
      <header className="flowbar">
        <a className="wordmark" href={links.list}>
          lowfi.design
        </a>
        <h1 className="flow-name">Build brief</h1>
        <span className="grow" />
        <a className="bar-link" href={links.flow(id)}>
          Back to the board
        </a>
      </header>
      <main className="brief">
        <aside className="brief-side" aria-label="About this brief">
          <p>
            This is what an agent gets when it is time to build the real thing: every state, the behaviour, a check for each one, and how the sketch's
            components map onto a real component library.
          </p>
          <fieldset className="brief-targets">
            <legend>Build with</legend>
            {TARGETS.map((t) => (
              <label key={t.id}>
                <input type="radio" name="target" value={t.id} checked={target === t.id} onChange={() => setTarget(t.id)} />
                {t.name}
              </label>
            ))}
          </fieldset>
          <button type="button" className="bar-button" onClick={copy} disabled={!brief}>
            {copied ? "Copied" : "Copy brief"}
          </button>
          <p className="quiet">
            An agent connected to lowfi.design can fetch it itself. Ask it to “get the build brief for {id} and build it”.
          </p>
        </aside>
        <div className="brief-body">
          {error && (
            <p className="banner" role="alert">
              {error}
            </p>
          )}
          {brief === null && !error && <p className="quiet">Writing the brief</p>}
          {brief !== null && <pre className="brief-text">{brief}</pre>}
        </div>
      </main>
    </div>
  );
}
