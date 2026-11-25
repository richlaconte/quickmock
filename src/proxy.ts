// The links that open a workspace carry a secret: ?owner=... for the person who
// made it, ?key=... for a guest. Move it into a cookie and send the browser on
// without it, so it does not sit in the address bar or the history. Whether the
// secret is any good is decided later, by the page and the API.

import { NextResponse, type NextRequest } from "next/server";

const SECRET = /^[A-Za-z0-9_-]{16,64}$/;

export function proxy(request: NextRequest): NextResponse {
  const url = request.nextUrl;
  const ws = /^\/w\/([a-z0-9]{12})\/?$/.exec(url.pathname)?.[1];
  const owner = url.searchParams.get("owner");
  const guest = url.searchParams.get("key");
  if (!ws || (!owner && !guest)) return NextResponse.next();

  // The part of the link after # never reaches the server, and the browser carries it over.
  const response = NextResponse.redirect(new URL(`/w/${ws}`, url), 302);
  const options = { path: "/", httpOnly: true, sameSite: "lax" as const, secure: url.protocol === "https:" };
  if (owner && SECRET.test(owner)) response.cookies.set(`qm_o_${ws}`, owner, { ...options, maxAge: 31536000 });
  if (guest && SECRET.test(guest)) response.cookies.set(`qm_g_${ws}`, guest, options);
  return response;
}

export const config = { matcher: "/w/:ws" };
