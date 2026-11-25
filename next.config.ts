import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // The viewer is one client app with module-level state (one event stream per page).
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      // Workspaces are private to whoever has a link.
      { source: "/w/(.*)", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
};

export default config;
