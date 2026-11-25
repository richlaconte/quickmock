// Who is here: a badge for everyone else looking at this flow, and this
// device's own name, which the person can change.

import { useState, type ReactElement } from "react";

import { initials } from "./BoardLive";
import { setMyName, usePresence } from "./live";

function NameChip({ name, color, fallback }: { name: string; color?: string; fallback: string }): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  if (editing) {
    const save = (): void => {
      setMyName(draft);
      setEditing(false);
    };
    return (
      <form
        className="me-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          autoFocus
          value={draft}
          maxLength={24}
          placeholder="Your name"
          aria-label="Your name, as other people see it"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
        />
      </form>
    );
  }
  return (
    <button
      type="button"
      className="me"
      title="The name other people see on your pointer and your notes. Click to change it."
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
    >
      <span className="person" style={{ background: color }} aria-hidden="true">
        {initials(name || fallback)}
      </span>
      {name || "Add your name"}
    </button>
  );
}

/** Badges for the other people on a flow (or anywhere, when no flow is given), then this device's own name. */
export function PeopleBar({ flowId, onGoTo }: { flowId?: string; onGoTo?: (frame: string) => void }): ReactElement {
  const { me, others, name } = usePresence();
  const here = flowId ? others.filter((person) => person.flowId === flowId) : others;
  return (
    <div className="people" role="group" aria-label="People here">
      {here.map((person) => (
        <button
          key={person.pid}
          type="button"
          className="person"
          style={{ background: person.color }}
          title={person.frame && onGoTo ? `${person.name} is on ${person.frame}. Click to go there.` : person.name}
          aria-label={person.frame ? `${person.name}, on ${person.frame}` : person.name}
          onClick={() => {
            if (person.frame) onGoTo?.(person.frame);
          }}
        >
          {initials(person.name)}
        </button>
      ))}
      <NameChip name={name} color={me?.color} fallback={me?.name ?? "You"} />
    </div>
  );
}
