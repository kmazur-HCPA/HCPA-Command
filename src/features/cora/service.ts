import type { AppClient } from "../../platform/supabase";
import type {
  CoraContext,
  CoraEvent,
  CoraTurn,
  CoraConversation,
} from "./model";
async function authorization(client: AppClient) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error("Sign in to use Cora.");
  return { Authorization: `Bearer ${data.session.access_token}` };
}
async function responseError(response: Response) {
  const data = await response.json().catch(() => ({}));
  throw new Error(
    typeof data.message === "string"
      ? data.message
      : "Cora is unavailable. Please retry.",
  );
}
export async function chat(
  client: AppClient,
  input: {
    message: string;
    requestId: string;
    conversationId: string;
    context: CoraContext;
  },
  signal: AbortSignal,
  onEvent: (event: CoraEvent) => void,
) {
  const r = await fetch("/api/cora/chat", {
    method: "POST",
    headers: {
      ...(await authorization(client)),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal,
    cache: "no-store",
  });
  if (!r.ok) await responseError(r);
  const reader = r.body?.getReader();
  if (!reader) throw new Error("Cora’s response was interrupted.");
  const decoder = new TextDecoder();
  let pending = "",
    finished = false;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    pending += decoder.decode(next.value, { stream: true });
    if (pending.length > 200000)
      throw new Error("Cora’s response was too large.");
    let end;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (!line) continue;
      const event = JSON.parse(line) as CoraEvent;
      onEvent(event);
      if (event.type === "complete" || event.type === "error") finished = true;
    }
  }
  if (!finished)
    throw new Error(
      "Connection interrupted. Reload conversation history before resending; your request may have completed.",
    );
}
export async function history(
  client: AppClient,
  conversationId?: string,
  offset = 0,
): Promise<{ turns?: CoraTurn[]; conversations?: CoraConversation[] }> {
  const query = new URLSearchParams({ offset: String(offset) });
  if (conversationId) query.set("conversationId", conversationId);
  const r = await fetch("/api/cora/history?" + query, {
    headers: await authorization(client),
    cache: "no-store",
  });
  if (!r.ok) await responseError(r);
  return r.json();
}
export async function createTask(client: AppClient, turnId: string) {
  const r = await fetch("/api/cora/action", {
    method: "POST",
    headers: {
      ...(await authorization(client)),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ turnId }),
    cache: "no-store",
  });
  if (!r.ok) await responseError(r);
  return r.json() as Promise<{ taskId: string; created: true }>;
}
