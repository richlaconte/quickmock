// The flows opened lately in this browser. With no accounts there is nowhere
// else to keep them, so they live in localStorage and the landing page lists
// them. Nothing here reads the address bar: the landing page uses it too.

export interface RecentFlow {
  ws: string;
  id: string;
  name: string;
  at: string;
}

const KEY = "quickmock.recent";
const MOST = 8;

export function recentFlows(): RecentFlow[] {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]") as RecentFlow[];
    if (!Array.isArray(saved)) return [];
    return saved.filter((f) => typeof f?.ws === "string" && typeof f.id === "string" && typeof f.name === "string" && typeof f.at === "string");
  } catch {
    return [];
  }
}

/** Put a flow at the top of the list, or move it there. */
export function rememberFlow(ws: string, id: string, name: string): void {
  if (!ws || !id) return;
  try {
    const rest = recentFlows().filter((f) => !(f.ws === ws && f.id === id));
    localStorage.setItem(KEY, JSON.stringify([{ ws, id, name, at: new Date().toISOString() }, ...rest].slice(0, MOST)));
  } catch {
    // Without storage there is simply no list.
  }
}

/** Take one flow off the list, and return what is left. */
export function forgetFlow(ws: string, id: string): RecentFlow[] {
  const rest = recentFlows().filter((f) => !(f.ws === ws && f.id === id));
  try {
    localStorage.setItem(KEY, JSON.stringify(rest));
  } catch {
    // Nothing was stored in the first place.
  }
  return rest;
}

/**
 * The recent flows this browser can still open. Each workspace is asked for its
 * flows: one that turns the browser away, or no longer has the flow, drops off
 * the list for good. A workspace that cannot be reached right now keeps its
 * flows, since that says nothing about whether they are still there.
 */
export async function openableRecentFlows(): Promise<RecentFlow[]> {
  const saved = recentFlows();
  const answers = new Map<string, Map<string, string> | "gone" | "unknown">();
  await Promise.all(
    [...new Set(saved.map((f) => f.ws))].map(async (ws) => {
      try {
        const res = await fetch(`/api/w/${encodeURIComponent(ws)}/flows`, { cache: "no-store" });
        if (res.status === 401 || res.status === 404) return void answers.set(ws, "gone");
        if (!res.ok) return void answers.set(ws, "unknown");
        const body = (await res.json()) as { flows: { id: string; name: string }[] };
        answers.set(ws, new Map(body.flows.map((f) => [f.id, f.name])));
      } catch {
        answers.set(ws, "unknown");
      }
    }),
  );
  const kept: RecentFlow[] = [];
  for (const flow of saved) {
    const answer = answers.get(flow.ws) ?? "unknown";
    if (answer === "gone") continue;
    if (answer === "unknown") kept.push(flow);
    // The name may have changed since it was opened here.
    else if (answer.has(flow.id)) kept.push({ ...flow, name: answer.get(flow.id) ?? flow.name });
  }
  if (kept.length !== saved.length || kept.some((f, i) => f.name !== saved[i].name)) {
    try {
      localStorage.setItem(KEY, JSON.stringify(kept));
    } catch {
      // The list on screen is still right.
    }
  }
  return kept;
}

export function recentLink(flow: RecentFlow): string {
  return `/w/${flow.ws}#/f/${encodeURIComponent(flow.id)}`;
}
