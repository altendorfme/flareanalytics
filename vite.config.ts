import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  build: {
    assetsInlineLimit: (file) => (file.includes("flag-icons") ? false : undefined),
  },
});
