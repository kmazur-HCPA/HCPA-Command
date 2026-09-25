import type { Config, Context } from "@netlify/functions";
import { handleCora } from "./_shared/cora/handler";
import { microsoftConfig } from "./_shared/microsoft/config";
export default async (request: Request, context: Context) => {
  const env = (name: string) => Netlify.env.get(name);
  const url = env("SUPABASE_URL"),
    key = env("SUPABASE_PUBLISHABLE_KEY"),
    secret = env("SUPABASE_SECRET_KEY"),
    apiKey = env("ANTHROPIC_API_KEY"),
    deploy = env("CONTEXT");
  if (
    (deploy && !["production", "dev"].includes(deploy)) ||
    !url ||
    !key ||
    !secret ||
    !apiKey
  )
    return Response.json(
      {
        message:
          "Cora in Command is not turned on. Ask Cora in Claude instead; your Command workspace is available.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  return handleCora(
    request,
    {
      url,
      key,
      secret,
      apiKey,
      baseURL: env("ANTHROPIC_BASE_URL"),
      model: env("CORA_MODEL"),
      effort: env("CORA_EFFORT"),
      microsoft: microsoftConfig(env),
    },
    context.requestId,
  );
};
export const config: Config = {
  path: [
    "/api/cora/chat",
    "/api/cora/history",
    "/api/cora/action",
  ],
};
