import { defineConfig } from "vite";

// Sur GitHub Pages le site est servi sous /<nom-du-dépôt>/ : le workflow passe BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  build: { chunkSizeWarningLimit: 1500 },
});
