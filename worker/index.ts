import { Container } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

/**
 * Wraps the existing Next.js server (built from the repo-root Dockerfile, completely unmodified) as one
 * Cloudflare Container instance -- see CLOUDFLARE_DEPLOY.md and wrangler.toml's own comment for why this
 * shape was chosen over rewriting apps/web for Workers' edge runtime.
 *
 * Real secrets (DATABASE_URL, S3 access keys, ANTHROPIC_API_KEY) are set on the WORKER via
 * `wrangler secret put <NAME>` (never committed to this repo) and forwarded into the container's own
 * process.env through envVars below -- this is Cloudflare's documented pattern for passing secrets into
 * a Container, not something specific to this app.
 */
export class AvInspectionContainer extends Container {
  defaultPort = 8080;
  // Let the container sleep (and stop being billed) outside active inspection hours -- this is a
  // low-traffic internal tool, not a public high-traffic site. First request after a sleep pays a
  // cold-start cost (container boot + `next start`); acceptable for this app's real usage pattern.
  sleepAfter = "30m";
  envVars = {
    DATABASE_URL: env.DATABASE_URL,
    S3_ENDPOINT: env.S3_ENDPOINT,
    S3_REGION: env.S3_REGION,
    S3_BUCKET: env.S3_BUCKET,
    S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
    S3_FORCE_PATH_STYLE: env.S3_FORCE_PATH_STYLE,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
  };
}

interface Env {
  AV_CONTAINER: DurableObjectNamespace<AvInspectionContainer>;
}

export default {
  async fetch(request: Request, workerEnv: Env): Promise<Response> {
    // Single shared instance: apps/web is one stateful Next.js server, not a per-user/per-key workload,
    // so every request is deliberately routed to the same container via a fixed instance name.
    const container = workerEnv.AV_CONTAINER.getByName("primary");
    return container.fetch(request);
  },
};
