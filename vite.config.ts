import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import plexui from "@plexui/ui/vite";

// GitHub Pages serves the site from /<repo-name>/
export default defineConfig(({ command }) => ({
  base: command === "build" ? process.env.BASE_PATH ?? "/discogs-blind-test/" : "/",
  plugins: [plexui(), react(), tailwindcss()],
}));
