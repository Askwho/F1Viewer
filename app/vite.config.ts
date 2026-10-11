import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const relay = process.env.RELAY || "http://localhost:8787";

export default defineConfig({
  root: "web",
  plugins: [svelte()],
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022" },
  server: {
    host: true,
    proxy: {
      "/api": relay,
      "/ws": { target: relay.replace("http", "ws"), ws: true },
    },
  },
});
