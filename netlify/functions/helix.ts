import type { Config, Context } from "@netlify/functions";
import { helixConfig } from "./_shared/helix/config";
import { handleHelix } from "./_shared/helix/handler";
export default async (request: Request, context: Context) => {
  const env = (name: string) => Netlify.env.get(name);
  const url = env("SUPABASE_URL"),
    key = env("SUPABASE_PUBLISHABLE_KEY"),
    secret = env("SUPABASE_SECRET_KEY"),
    deploy = env("CONTEXT");
  if (
    !url ||
    !key ||
    !secret ||
    (deploy && !["production", "dev"].includes(deploy))
  )
    return Response.json(
      { message: "Helix is unavailable in this environment." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  const started = performance.now();
  const response = await handleHelix(request, {
    url,
    key,
    secret,
    helix: helixConfig(env),
  });
  console.info(
    JSON.stringify({
      event: "helix_connection",
      requestId: context.requestId,
      status: response.status,
      duration_ms: Math.round(performance.now() - started),
    }),
  );
  return response;
};
export const config: Config = {
  path: [
    "/api/helix/status",
    "/api/helix/summary",
    "/api/helix/connect",
    "/api/helix/callback",
    "/api/helix/disconnect",
  ],
};
