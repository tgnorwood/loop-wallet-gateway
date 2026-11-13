// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// Never set ssr.external or resolve.external: the Worker has no runtime module resolution, so
// the build fails. Never add compression (compressPublicAssets, vite-plugin-compression):
// hosting already compresses at the edge.
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";
import { fileURLToPath } from "node:url";

// Server-only values stay in process.env; never add these to client define values.
Object.assign(process.env, loadEnv(process.env['NODE_ENV'] ?? "development", process.cwd(), ""));
const entityPath = (path: string) => fileURLToPath(new URL(`./node_modules/entities/${path}`, import.meta.url));

export default defineConfig({
  vite: {
    resolve: {
      alias: {
        // htmlparser2 needs entities 7.x (`entities/decode`); the bare `entities`
        // alias below pins 4.5.0 for @react-email/render, so resolve this first.
        "entities/decode": fileURLToPath(
          new URL("./node_modules/htmlparser2/node_modules/entities/dist/esm/decode.js", import.meta.url),
        ),
        "entities/lib/decode.js": entityPath("lib/decode.js"),
        "entities/lib/encode.js": entityPath("lib/encode.js"),
        entities: entityPath(""),
      },
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
