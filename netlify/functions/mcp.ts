import type { Config, Context } from "@netlify/functions";
import { handleMcp } from "./_shared/mcp/handler";
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
  return new URL(request.url).pathname === "/api/mcp"
    ? handleMcp(request, settings, context.requestId)
    : manageMcp(request, settings);
};
export const config: Config = {
  path: [
    "/api/mcp",
    "/api/cora/connection/status",
    "/api/cora/connection/create",
    "/api/cora/connection/revoke",
  ],
};
