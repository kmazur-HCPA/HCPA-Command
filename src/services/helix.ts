import type { AppClient } from "../platform/supabase";
import type {
  HelixStatus,
  HelixSummaryResponse,
} from "../features/helix/model";

async function call(client: AppClient, action: string, method = "GET") {
  const session = await client.auth.getSession();
  if (session.error || !session.data.session)
    throw new Error("Sign in again to use Helix.");
  const response = await fetch(`/api/helix/${action}`, {
    method,
    headers: { Authorization: `Bearer ${session.data.session.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(
        typeof data.message === "string"
          ? data.message
          : "Helix is unavailable. Please retry.",
      ),
      { status: response.status },
    );
  return data;
}
export const helixStatus = (client: AppClient) =>
  call(client, "status") as Promise<HelixStatus>;
export const helixSummary = async (client: AppClient) => {
  const result = (await call(client, "summary")) as HelixSummaryResponse;
  if (!result?.sections) throw new Error("Helix is unavailable. Please retry.");
  return result;
};
export const helixDisconnect = (client: AppClient) =>
  call(client, "disconnect", "POST");
export async function helixConnect(client: AppClient) {
  const result = await call(client, "connect", "POST");
  const target = new URL(result.url);
  if (
    !target.hostname.endsWith(".supabase.co") ||
    target.protocol !== "https:" ||
    target.username ||
    target.password
  )
    throw new Error("Helix sign-in URL is invalid.");
  return target.href;
}
