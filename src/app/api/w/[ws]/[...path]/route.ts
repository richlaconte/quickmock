import type { NextRequest } from "next/server";

import { handleApi } from "../../../../../server/api";

// The event stream is the long one: it ends itself a little before this and the page reconnects.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ ws: string; path: string[] }> };

async function handler(request: NextRequest, context: Context): Promise<Response> {
  const { ws, path } = await context.params;
  try {
    return await handleApi(request, ws, path);
  } catch (error) {
    console.error("API request failed:", error);
    return Response.json({ error: "Something went wrong on the server." }, { status: 500 });
  }
}

export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
