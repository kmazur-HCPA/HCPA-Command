import type { Config, Context } from "@netlify/functions";
import { microsoftConfig } from "./_shared/microsoft/config";
import { handleMicrosoft } from "./_shared/microsoft/handler";
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
      { message: "Microsoft 365 is unavailable in this environment." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  const started = performance.now();
  const response = await handleMicrosoft(request, {
    url,
    key,
    secret,
    microsoft: microsoftConfig(env),
  });
  console.info(
    JSON.stringify({
      event: "microsoft_connection",
      requestId: context.requestId,
      status: response.status,
      duration_ms: Math.round(performance.now() - started),
    }),
  );
  return response;
};
export const config: Config = {
  path: [
    "/api/microsoft/status",
    "/api/microsoft/connect",
    "/api/microsoft/callback",
    "/api/microsoft/disconnect",
  ],
};
