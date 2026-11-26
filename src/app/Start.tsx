"use client";

// Makes a workspace and goes to it. Also lists the workspaces made in this
// browser, since with no accounts there is nowhere else to find them.

import { useEffect, useState, type ReactElement } from "react";

interface Known {
  id: string;
  at: string;
}

const LIST = "quickmock.workspaces";

function known(): Known[] {
  try {
    const saved = JSON.parse(localStorage.getItem(LIST) ?? "[]") as Known[];
    return Array.isArray(saved) ? saved.filter((w) => typeof w?.id === "string") : [];
  } catch {
    return [];
  }
}

export function Start(): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<Known[]>([]);
  useEffect(() => setMine(known()), []);

  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const body = (await res.json()) as { id?: string; agentKey?: string; error?: string };
      if (!res.ok || !body.id || !body.agentKey) throw new Error(body.error ?? `The server answered ${res.status}.`);
      try {
        // The viewer shows the agent's key from here, for as long as this tab is open.
        sessionStorage.setItem(`quickmock.key.${body.id}`, body.agentKey);
        localStorage.setItem(LIST, JSON.stringify([{ id: body.id, at: new Date().toISOString() }, ...known()].slice(0, 20)));
      } catch {
        // Without storage the workspace still opens; the key can be made again there.
      }
      window.location.assign(`/w/${body.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="landing-start">
      <button type="button" className="bar-button landing-button" disabled={busy} onClick={() => void start()}>
        {busy ? "Making your workspace" : "Start a workspace"}
      </button>
      <span className="quiet">Free while lowfi.design is in preview. It starts with three example flows.</span>
      {error && (
        <p className="note-error" role="alert">
          {error}
        </p>
      )}
      {mine.length > 0 && (
        <div className="landing-mine">
          <h2>Workspaces made in this browser</h2>
          <ul>
            {mine.map((w) => (
              <li key={w.id}>
                <a href={`/w/${w.id}`}>{w.id}</a> <span className="quiet">made {new Date(w.at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
