// Make a workspace. There are no accounts, so this is all it takes; the answer
// carries the two secrets that are never shown again unless the owner asks.

import type { NextRequest } from "next/server";

import { backend } from "../../../server/backend";
import { WORKSPACES_PER_HOUR } from "../../../server/limits";
import { createWorkspace, ownerCookie } from "../../../server/workspaces";

export async function POST(request: NextRequest): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return Response.json({ error: "Send an empty JSON object." }, { status: 400 });
  }
  const address = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const made = await backend().count(`qm:made:${address}`, 60 * 60);
  if (made > WORKSPACES_PER_HOUR) {
    return Response.json({ error: "That is a lot of new workspaces. Try again in an hour, or keep using one you have." }, { status: 429 });
  }

  const workspace = await createWorkspace();
  const origin = request.nextUrl.origin;
  const secure = request.nextUrl.protocol === "https:" ? "; Secure" : "";
  return Response.json(
    {
      id: workspace.id,
      url: `${origin}/w/${workspace.id}`,
      ownerLink: `${origin}/w/${workspace.id}?owner=${workspace.ownerToken}`,
      agentKey: workspace.agentKey,
    },
    {
      status: 201,
      headers: {
        "Set-Cookie": `${ownerCookie(workspace.id)}=${workspace.ownerToken}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`,
        "Cache-Control": "no-store",
      },
    },
  );
}
