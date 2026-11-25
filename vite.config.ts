// Used twice: by the server, which runs Vite as middleware for the owner's
// viewer, and by `vite build`, which makes the plain files guests are served
// when the board is shared.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: { outDir: "dist", emptyOutDir: true },
});
