import type { Config, Context } from "@netlify/functions";
import { handleMcp, protectedResource } from "./_shared/mcp/handler";
import { manageMcp } from "./_shared/mcp/manage";
import { microsoftConfig } from "./_shared/microsoft/config";
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
      { message: "Connection unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  const settings = {
    url,
    key,
    secret,
    origin: env("COMMAND_ORIGIN") ?? "https://cmd.hillspafl.gov",
    microsoft: microsoftConfig(env),
  };
  const path = new URL(request.url).pathname;
  if (path.startsWith("/.well-known/oauth-protected-resource"))
    return protectedResource(settings.origin, url);
  return path === "/api/mcp"
    ? handleMcp(request, settings, context.requestId)
    : manageMcp(request, settings);
};
export const config: Config = {
  path: [
    "/api/mcp",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/api/mcp",
    "/api/cora/connection/status",
    "/api/cora/connection/create",
    "/api/cora/connection/revoke",
  ],
};
