import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split Leaflet into its own chunk via id-based routing so the
        // initial JS bundle ships without it. MapView is React.lazy in
        // App.tsx, so this chunk only loads once the viewport actually
        // needs the map.
        manualChunks(id: string) {
          if (id.includes("node_modules/leaflet")) return "leaflet";
        },
      },
    },
  },
});
