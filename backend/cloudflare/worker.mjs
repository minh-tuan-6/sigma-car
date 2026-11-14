// backend/cloudflare/worker.mjs
// Cloudflare Worker entry for the SIGMACAR API (config: wrangler.api.toml). Reached only through the Pages Function
// service binding SIGMA_API (no workers.dev URL, no routes). See docs/CLOUDFLARE_WORKERS_DEPLOYMENT.md.
import runtime from './runtime.js';

// Evaluate the backend in global scope (Worker startup budget), not inside the first request (10 ms CPU on Free).
// process.env is already populated here (nodejs_compat). A configuration error is kept and answered as 503 CONFIG_ERROR.
try {
  runtime.preload();
} catch (err) {
  console.error('[sigmacar-api] initialisation failed:', err && err.message);
}

export default {
  async fetch(request, env, ctx) {
    return runtime.handle(request, env, ctx);
  }
};
