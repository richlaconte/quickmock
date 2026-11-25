import { useSyncExternalStore } from "react";

export type Route =
  | { page: "list" }
  | { page: "flow"; id: string; at?: string }
  | { page: "play"; id: string; at?: string }
  | { page: "brief"; id: string }
  | { page: "system" };

function parse(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  const at = new URLSearchParams(query).get("at") ?? undefined;
  if (parts[0] === "f" && parts[1]) {
    const id = decodeURIComponent(parts[1]);
    if (parts[2] === "play") return { page: "play", id, at };
    if (parts[2] === "brief") return { page: "brief", id };
    return { page: "flow", id, at };
  }
  if (parts[0] === "design-system") return { page: "system" };
  return { page: "list" };
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

let cachedHash = "";
let cachedRoute: Route = { page: "list" };

function snapshot(): Route {
  const hash = window.location.hash;
  if (hash !== cachedHash) {
    cachedHash = hash;
    cachedRoute = parse(hash);
  }
  return cachedRoute;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot);
}

export const links = {
  list: "#/",
  system: "#/design-system",
  flow: (id: string, at?: string): string => `#/f/${encodeURIComponent(id)}${at ? `?at=${encodeURIComponent(at)}` : ""}`,
  play: (id: string, at?: string): string => `#/f/${encodeURIComponent(id)}/play${at ? `?at=${encodeURIComponent(at)}` : ""}`,
  brief: (id: string): string => `#/f/${encodeURIComponent(id)}/brief`,
};
