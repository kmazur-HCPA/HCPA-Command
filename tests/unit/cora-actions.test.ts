import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/data/database.types";
import {
  applyRecord,
  prepareRecord,
  validateFields,
  validateRecordProposal,
  kinds,
} from "../../netlify/functions/_shared/cora/actions";
import { newItem } from "../../src/features/work/model";
const owner = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
const client = () =>
  createClient<Database>("https://fixture.supabase.co", "fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const reminder = {
  type: "record" as const,
  kind: "reminder" as const,
  operation: "create" as const,
  record_id: null,
  expected_version: null,
  title: "Email Al and Nereia about website feedback",
  fields: {
    title: "Email Al and Nereia about website feedback",
    due_date: "2026-09-22",
  },
};
afterEach(() => vi.unstubAllGlobals());
describe("Cora record actions", () => {
  it("supports date-only and timed reminders without substituting a task", () => {
    expect(validateRecordProposal(reminder).kind).toBe("reminder");
    expect(
      validateFields("reminder", { remind_at: "2026-09-22T09:00:00-04:00" }),
    ).toHaveProperty("remind_at");
    expect(() =>
      validateFields("reminder", { remind_at: "2026-09-22T09:00:00" }),
    ).toThrow();
    expect(() =>
      validateFields("reminder", { due_date: "2026-02-30" }),
    ).toThrow();
  });
  it("allows each record type but rejects ownership, original text and version changes", () => {
    for (const kind of kinds)
      expect(
        validateFields(kind, {
          title: "Example",
          status: newItem(kind, owner).status,
        }),
      ).toHaveProperty("title");
    for (const key of [
      "user_id",
      "id",
      "kind",
      "version",
      "original_body",
      "converted_task_id",
      "completed_at",
      "__proto__",
    ])
      expect(() =>
        validateFields("reminder", JSON.parse(`{"${key}":"bad"}`)),
      ).toThrow();
    expect(() => validateFields("reminder", { status: "Inbox" })).toThrow();
  });
  it("prepares updates only against the owner and exact version, without writing", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const r = new Request(input, init),
          u = new URL(r.url);
        expect(r.method).toBe("GET");
        expect(u.searchParams.get("user_id")).toBe("eq." + owner);
        return Response.json({
          id,
          title: "Follow up",
          kind: "reminder",
          version: 3,
        });
      },
    );
    vi.stubGlobal("fetch", fetcher);
    const args = {
      kind: "reminder",
      operation: "update",
      record_id: id,
      expected_version: 3,
      fields_json: JSON.stringify({
        status: "Snoozed",
        snoozed_until: "2026-09-23T09:00:00-04:00",
      }),
    };
    expect((await prepareRecord(client(), args, owner)).fields.status).toBe(
      "Snoozed",
    );
    await expect(
      prepareRecord(client(), { ...args, expected_version: 2 }, owner),
    ).rejects.toThrow("changed");
  });
  it("creates a reminder using its stable receipt ID and authenticated owner", async () => {
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const r = new Request(input, init);
        const body = await r.json();
        expect(body.kind).toBe("reminder");
        expect(body.id).toBe(id);
        expect(body.user_id).toBe(owner);
        expect(body.remind_at).toBeNull();
        expect(body.due_date).toBe("2026-09-22");
        expect(r.headers.get("Prefer")).toContain(
          "resolution=ignore-duplicates",
        );
        return Response.json({ ...body, version: 1 });
      },
    );
    expect(await applyRecord(client(), reminder, owner, id)).toBe(id);
  });
  it("updates only proposed fields with optimistic concurrency", async () => {
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const r = new Request(input, init),
          u = new URL(r.url);
        if (r.method === "GET")
          return Response.json({ id, kind: "reminder", user_id: owner });
        expect(u.searchParams.get("version")).toBe("eq.3");
        expect(await r.json()).toEqual({ status: "Complete" });
        return Response.json({ id, status: "Complete" });
      },
    );
    expect(
      await applyRecord(
        client(),
        {
          ...reminder,
          operation: "update",
          record_id: id,
          expected_version: 3,
          fields: { status: "Complete" },
        },
        owner,
        id,
      ),
    ).toBe(id);
  });
  it("does not update unavailable or wrong-kind records", async () => {
    const fetcher = vi.fn(async () => Response.json(null));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      applyRecord(
        client(),
        {
          ...reminder,
          operation: "update",
          record_id: id,
          expected_version: 3,
          fields: { status: "Complete" },
        },
        owner,
        id,
      ),
    ).rejects.toThrow("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

it('the confirmation endpoint saves a reminder and records its actual receipt', async()=>{
 const {handleCora}=await import('../../netlify/functions/_shared/cora/handler');
 let workWrites=0, audited=false, receipted=false;
 vi.stubGlobal('fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const r=new Request(input,init),u=new URL(r.url);
  if(u.pathname==='/auth/v1/user')return Response.json({id:owner,email:'owner@example.test'});
  if(u.pathname.endsWith('/app_memberships'))return Response.json({active:true});
  if(u.pathname.endsWith('/cora_turns')&&r.method==='GET')return Response.json({id,user_id:owner,proposal:reminder,status:'complete',action_status:'proposed',task_id:id});
  if(u.pathname.endsWith('/work_items')){
   expect(r.headers.get('Authorization')).toBe('Bearer user-session');
   const body=await r.json();expect(body.kind).toBe('reminder');workWrites++;
   return Response.json({...body,version:1});
  }
  if(u.pathname.endsWith('/cora_activity')){const body=await r.json();expect(body.tool).toBe('create_reminder');expect(body.success).toBe(true);audited=true;return new Response(null,{status:204});}
  if(u.pathname.endsWith('/cora_turns')&&r.method==='PATCH'){expect((await r.json()).task_id).toBe(id);receipted=true;return new Response(null,{status:204});}
  throw new Error('Unexpected request');
 });
 const response=await handleCora(new Request('https://cmd.test/api/cora/action',{method:'POST',headers:{Authorization:'Bearer user-session','Content-Type':'application/json'},body:JSON.stringify({turnId:id})}),{url:'https://fixture.supabase.co',key:'public',secret:'private',apiKey:'unused'},'test');
 expect(response.status).toBe(200);expect(await response.json()).toEqual({taskId:id,created:true});expect(workWrites).toBe(1);expect(audited&&receipted).toBe(true);
});
