import type { AppClient } from "../../../../src/platform/supabase";
import { weekStart } from "../../../../src/features/standup/model";
import { definition } from "../microsoft/tools";
import { today } from "./tools";

const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const columns = "id,week_start,body,done,carried_from,created_at";
export const standupTools = [
  definition(
    "get_standup_items",
    'Read Kevin\'s Monday stand-up list. scope "current" returns this stand-up week (Tuesday through the following Monday); "history" returns earlier weeks, newest first (up to 200 items). Each item has id, week_start, body, done and carried_from.',
    { scope: { type: "string", enum: ["current", "history"] } },
  ),
  definition(
    "add_standup_item",
    "Add a short item (1 to 300 characters) to this week's stand-up list immediately when Kevin asks. Use a new UUID request_id and reuse it exactly on retries. carried_from is the id of an earlier item being carried forward, or null.",
    {
      request_id: { type: "string" },
      body: { type: "string" },
      carried_from: { type: ["string", "null"] },
    },
  ),
  definition(
    "update_standup_item",
    "Change one stand-up item: new body text (1 to 300 characters) and/or mark it done or not done. Send null for a field to leave it unchanged.",
    {
      id: { type: "string" },
      body: { type: ["string", "null"] },
      done: { type: ["boolean", "null"] },
    },
  ),
  definition(
    "remove_standup_item",
    "Delete one stand-up item when Kevin asks. This cannot be undone; to take it off the list without losing it, mark it done instead.",
    { id: { type: "string" } },
  ),
];
export const standupNames = standupTools.map((t) => t.name);

const text = (value: unknown) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 300)
    throw new Error("A stand-up item is 1 to 300 characters.");
  return value.trim();
};
const exact = (args: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(args).sort().join() !== [...keys].sort().join())
    throw new Error("Invalid stand-up request.");
};
const id = (value: unknown) => {
  if (typeof value !== "string" || !uuid.test(value))
    throw new Error("Invalid stand-up item reference.");
  return value;
};

export async function standupTool(
  store: AppClient,
  userId: string,
  name: string,
  args: Record<string, unknown>,
) {
  const mine = () => store.from("standup_items");
  const week = weekStart(today());
  if (name === "get_standup_items") {
    exact(args, ["scope"]);
    if (args.scope !== "current" && args.scope !== "history")
      throw new Error("Scope must be current or history.");
    const q = mine().select(columns).eq("user_id", userId);
    const r =
      args.scope === "current"
        ? await q.eq("week_start", week).order("created_at")
        : await q
            .lt("week_start", week)
            .order("week_start", { ascending: false })
            .order("created_at")
            .limit(200);
    if (r.error) throw new Error("Stand-up items could not be loaded.");
    return { week_start: week, items: r.data };
  }
  if (name === "add_standup_item") {
    exact(args, ["request_id", "body", "carried_from"]);
    const itemId = id(args.request_id);
    const body = text(args.body);
    const from = args.carried_from === null ? null : id(args.carried_from);
    if (from) {
      const source = await mine()
        .select("id")
        .eq("id", from)
        .eq("user_id", userId)
        .maybeSingle();
      if (source.error || !source.data)
        throw new Error("The carried-from item is unavailable.");
    }
    // A retry with the same request_id returns the saved item instead of adding a second.
    const r = await mine()
      .upsert(
        { id: itemId, user_id: userId, week_start: week, body, carried_from: from },
        { onConflict: "id", ignoreDuplicates: true },
      )
      .select(columns)
      .maybeSingle();
    if (r.error) throw new Error("Stand-up item was not saved. Retry.");
    const saved =
      r.data ??
      (await mine().select(columns).eq("id", itemId).eq("user_id", userId).maybeSingle())
        .data;
    if (!saved || saved.body !== body)
      throw new Error("Request already used. Use a new request_id.");
    return { saved: true, item: saved };
  }
  if (name === "update_standup_item") {
    exact(args, ["id", "body", "done"]);
    const patch: { body?: string; done?: boolean } = {};
    if (args.body !== null) patch.body = text(args.body);
    if (args.done !== null) {
      if (typeof args.done !== "boolean") throw new Error("done must be true or false.");
      patch.done = args.done;
    }
    if (!Object.keys(patch).length) throw new Error("Nothing to change.");
    const r = await mine()
      .update(patch)
      .eq("id", id(args.id))
      .eq("user_id", userId)
      .select(columns)
      .maybeSingle();
    if (r.error || !r.data) throw new Error("Stand-up item unavailable or not saved.");
    return { saved: true, item: r.data };
  }
  exact(args, ["id"]);
  const r = await mine()
    .delete()
    .eq("id", id(args.id))
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (r.error || !r.data) throw new Error("Stand-up item unavailable or not removed.");
  return { removed: true, id: r.data.id };
}
