import adapter from "@sveltejs/adapter-static";

/**
 * `apps/web` SvelteKit config: single static SPA.
 *
 * Output goes to `dist/` (not `build/`) because the daemon serves that
 * directory directly (`--web-dir=apps/web/dist`), and Tauri embeds it as
 * `frontendDist`. One page, no server routes — `strict: true` fails the
 * build if one sneaks in. `fallback: index.html` so deep links and the
 * DSH/VS Code frames resolve to the app shell.
 */
const config = {
  kit: {
    adapter: adapter({
      pages: "dist",
      assets: "dist",
      fallback: "index.html",
      precompress: false,
      strict: true,
    }),
  },
};

export default config;
