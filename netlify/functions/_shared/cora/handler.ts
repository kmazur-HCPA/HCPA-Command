import { applyRecord, validateRecordProposal } from "./actions";
import { createProvider } from "./provider";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../../../src/data/database.types";
import type {
  CoraContext,
  CoraEvent,
} from "../../../../src/features/cora/model";
import { newItem } from "../../../../src/features/work/model";
import { saveWork } from "../../../../src/services/work";
import { uuid, validateProposal } from "./tools";
import { runCora } from "./engine";
import type { MicrosoftConfig } from "../microsoft/config";
export type CoraConfig = {
  url: string;
  key: string;
  secret: string;
  apiKey: string;
  baseURL?: string;
  model?: string;
  effort?: string;
  microsoft?: MicrosoftConfig;
};
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function boundedJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Request body required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    length += r.value.length;
    if (length > 20000) {
      await reader.cancel();
      throw new Error("Request too large.");
    }
    chunks.push(r.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}
export async function handleCora(
  request: Request,
  settings: CoraConfig,
  requestId: string,
) {
  const respond = (status: number, message: string) =>
    Response.json({ message, requestId }, { status, headers });
  const path = new URL(request.url).pathname;
  if (
    ![
      "/api/cora/chat",
      "/api/cora/history",
      "/api/cora/action",
    ].includes(path)
  )
    return respond(404, "Not found.");
  if (request.method !== (path.endsWith("history") ? "GET" : "POST"))
    return respond(405, "Method not allowed.");
  const auth = request.headers.get("authorization") ?? "";
  if (auth.length > 8192 || !/^Bearer [^\s]+$/i.test(auth))
    return respond(401, "Sign in to use Cora.");
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)]);
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: auth },
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(8000),
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
    },
  };
  const client = createClient<Database>(settings.url, settings.key, options);
  const store = createClient<Database>(settings.url, settings.secret, {
    auth: options.auth,
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
    },
  });
  try {
    const identityResult = await client.auth.getUser(auth.slice(7));
    const user = identityResult.data.user;
    if (identityResult.error || !user || user.is_anonymous)
      return respond(401, "Sign in to use Cora.");
    const membership = await client
      .from("app_memberships")
      .select("active")
      .eq("user_id", user.id)
      .maybeSingle();
    if (membership.error)
      return respond(503, "Command access is temporarily unavailable.");
    if (!membership.data?.active)
      return respond(403, "Command access is unavailable.");
    if (path.endsWith("history")) {
      const params = new URL(request.url).searchParams,
        conversation = params.get("conversationId"),
        offset = Number(params.get("offset") ?? 0);
      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset > 10000 ||
        (conversation && !uuid.test(conversation))
      )
        return respond(400, "Invalid conversation page.");
      if (conversation) {
        const r = await client
          .from("cora_turns")
          .select("*")
          .eq("conversation_id", conversation)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(offset, offset + 19);
        if (r.error)
          return respond(503, "Conversation history is unavailable.");
        return Response.json({ turns: r.data }, { headers });
      }
      const r = await client
        .from("cora_conversations")
        .select("*")
        .order("updated_at", { ascending: false })
        .order("id")
        .range(offset, offset + 19);
      if (r.error) return respond(503, "Conversation history is unavailable.");
      return Response.json({ conversations: r.data }, { headers });
    }
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return respond(415, "JSON required.");
    let body: Record<string, unknown>;
    try {
      body = await boundedJson(request);
    } catch {
      return respond(400, "Invalid or oversized request.");
    }
    if (path.endsWith("action")) {
      if (
        Object.keys(body).join() !== "turnId" ||
        typeof body.turnId !== "string" ||
        !uuid.test(body.turnId)
      )
        return respond(400, "Invalid action.");
      const r = await client
        .from("cora_turns")
        .select("*")
        .eq("id", body.turnId)
        .eq("status", "complete")
        .maybeSingle();
      if (r.error || !r.data?.proposal)
        return respond(404, "Action proposal unavailable.");
      const turn = r.data,
        p =
          "type" in turn.proposal!
            ? validateRecordProposal(turn.proposal)
            : validateProposal(turn.proposal);
      if (turn.action_status === "created")
        return Response.json(
          { taskId: turn.task_id, created: true },
          { headers },
        );
      const input =
        "type" in p
          ? null
          : { ...newItem("task", user.id), ...p, id: turn.task_id };
      // RLS and existing record validation are authoritative. Stable IDs reconcile
      // retries/lost acknowledgements without creating or overwriting a second task.
      try {
        const recordId =
          "type" in p
            ? await applyRecord(client, p, user.id, turn.task_id)
            : (await saveWork(client, input!)).id;
        const audit = await store.from("cora_activity").insert({
          user_id: user.id,
          turn_id: turn.id,
          tool: "type" in p ? p.operation + "_" + p.kind : "create_task",
          arguments: p,
          result: { record_id: recordId },
          success: true,
        });
        if (audit.error)
          throw new Error(
            "Change may be saved, but its Cora receipt could not be recorded. Retry this same card to reconcile.",
          );
        const updated = await store
          .from("cora_turns")
          .update({ action_status: "created", task_id: recordId })
          .eq("id", turn.id)
          .eq("user_id", user.id);
        if (updated.error)
          throw new Error(
            "Change may be saved. Retry this same card to reconcile.",
          );
        return Response.json({ taskId: recordId, created: true }, { headers });
      } catch (error) {
        await store.from("cora_activity").insert({
          user_id: user.id,
          turn_id: turn.id,
          tool: "type" in p ? p.operation + "_" + p.kind : "create_task",
          arguments: p,
          result: { state: "not_confirmed" },
          success: false,
        });
        return respond(
          409,
          error instanceof Error
            ? error.message
            : "Change was not confirmed. Retry this same card.",
        );
      }
    }
    if (
      typeof body.message !== "string" ||
      !body.message.trim() ||
      body.message.length > 4000 ||
      typeof body.requestId !== "string" ||
      !uuid.test(body.requestId) ||
      typeof body.conversationId !== "string" ||
      !uuid.test(body.conversationId) ||
      Object.keys(body).some(
        (k) =>
          !["message", "requestId", "conversationId", "context"].includes(k),
      )
    )
      return respond(400, "Invalid Cora request.");
    const context = (body.context ?? {}) as CoraContext;
    const pages = [
      "workspace",
      "command-brief",
      "settings",
      "lab",
      "task",
      "reminder",
      "project",
      "initiative",
      "person",
      "journal",
      "waiting",
      "learning",
      "program",
      "use_case",
      "experiment",
      "library",
    ];
    if (
      !pages.includes(context.page) ||
      !(
        context.recordId === null ||
        (typeof context.recordId === "string" && uuid.test(context.recordId))
      ) ||
      Object.keys(context).some((k) => !["page", "recordId"].includes(k))
    )
      return respond(400, "Invalid page context.");
    const reserved = await store.rpc("cora_begin", {
      p_user: user.id,
      p_conversation: body.conversationId,
      p_request: body.requestId,
      p_message: body.message.trim(),
      p_context: context,
    });
    if (reserved.error)
      return respond(
        reserved.error.code === "P0001" ? 429 : 409,
        reserved.error.code === "P0001"
          ? "Cora is busy or the request limit was reached. Wait a minute and retry."
          : "This request could not be started. Reload the conversation.",
      );
    if (!reserved.data.started && reserved.data.turn.status === "running")
      return respond(
        409,
        "Cora is still working on this request. Reload conversation history in a moment.",
      );
    const turn = reserved.data.turn,
      encoder = new TextEncoder();
    const provider = createProvider(settings);
    const started = performance.now();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let connected = true;
        const emit = (event: CoraEvent) => {
          if (connected) {
            try {
              controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
            } catch {
              connected = false;
            }
          }
        };
        try {
          if (turn.status === "complete") emit({ type: "complete", turn });
          else if (turn.status === "error")
            emit({
              type: "error",
              message:
                "This request did not finish. Send a new message to try again.",
            });
          else if (new Date(turn.created_at).getTime() < Date.now() - 5000)
            emit({
              type: "error",
              message:
                "This request is still running or was interrupted. Reload conversation history before resending.",
            });
          else
            await runCora({
              client,
              store,
              turn,
              provider,
              settings,
              signal,
              emit,
              microsoft: settings.microsoft,
            });
        } catch {
          await store
            .from("cora_turns")
            .update({
              status: "error",
              response:
                "Cora could not finish this response. Check Command for any saved reminders before retrying.",
              finished_at: new Date().toISOString(),
            })
            .eq("id", turn.id)
            .eq("user_id", user.id)
            .eq("status", "running");
          emit({
            type: "error",
            message: signal.aborted
              ? "Stopped. Check Command for any saved reminders before retrying."
              : "Cora could not finish. Your message is saved; please try again. Check Command for any saved reminders before retrying.",
          });
        } finally {
          console.info(
            JSON.stringify({
              event: "cora_request",
              requestId,
              duration_ms: Math.round(performance.now() - started),
            }),
          );
          if (connected) controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        ...headers,
        "Content-Type": "application/x-ndjson; charset=utf-8",
      },
    });
  } catch {
    return respond(
      503,
      "Cora is temporarily unavailable. Your regular Command tools are still available.",
    );
  }
}
