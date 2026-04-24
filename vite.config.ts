import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    // The `data` chunk ships tasks.json + the build-time-resolved
    // placements/locations JSON (~1 MB raw, ~120 KB gzip). Gated to its
    // own chunk below so app-code changes don't bust the data cache.
    // Headroom kept tight so a real future blow-up still surfaces.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // Leaflet stays in its own chunk; MapView is React.lazy in
          // App.tsx, so this chunk only loads once the viewport
          // actually needs the map.
          if (id.includes("node_modules/leaflet")) return "leaflet";
          // React/ReactDOM rarely change between deploys — give them
          // their own long-lived cache bucket.
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          // Big OSRS data blobs go into a `data` chunk. They turn over
          // far less often than UI code, so splitting them lets the
          // browser keep them cached across deploys that only change
          // app code.
          if (
            id.includes("src/data/tasks.json") ||
            id.includes("src/data/generated/")
          ) {
            return "data";
          }
        },
      },
    },
  },
});
