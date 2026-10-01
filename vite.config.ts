import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Serve the Pages handler locally with server-only environment variables. */
function devApiBridge(env: Record<string, string>): Plugin {
  return {
    name: "report-bug-dev-bridge",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        "/api/report-bug",
        async (req, res) => {
          // Don't fall through to Vite's static/module pipeline — without
          // this, GET /api/report-bug would serve the compiled source of
          // functions/api/report-bug.ts (Vite treats it as a module). Always answer
          // here ourselves so the dev surface mirrors production exactly.
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Allow", "POST");
            res.end(JSON.stringify({ error: "Method not allowed" }));
            return;
          }
          try {
            const mod = (await server.ssrLoadModule("/functions/api/report-bug.ts")) as {
              onRequest: (context: { request: Request; env: Record<string, string> }) => Promise<Response>;
            };
            const handler = mod.onRequest;
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(chunk as Buffer);
            }
            const body = Buffer.concat(chunks).toString("utf-8");
            const url = `http://${req.headers.host ?? "localhost"}${req.url}`;
            const headers = new Headers();
            for (const [k, v] of Object.entries(req.headers)) {
              if (Array.isArray(v)) {
                v.forEach((x) => headers.append(k, x));
              } else if (v != null) {
                headers.set(k, v);
              }
            }
            const webReq = new Request(url, { method: "POST", headers, body });
            const webRes = await handler({ request: webReq, env });
            res.statusCode = webRes.status;
            webRes.headers.forEach((v, k) => res.setHeader(k, v));
            const responseBody = await webRes.text();
            res.end(responseBody);
          } catch (err) {
            console.error("[devApiBridge]", err);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: "Dev API bridge crashed. Check terminal logs.",
              }),
            );
          }
        },
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), devApiBridge(loadEnv(mode, process.cwd(), ""))],
  build: {
    // "hidden" emits .map files for our own debugging but does NOT add
    // the `//# sourceMappingURL=` comment to the bundled JS, so browsers
    // (and curious visitors) won't auto-fetch them. Avoids shipping the
    // full TypeScript source — including dev comments — to anyone who
    // pops open devtools.
    sourcemap: "hidden",
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
}));
