// A workspace. The viewer is one client app: board, prototype, notes, style
// guide. It is only sent to someone who came in by the owner link or a guest link.

import { cookies } from "next/headers";
import type { ReactElement } from "react";

import { roleOf } from "../../../server/workspaces";
import { Viewer } from "./Viewer";

export default async function WorkspacePage({ params }: { params: Promise<{ ws: string }> }): Promise<ReactElement> {
  const { ws } = await params;
  const jar = await cookies();
  const role = await roleOf(ws, (name) => jar.get(name)?.value, true);
  if (!role) {
    return (
      <main className="locked">
        <h1>This workspace is opened by link</h1>
        <p>
          Open the full link you were sent, including the part after the question mark. If it has stopped working, sharing was turned off or
          restarted: ask for a new link.
        </p>
        <p>
          <a href="/">About lowfi.design</a>
        </p>
      </main>
    );
  }
  return <Viewer />;
}
