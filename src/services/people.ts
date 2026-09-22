import type { AppClient } from "../platform/supabase";
import type { ContactInput, ContactMatch } from "../features/people/model";
export async function directoryPeople(
  client: AppClient,
  query: string,
  archived: boolean,
  offset: number,
) {
  const { data, error } = await client.rpc("directory_people", {
    query_text: query,
    show_archived: archived,
    page_offset: offset,
  });
  if (error)
    throw new Error("The directory could not load. Reconnect and retry.");
  return { rows: data.slice(0, 50), more: data.length > 50 };
}
export async function contactMatches(client: AppClient) {
  const rows: ContactMatch[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from("work_items")
      .select("id,title,organization,details,archived")
      .eq("kind", "person")
      .order("id")
      .range(offset, offset + 499);
    if (error)
      throw new Error(
        "Existing contacts could not be checked. Retry the preview.",
      );
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
export async function importPeople(client: AppClient, rows: ContactInput[]) {
  const { data, error } = await client.rpc("import_people", { contacts: rows });
  if (error)
    throw new Error(
      "Import was not confirmed. Retry this preview; saved contacts will be recognized, not duplicated.",
    );
  return data;
}
