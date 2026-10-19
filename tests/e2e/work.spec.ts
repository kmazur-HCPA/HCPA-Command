import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { newItem } from "../../src/features/work/model";
import type { WorkItem } from "../../src/features/work/model";
const uid = "11111111-1111-4111-8111-111111111111";
const user = {
  id: uid,
  email: "owner@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01Z",
};
const jwt = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: uid, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test`;
async function setup(page: Page) {
  await page.route("**/api/microsoft/calendar?**",r=>r.fulfill({json:{events:[],truncated:false,retrievedAt:new Date().toISOString()}}));
  await page.route("**/api/microsoft/flagged", r => r.fulfill({ json: { messages: [], truncated: false, window_days: 90, retrievedAt: new Date().toISOString() } }));
  await page.route('**/rest/v1/cora_workday_reviews*',r=>r.fulfill({json:[]}));
  await page.route('**/rest/v1/cora_review_preferences*',r=>r.fulfill({json:{automatic_reminders:false}}));
  await page.route("**/api/helix/**", route => route.fulfill({ status: 409, json: { message: "Connect Helix in Settings." } }));
  await page.route("**/api/cora/connection/status", route => route.fulfill({json:{connection:null}}));
  await page.route("**/api/microsoft/status", route => route.fulfill({ json: { configured: false, connected: false } }));
  const rows: WorkItem[] = [],
    history: {
      id: string;
      item_id: string;
      version: number;
      snapshot: WorkItem;
      created_at: string;
    }[] = [];
  const control = { failWrites: false, loseAck: false };
  const closes: Record<string, unknown>[] = [],
    closeCalls: Record<string, unknown>[] = [];
  const standup: { id: string; week_start: string; body: string; done: boolean; carried_from: string | null; user_id: string; created_at: string }[] = [];
  let theme = "dark";
  await page.route("https://command-test.supabase.co/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      p = url.searchParams,
      method = request.method();
    if (url.pathname.endsWith('/standup_items')) {
      const m = request.method();
      if (m === 'POST') { standup.push({ done: false, created_at: new Date().toISOString(), ...request.postDataJSON() }); return route.fulfill({ status: 201, json: [] }); }
      if (m === 'DELETE') { const id = p.get('id')?.replace('eq.', ''); standup.splice(0, standup.length, ...standup.filter((r) => r.id !== id)); return route.fulfill({ status: 204 }); }
      if (m === 'PATCH') { const id = p.get('id')?.replace('eq.', ''); const row = standup.find((r) => r.id === id); if (row) Object.assign(row, request.postDataJSON()); return route.fulfill({ status: 204 }); }
      const week = p.get('week_start'), before = p.get('week_start')?.startsWith('lt.');
      const out = standup.filter((r) => (before ? r.week_start < week!.slice(3) : week ? r.week_start === week.replace('eq.', '') : true));
      return route.fulfill({ json: out });
    }
    if(url.pathname.endsWith('/cora_workday_reviews'))return route.fulfill({json:[]});
    if(url.pathname.endsWith('/cora_review_preferences'))return route.fulfill({json:{automatic_reminders:false}});
    if (url.pathname === "/auth/v1/token")
      return route.fulfill({
        json: {
          access_token: jwt,
          refresh_token: "test",
          expires_in: 3600,
          token_type: "bearer",
          user,
        },
      });
    if (url.pathname === "/auth/v1/user") return route.fulfill({ json: user });
    if (url.pathname === "/auth/v1/logout") return route.fulfill({ json: {} });
    if (url.pathname.endsWith("/app_memberships"))
      return route.fulfill({ json: { user_id: uid, active: true } });
    if (url.pathname.endsWith("/user_preferences")) {
      if (method === "PATCH") theme = request.postDataJSON().theme;
      return route.fulfill({
        json: { user_id: uid, theme, timezone: "America/New_York", version: 1 },
      });
    }
    if(url.pathname.endsWith('/rpc/export_workspace'))return route.fulfill({json:{format:'command-workspace',format_version:1,exported_at:new Date().toISOString(),user_id:uid,work_items:rows,journal_revisions:[],library_versions:[],user_preferences:[],app_memberships:[],activity_log:[],counts:{work_items:rows.length,journal_revisions:0,library_versions:0,user_preferences:0,app_memberships:0,activity_log:0}}});
    if(url.pathname.endsWith('/rpc/search_work')) {
      const input=request.postDataJSON();const query=input.query_text.toLowerCase();
      const selected=rows.filter(row=>(!input.module_filter||row.kind===input.module_filter)&&(!input.status_filter||row.status===input.status_filter)&&(input.archive_filter==='all'||row.archived===(input.archive_filter==='archived'))&&(!input.tag_filter||row.tags.includes(input.tag_filter))&&JSON.stringify([row.title,row.body,row.tags,row.details]).toLowerCase().includes(query));
      return route.fulfill({json:selected.slice(input.page_offset,input.page_offset+26).map(row=>({...row,excerpt:row.body,rank:1}))});
    }
    if (url.pathname.endsWith("/journal_revisions"))
      return route.fulfill({
        json: history
          .filter((h) => h.item_id === p.get("item_id")?.slice(3))
          .reverse(),
      });
    if(url.pathname.endsWith('/rpc/directory_people')){
      const input=request.postDataJSON(),q=input.query_text.toLowerCase();
      return route.fulfill({json:rows.filter(row=>row.kind==='person'&&row.archived===input.show_archived&&JSON.stringify([row.title,row.person_role,row.organization,row.details,row.body]).toLowerCase().includes(q)).sort((a,b)=>a.title.localeCompare(b.title)).slice(input.page_offset,input.page_offset+51).map(row=>({...row,notes_excerpt:row.body.slice(0,240)}))});
    }
    if(url.pathname.endsWith('/rpc/import_people')){
      if(control.failWrites)return route.fulfill({status:503,json:{message:'Synthetic failure'}});
      const contacts=request.postDataJSON().contacts;let created=0,skipped=0;
      for(const c of contacts){if(rows.some(row=>row.kind==='person'&&(row.id===c.id||c.email&&row.details.email?.toLowerCase()===c.email.toLowerCase()||row.title.toLowerCase()===c.name.toLowerCase()&&row.organization.toLowerCase()===c.organization.toLowerCase()))){skipped++;continue;}
      rows.push({...newItem('person',uid),id:c.id,title:c.name,person_role:c.job_title,organization:c.organization,body:c.notes,original_body:c.notes,details:{email:c.email,phone:c.phone,mobile:c.mobile,department:c.department,location:c.location},version:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),completed_at:null});created++;}
      if(control.loseAck){control.loseAck=false;return route.abort('failed');}
      return route.fulfill({json:{created,skipped,results:[]}});
    }
    if (url.pathname.endsWith('/usage_events')) return route.fulfill({ status: method === 'POST' ? 201 : 200, json: [] });
    if (url.pathname.endsWith('/day_closes')) {
      if (method === 'POST') { closes.push(request.postDataJSON()); return route.fulfill({ status: 201, json: [] }); }
      return route.fulfill({ json: closes });
    }
    if (url.pathname.endsWith('/rpc/apply_day_close')) {
      const input = request.postDataJSON();
      closeCalls.push(input);
      if (control.failWrites) return route.fulfill({ status: 400, json: { message: 'Record changed since it was read: stale' } });
      for (const a of input.p_actions as { id: string; op: string; date?: string }[]) {
        const row = rows.find((r) => r.id === a.id)!;
        if (a.op === 'done') { row.status = 'Complete'; row.completed_at = new Date().toISOString(); }
        if (a.op === 'drop') row.archived = true;
        if (a.op === 'date') row.due_date = a.date!;
        row.version++;
      }
      if (input.p_first) rows.forEach((r) => { r.focus_slot = r.id === input.p_first ? 1 : r.focus_slot === 1 ? null : r.focus_slot; });
      if (input.p_finish) closes.push({ for_date: input.p_for_date, counts: input.p_counts, first_item_id: input.p_first, completed_at: new Date().toISOString() });
      return route.fulfill({ json: { applied: { done: 0, rolled: 0, dropped: 0, converted: 0 }, counts: input.p_counts, receipt_id: input.p_finish ? uid : null } });
    }
    if (url.pathname.endsWith('/rpc/swap_work_order')) {
      if(control.failWrites)return route.fulfill({status:503,json:{message:'Synthetic failure'}});
      const input=request.postDataJSON();
      const a=rows.find(r=>r.id===input.first_id),b=rows.find(r=>r.id===input.second_id);
      if(!a||!b||a.version!==input.first_version||b.version!==input.second_version)return route.fulfill({status:409,json:{message:'Conflict'}});
      [a.sort_order,b.sort_order]=[b.sort_order,a.sort_order];a.version++;b.version++;
      return route.fulfill({status:204});
    }
    if (url.pathname.endsWith("/rpc/convert_reminder")) {
      const input = request.postDataJSON(),
        r = rows.find((r) => r.id === input.reminder_id)!;
      if (!r.converted_task_id) {
        const task = {
          ...r,
          id: crypto.randomUUID(),
          kind: "task" as const,
          status: "Inbox",
          version: 1,
        };
        rows.push(task);
        r.converted_task_id = task.id;
        r.status = "Complete";
        r.version++;
      }
      return route.fulfill({ json: r.converted_task_id });
    }
    if (!url.pathname.endsWith("/work_items"))
      return route.fulfill({
        status: 404,
        json: { message: "Unexpected request" },
      });
    if (method !== "GET" && control.failWrites)
      return route.fulfill({
        status: 503,
        json: { message: "Synthetic network failure" },
      });
    let selected = rows.filter((row) => {
      for (const [key, value] of p) {
        if (["select", "order", "offset", "limit", "or"].includes(key))
          continue;
        const v = row[key as keyof WorkItem];
        if (value.startsWith("eq.") && String(v) !== value.slice(3))
          return false;
        if (value === "not.is.null" && v === null) return false;
        if (
          value.startsWith("lte.") &&
          (v === null || String(v) > value.slice(4))
        )
          return false;
        if (
          value.startsWith("in.") &&
          !value.slice(4, -1).split(",").includes(String(v))
        )
          return false;
        if (
          value.startsWith("not.in.") &&
          value.slice(8, -1).split(",").includes(String(v))
        )
          return false;
      }
      return true;
    });
    if (method === "POST") {
      const input = request.postDataJSON();
      if (rows.some((r) => r.id === input.id)) selected = [];
      else {
        const row = {
          ...newItem(input.kind, uid),
          ...input,
          original_body: input.body,
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null,
        } as WorkItem;
        rows.push(row);
        selected = [row];
      }
    }
    if (method === "PATCH") {
      const patch = request.postDataJSON();
      selected.forEach((row) =>
        Object.assign(row, patch, {
          version: row.version + 1,
          updated_at: new Date().toISOString(),
        }),
      );
    }
    if (method !== "GET") {
      selected
        .filter((r) => (r.kind as string) === "journal")
        .forEach((row) =>
          history.push({
            id: crypto.randomUUID(),
            item_id: row.id,
            version: row.version,
            snapshot: { ...row },
            created_at: row.updated_at,
          }),
        );
      if (control.loseAck) {
        control.loseAck = false;
        return route.abort("failed");
      }
    }
    if (method === "GET" && p.get('order')?.startsWith('sort_order'))
      selected.sort((a,b)=>(a.sort_order??0)-(b.sort_order??0)||a.id.localeCompare(b.id));
    if (method === "GET")
      selected = selected.slice(
        Number(p.get("offset") ?? 0),
        Number(p.get("offset") ?? 0) + Number(p.get("limit") ?? 1000),
      );
    const single = request.headers().accept?.includes("vnd.pgrst.object");
    if (single && !selected.length)
      return route.fulfill({ status: 406, json: { message: "No row" } });
    return route.fulfill({ json: single ? selected[0] : selected });
  });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Test-password-123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Work Day", exact: true }),
  ).toBeVisible();
  return { rows, control, history, standup, closes, closeCalls };
}
test("create a task, choose a priority, edit, and complete it", async ({
  page,
}) => {
  const { rows } = await setup(page);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Capture, search, or ask CMD" }).click().then(() => page.getByRole("button", { name: /^Capture as task/ }).click());
  await page.getByLabel("Title", { exact: true }).fill("Review architecture");
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("Check the recovery path.");
  await page.getByLabel("Due date", { exact: true }).fill("2026-09-21");
  await page.getByLabel("Work Day priority slot").selectOption("1");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review architecture", exact: true }),
  ).toBeVisible();
  expect(rows[0]?.due_date).toBe("2026-09-21");
  await page.getByRole("button", { name: "Work Day", exact: true }).click();
  await expect(
    page
      .locator(".wd-now")
      .getByText("Review architecture"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Complete Review architecture", exact: true }).click();
  await page.getByRole("combobox",{name:"Filter status",exact:true}).selectOption("Complete");
  await expect(page.locator(".task-metadata")).toContainText("Complete");
});
test("quick capture survives a failed save and reload, then a lost acknowledgement produces one Inbox task", async ({
  page,
}) => {
  const { rows, control } = await setup(page);
  await page.getByRole("button", { name: "Capture, search, or ask CMD" }).click();
  await page.getByRole("button", { name: /^Quick capture/ }).click();
  await page
    .getByLabel("What’s on your mind?")
    .fill("  Keep the original words.\nSecond line.  ");
  control.failWrites = true;
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Not saved");
  await page
    .getByRole("button", { name: "Close · keep draft", exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "Capture, search, or ask CMD" }).click();
  await page.getByRole("button", { name: /^Quick capture/ }).click();
  await expect(page.getByLabel("What’s on your mind?")).toHaveValue(
    "  Keep the original words.\nSecond line.  ",
  );
  control.failWrites = false;
  control.loseAck = true;
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await expect(page.getByText("Saved to your Inbox")).toBeVisible();
  expect(rows.filter((r) => r.kind === "task")).toHaveLength(1);
  expect(rows[0]).toMatchObject({ kind: "task", status: "Inbox", title: "Keep the original words." });
  expect(rows[0]?.original_body).toBe(
    "  Keep the original words.\nSecond line.  ",
  );
});
test("unsent drafts block logout until deliberately discarded", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Capture, search, or ask CMD" }).click();
  await page.getByRole("button", { name: /^Quick capture/ }).click();
  await page.getByLabel("What’s on your mind?").fill("Unsent note");
  await page
    .getByRole("button", { name: "Close · keep draft", exact: true })
    .click();
  await page.getByLabel("Account menu").click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("unsaved local drafts");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page.getByLabel("Account menu").click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to Command." }),
  ).toBeVisible();
});
test("reminder remains visible after its due time and converts explicitly", async ({
  page,
}) => {
  const { rows } = await setup(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Reminders", exact: true }).click();
  await page.getByRole("button", { name: "New reminder", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Call vendor");
  await page.getByLabel("Reminder date (no time)").fill("2020-01-01");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Call vendor", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Actions for Call vendor", {exact:true}).click();
  await page
    .getByRole("button", { name: "Convert to task", exact: true })
    .click();
  await expect(page.locator(".record-meta")).toContainText("Complete");
  expect(rows.filter((r) => r.kind === "task")).toHaveLength(1);
});
test("conflicting edits preserve the draft until the saved version is reviewed", async ({
  page,
}) => {
  const { rows } = await setup(page);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Capture, search, or ask CMD" }).click().then(() => page.getByRole("button", { name: /^Capture as task/ }).click());
  await page.getByLabel("Title", { exact: true }).fill("Concurrent task");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Concurrent task", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("My unsent edit");
  rows[0]!.body = "Remote edit";
  rows[0]!.version++;
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changed elsewhere");
  await expect(
    page.getByRole("textbox", { name: "Notes", exact: true }),
  ).toHaveValue("My unsent edit");
  await page
    .getByRole("button", { name: "Compare latest saved version" })
    .click();
  await expect(page.locator(".conflict-panel")).toContainText("Remote edit");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Keep my draft against this version" })
    .click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".full-text").first()).toHaveText("My unsent edit");
});
test("designed dashboard uses real counts, completion, search, and responsive themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  const { rows } = await setup(page);
  const seeds: [WorkItem["kind"], string, string, number | null][] = [
    ["task", "Finalize WorkHUB improvements", "In Progress", 1],
    ["task", "Review AI pilot notes", "Next", 2],
    ["task", "Follow up on website roadmap", "Next", null],
    ["task", "Review staffing notes", "Next", null],
    ["project", "WorkHUB", "Active", null],
    ["project", "Website redesign", "On Hold", null],
    ["project", "AI Pilot", "Active", null],
    ["reminder", "Prepare for the leadership sync", "Active", null],
    ["waiting", "Vendor implementation estimate", "Active", null],
  ];
  for (const [kind, title, status, focus_slot] of seeds)
    rows.push({
      ...newItem(kind, uid),
      title,
      status,
      focus_slot,
      priority: kind === "task" ? "High" : "Normal",
      due_date: "2020-01-01",
      original_body: "",
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
    });
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Work Day", exact: true }).click();
  await expect(page.locator(".wd-now")).toContainText(
    "Finalize WorkHUB improvements",
  );
  await page.screenshot({
    animations: "disabled",
    path: "test-results/design-dark.png",
    fullPage: true,
  });
  await page.evaluate(() => (window as unknown as { CommandTheme: { setMode: (m: string) => void } }).CommandTheme.setMode("evening"));
await expect(page.locator('html')).not.toHaveClass(/theme-fading/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "evening");
await expect(page.locator('html')).not.toHaveClass(/theme-fading/);
  await page.screenshot({
    animations: "disabled",
    path: "test-results/design-light.png",
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Mark done: Review AI pilot notes",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status").filter({ hasText: "Task completed" })).toBeVisible();
  expect(rows.find((r) => r.title === "Review AI pilot notes")?.status).toBe(
    "Complete",
  );
  await page.getByRole("button", { name: "Capture, search, or ask CMD" }).click();
  await page.getByRole("searchbox", { name: "Search Command" }).fill("Settings");
  await page
    .getByRole("dialog", { name: "Command search" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Work Day", exact: true }).click();
  for (const width of [744, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    await page.screenshot({
      animations: "disabled",
      path: `test-results/design-light-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Workspaces" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close workspaces" }).click();
  }
});

test('global search filters, source links, pagination and archive boundaries',async({page})=>{
 const {rows}=await setup(page)
 for(let i=0;i<30;i++)rows.push({...newItem('task',uid),title:`Spatial record ${i}`,body:'Searchable metadata',tags:['gis'],original_body:'',version:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),completed_at:null})
 rows[0]!.archived=true
 await page.getByRole('button',{name:'Capture, search, or ask CMD'}).click()
 await page.getByRole('searchbox',{name:'Search Command'}).fill('Spatial')
 await expect(page.locator('.search-result')).toHaveCount(25)
 await page.getByRole('button',{name:'Next results'}).click();await expect(page.locator('.search-result')).toHaveCount(4)
 await page.getByText('Filter results',{exact:true}).click()
 await page.getByRole('combobox',{name:'Archive',exact:true}).selectOption('archived');await expect(page.locator('.search-result')).toHaveCount(1)
 await expect(page.locator('.search-result')).toContainText('Archived')
 await page.getByRole('combobox',{name:'Module',exact:true}).selectOption('person');await expect(page.getByText('No matching records. Try fewer words or include archived records.')).toBeVisible()
 await page.getByRole('combobox',{name:'Module',exact:true}).selectOption('task')
 await expect(page.locator('.search-result')).toHaveCount(1)
 for(const width of [1440,744,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:`test-results/search-${width}.png`,animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
 await page.locator('.search-result').click();await expect(page.getByRole('heading',{name:'Spatial record 0'})).toBeVisible()
})

test('workspace export downloads a complete portable archive',async({page})=>{
 const {rows}=await setup(page)
 rows.push({...newItem('project',uid),title:'Portable project',original_body:'',version:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),completed_at:null})
 rows.push({...newItem('task',uid),title:'Linked task',project_id:rows[0]!.id,original_body:'',version:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),completed_at:null})
 await page.getByRole('button',{name:'Settings',exact:true}).click()
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export workspace',exact:true}).click()
 const download=await downloadPromise;expect(download.suggestedFilename()).toMatch(/^command-workspace-.*\.zip$/)
 const {readFile}=await import('node:fs/promises');const {unzipSync,strFromU8}=await import('fflate')
 const files=unzipSync(await readFile((await download.path())!));const snapshot=JSON.parse(strFromU8(files['workspace.json']!))
 expect(snapshot.counts.work_items).toBe(2);expect(snapshot.work_items[1].project_id).toBe(snapshot.work_items[0].id)
 await expect(page.getByRole('status').filter({hasText:'Export ready:'})).toContainText('2 records and 0 verified originals')
})


test('compact project groups reorder persistently, complete safely and show all open Work Day tasks',async({page})=>{
 await page.setViewportSize({width:820,height:1180});
 const {rows,control}=await setup(page);
 const seed=(kind:WorkItem['kind'],title:string,extra:Partial<WorkItem>={})=>{
  const row:WorkItem={...newItem(kind,uid),title,version:1,original_body:'',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),completed_at:null,sort_order:rows.length+1,...extra};rows.push(row);return row;
 };
 const a=seed('project','Alpha'),b=seed('project','Beta');
 seed('task','First task',{project_id:a.id});seed('task','Second task',{project_id:a.id});seed('task','Future task',{project_id:b.id,due_date:'2099-01-01'});
 seed('reminder','Remember the review');seed('waiting','Waiting for the vendor');
 for(let i=0;i<52;i++)seed('task',`Unassigned ${i}`);
 await page.getByRole('button',{name:'Tasks',exact:true}).click();
 await expect(page.locator('.task-group-title').first()).toContainText('Alpha');
 await page.getByRole('button',{name:'Move Second task up',exact:true}).click();
 await expect(page.getByRole('region',{name:'Alpha',exact:true}).locator('.record-title').first()).toHaveText('Second task');
 await page.getByRole('button',{name:'Move Beta up',exact:true}).click();
 await expect(page.locator('.task-group-title').first()).toContainText('Beta');
 await page.reload();
 await expect(page.locator('.task-group-title').first()).toContainText('Beta');
 await expect(page.getByRole('region',{name:'Alpha',exact:true}).locator('.record-title').first()).toHaveText('Second task');
 control.failWrites=true;
 await page.getByRole('button',{name:'Complete Second task',exact:true}).click();
 await expect(page.getByRole('alert')).toBeVisible();
 await expect(page.getByRole('button',{name:'Second task',exact:true})).toBeVisible();
 control.failWrites=false;
 await page.getByRole('button',{name:'Complete Second task',exact:true}).click();
 await expect(page.getByRole('button',{name:'Second task',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Tasks',exact:true}).click();
 await page.evaluate(()=>(window as unknown as {CommandTheme:{setMode:(m:string)=>void}}).CommandTheme.setMode('evening'));
await expect(page.locator('html')).not.toHaveClass(/theme-fading/);
 await expect(page.getByRole('button',{name:'Future task',exact:true})).toBeVisible();
 await expect(page.getByRole('status').filter({hasText:'Loading'})).toHaveCount(0);
 expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 expect((await page.locator('.compact-list > li').first().boundingBox())!.height).toBeLessThan(80);
 await page.screenshot({path:'test-results/compact-tasks-light.png',animations:'disabled'});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/compact-tasks-mobile.png',animations:'disabled'});
});

test('People directory supports email, CSV preview and failed acknowledgement retry, and keeps phone numbers out of view',async({page})=>{
 const {rows,control}=await setup(page);
 await page.getByRole('button',{name:'People',exact:true}).click();
 await page.getByRole('button',{name:'New person',exact:true}).click();
 await page.getByLabel('Full name',{exact:true}).fill('Alex Chen');
 await page.getByLabel('Job title',{exact:true}).fill('GIS Manager');
 await page.getByLabel('Organization',{exact:true}).fill('HCPA');
 await page.getByLabel('Email',{exact:true}).fill('alex@example.org');
 await page.getByLabel('Notes',{exact:true}).fill('GIS liaison');
 await expect(page.getByLabel('Due date',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await expect(page.getByRole('link',{name:'alex@example.org',exact:true})).toHaveAttribute('href','mailto:alex%40example.org');
 await page.getByRole('button',{name:'Import CSV',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'Import people',exact:true});
 const csv='Name,Email,Job Title,Organization,Phone,Notes\nAlex Chen,alex@example.org,Manager,HCPA,,Duplicate\nMorgan Reed,morgan@example.org,Analyst,HCPA,813-555-0111,"Comma, and notes"\nInvalid,bad,Analyst,HCPA,,Invalid email';
 await modal.getByLabel('Choose CSV').setInputFiles({name:'contacts.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await expect(modal.getByRole('button',{name:'Import 1 contacts',exact:true})).toBeEnabled();
 await expect(modal.getByRole('region',{name:'Contact import preview'})).toContainText('Matches an existing contact');
 await expect(modal).toContainText('Invalid email address');
 expect(rows.filter(row=>row.kind==='person')).toHaveLength(1);
 control.loseAck=true;
 await modal.getByRole('button',{name:'Import 1 contacts',exact:true}).click();
 await expect(modal.getByRole('alert')).toContainText('Import was not confirmed');
 await modal.getByRole('button',{name:'Import 1 contacts',exact:true}).click();
 await expect(modal.getByRole('status')).toContainText('already present');
 expect(rows.filter(row=>row.kind==='person')).toHaveLength(2);
 await modal.getByRole('button',{name:'Done',exact:true}).click();
 await expect(page.getByText('813-555-0111')).toHaveCount(0);
 await page.getByRole('searchbox',{name:'Search directory'}).fill('Morgan');
 await expect(page.getByRole('button',{name:'Morgan Reed',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Alex Chen',exact:true})).toHaveCount(0);
 await page.getByRole('searchbox',{name:'Search directory'}).fill('');
 await page.setViewportSize({width:820,height:1180});
 await expect(page.getByRole('button',{name:'Alex Chen',exact:true})).toBeVisible();
 expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 await page.screenshot({path:'test-results/people-ipad.png',animations:'disabled'});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/people-mobile.png',animations:'disabled'});
});


test('returning from another app keeps Tasks and the unsaved editor mounted while access is rechecked',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'Tasks',exact:true}).click();
 await page.getByRole('button',{name:'Capture, search, or ask CMD'}).click();await page.getByRole('button',{name:/^Capture as task/}).click();
 await page.getByLabel('Title',{exact:true}).fill('Keep my place');
 await page.getByRole('textbox',{name:'Notes',exact:true}).fill('Information collected from another app');
 let finishCheck:()=>void=()=>{};
 const held=new Promise<void>(resolve=>{finishCheck=resolve;});
 let requests=0;
 await page.route('**/rest/v1/app_memberships*',async route=>{requests++;await held;await route.fulfill({json:{user_id:uid,active:true}});});
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await expect.poll(()=>requests).toBeGreaterThan(0);
 await expect(page.getByRole('dialog',{name:'New task',exact:true})).toBeVisible();
 await expect(page.getByLabel('Title',{exact:true})).toHaveValue('Keep my place');
 finishCheck();
 await expect(page.getByRole('textbox',{name:'Notes',exact:true})).toHaveValue('Information collected from another app');
 await page.getByRole('button',{name:'Close editor',exact:true}).click();
 await page.reload();
 await expect(page.getByRole('heading',{name:'Tasks',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Capture, search, or ask CMD'}).click();await page.getByRole('button',{name:/^Capture as task/}).click();
 await expect(page.getByLabel('Title',{exact:true})).toHaveValue('Keep my place');
 await page.route('**/rest/v1/app_memberships*',route=>route.fulfill({json:{user_id:uid,active:false}}));
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await expect(page.getByRole('heading',{name:'Access is not enabled.'})).toBeVisible();
 await expect(page.getByRole('dialog',{name:'New task',exact:true})).toHaveCount(0);
});


test('task metadata and same-dialog editing work on Work Day and Tasks', async ({page}) => {
 const {rows,control}=await setup(page);
 rows.push({...newItem('task',uid),title:'Review rollout',priority:'High',status:'In Progress',due_date:'2020-01-01',body:'Check deployment notes',original_body:'',version:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),completed_at:null});
 await page.getByRole('button',{name:'Tasks',exact:true}).click();
 for (const destination of ['Tasks']) {
  await page.getByRole('button',{name:destination,exact:true}).click();
  const row=page.locator('.task-row').filter({hasText:'Review rollout'});
  await expect(row.locator('.task-metadata')).toContainText('High');
  await expect(row.locator('.task-metadata')).toContainText('In Progress');
  await expect(row.locator('.task-metadata')).toContainText('Jan 1, 2020 · Overdue');
  await row.getByRole('button',{name:'Review rollout',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toContainText('Check deployment notes');
  await dialog.evaluate(el=>el.setAttribute('data-dialog-instance','original'));
  await dialog.getByRole('button',{name:'Edit',exact:true}).click();
  await expect(dialog).toHaveAttribute('data-dialog-instance','original');
  await expect(dialog.getByLabel('Title',{exact:true})).toHaveValue('Review rollout');
  await dialog.getByRole('combobox',{name:'Priority',exact:true}).selectOption('Critical');
  control.failWrites=true;
  await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  control.failWrites=false;
  await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Edit',exact:true})).toBeVisible();
  await expect(dialog.getByRole('combobox',{name:'Priority',exact:true})).toHaveValue('Critical');
  await dialog.getByRole('button',{name:'Edit',exact:true}).click();
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('button',{name:'Edit',exact:true})).toBeVisible();
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(row.locator('.task-metadata')).toContainText('Critical');
  rows[0]!.priority='High';
 }
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('.task-metadata')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/task-metadata-mobile.png',fullPage:true});
});


test('task details save priority, due date and status directly and recover from failed writes',async({page})=>{
 const {rows,control}=await setup(page);
 rows.push({...newItem('task',uid),title:'Quick changes',body:'Keep these notes',original_body:'',version:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),completed_at:null});
 await page.getByRole('button',{name:'Tasks',exact:true}).click();
 await page.getByRole('button',{name:'Quick changes',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Task details',exact:true});
 const priority=dialog.getByRole('combobox',{name:'Priority',exact:true});
 const status=dialog.getByRole('combobox',{name:'Status',exact:true});
 const due=dialog.getByLabel('Due date',{exact:true});
 await expect(priority).toHaveValue('Normal');
 await priority.selectOption('High');
 await expect(dialog.getByRole('status')).toHaveText('Saved');
 await due.fill('2026-12-15');await dialog.getByRole('heading',{name:'Quick changes',exact:true}).click();
 await expect(dialog.getByRole('status')).toHaveText('Saved');
 await expect.poll(()=>rows[0]!.due_date).toBe('2026-12-15');
 control.failWrites=true;
 await status.selectOption('Waiting');
 await expect(dialog.getByRole('alert')).toBeVisible();
 await expect(status).toHaveValue('Inbox');
 control.failWrites=false;
 await status.selectOption('In Progress');
 await expect(dialog.getByRole('status')).toHaveText('Saved');
 await due.fill('');await dialog.getByRole('heading',{name:'Quick changes',exact:true}).click();
 await expect.poll(()=>rows[0]!.due_date).toBeNull();
 await expect(dialog.getByRole('status')).toHaveText('Saved');
 expect(rows[0]!.body).toBe('Keep these notes');
 await dialog.getByRole('button',{name:'Edit',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Priority',exact:true})).toHaveValue('High');
 await page.getByRole('button',{name:'Close editor',exact:true}).click();
 await page.setViewportSize({width:390,height:844});
 expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 await page.screenshot({path:'test-results/task-quick-edit-mobile.png'});
 await dialog.getByRole('button',{name:'Close task details',exact:true}).click();
 await expect(page.locator('.task-row')).toContainText('In Progress');
});




test("Work Day reads as one page: headline, Now, replies owed, week and open work, in both themes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { rows } = await setup(page);
  const stamp = new Date().toISOString();
  rows.push(
    { ...newItem("task", uid), title: "Plan the budget", status: "Next", priority: "High", due_date: "2020-01-01", focus_slot: 1, original_body: "", version: 1, created_at: stamp, updated_at: stamp, completed_at: null },
    { ...newItem("task", uid), title: "Tidy the shared drive", status: "Inbox", original_body: "", version: 1, created_at: stamp, updated_at: stamp, completed_at: null },
  );
  await page.route("**/api/microsoft/flagged", (r) => r.fulfill({ json: { messages: [{ id: "m1", conversation_id: "c1", sender: "Pat Lee", subject: "Parcel changes", received_at: stamp, flag_due: null, importance: "high", url: null, capture: null, record_id: null }], truncated: false, window_days: 30, retrievedAt: stamp } }));
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Work Day", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Work Day" })).toContainText("deserve");
  const now = page.locator(".wd-now");
  await expect(now).toContainText("Plan the budget");
  await expect(now).toContainText("Overdue");
  await expect(page.getByText("Pat Lee")).toBeVisible();
  await expect(page.getByRole("tab", { name: /No project/ })).toBeVisible();
  await expect(page.getByRole("tabpanel")).toContainText("Plan the budget");
  await expect(page.getByRole("tabpanel")).not.toContainText("Tidy the shared drive");
  await expect(page.locator(".stat-card, .sitrep-panel")).toHaveCount(0);
  await page.getByRole("button", { name: /Mark done: Plan the budget/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task completed" })).toBeVisible();
  expect(rows.find((r) => r.title === "Plan the budget")?.status).toBe("Complete");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.locator(".wd-dim").first()).toHaveClass(/is-dimmed/);
  await page.getByRole("button", { name: "Focus on", exact: true }).click();
  for (const mode of ["day", "evening"]) {
    await page.evaluate((m) => (window as unknown as { CommandTheme: { setMode: (m: string) => void } }).CommandTheme.setMode(m), mode);
await expect(page.locator('html')).not.toHaveClass(/theme-fading/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
await expect(page.locator('html')).not.toHaveClass(/theme-fading/);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("every page keeps the Stone layout and passes accessibility checks in both themes", async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const { rows } = await setup(page);
  const stamp = new Date().toISOString();
  for (const [kind, title] of [["task", "Plan the budget"], ["project", "GIS modernization"], ["person", "Tatiana English"], ["reminder", "Call vendor"], ["waiting", "Vendor estimate"]] as const)
    rows.push({ ...newItem(kind, uid), title, original_body: "", version: 1, created_at: stamp, updated_at: stamp, completed_at: null });
  for (const mode of ["day", "evening"]) {
    await page.evaluate((m) => (window as unknown as { CommandTheme: { setMode: (m: string) => void } }).CommandTheme.setMode(m), mode);
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    await expect(page.locator("html")).not.toHaveClass(/theme-fading/);
    for (const name of ["task", "project", "person", "reminder", "waiting", "close", "settings"]) {
      await page.goto(name === "close" ? "/close" : `/?page=${name}`);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page.getByText("Loading…")).toHaveCount(0);
      await expect(page.locator(".rail")).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations, `${name} in ${mode}`).toEqual([]);
    }
  }
});

test("Work Day: completing from Now or Open work saves the task and it does not come back", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { rows } = await setup(page);
  const stamp = new Date().toISOString();
  rows.push(
    { ...newItem("task", uid), title: "Plan the budget", status: "Next", priority: "High", due_date: "2020-01-01", focus_slot: 1, original_body: "", version: 1, created_at: stamp, updated_at: stamp, completed_at: null },
    { ...newItem("task", uid), title: "Tidy the shared drive", status: "Inbox", original_body: "", version: 1, created_at: stamp, updated_at: stamp, completed_at: null },
  );
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Work Day", exact: true }).click();
  await expect(page.getByRole("tab", { name: /^Priority/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /No project/ }).click();
  await page.getByRole("button", { name: "Complete task: Tidy the shared drive" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Task completed" })).toBeVisible();
  expect(rows.find((r) => r.title === "Tidy the shared drive")?.status).toBe("Complete");
  await expect(page.locator(".wd-open-row", { hasText: "Tidy the shared drive" })).toHaveCount(0);
  await page.getByRole("button", { name: /Mark done: Plan the budget/ }).first().click();
  await expect.poll(() => rows.find((r) => r.title === "Plan the budget")?.status).toBe("Complete");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Work Day" })).toBeVisible();
  await expect(page.getByText("Plan the budget")).toHaveCount(0);
  await expect(page.getByText("Tidy the shared drive")).toHaveCount(0);
});

test("Stand-up: add, edit, remove, and carry an item over from a past week", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { standup } = await setup(page);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Work Day", exact: true }).click();
  const section = page.getByRole("region", { name: /Stand-up/ });
  await expect(section).toContainText("starts fresh every Tuesday");
  await section.getByPlaceholder("Add something to bring up…").fill("Duo MFA rollout status");
  await page.keyboard.press("Enter");
  await expect(section.getByText("Duo MFA rollout status")).toBeVisible();
  expect(standup).toHaveLength(1);
  expect(new Date(`${standup[0]!.week_start}T12:00:00Z`).getUTCDay()).toBe(2);
  await section.getByRole("button", { name: "Duo MFA rollout status", exact: true }).click();
  await section.getByLabel("Edit stand-up item").fill("Duo MFA rollout: next steps");
  await section.getByRole("button", { name: "Save", exact: true }).click();
  await expect(section.getByText("Duo MFA rollout: next steps")).toBeVisible();
  await section.getByRole("button", { name: "Mark done: Duo MFA rollout: next steps" }).click();
  await expect(section.getByRole("button", { name: "Mark not done: Duo MFA rollout: next steps" })).toHaveAttribute("aria-pressed", "true");
  expect(standup[0]!.done).toBe(true);
  await section.getByRole("button", { name: /^Remove: Duo MFA rollout/ }).click();
  await expect(section.getByText("Duo MFA rollout: next steps")).toHaveCount(0);
  expect(standup).toHaveLength(0);
  standup.push({ id: crypto.randomUUID(), user_id: uid, week_start: "2020-01-07", body: "Barracuda renewal", done: false, carried_from: null, created_at: new Date().toISOString() });
  await section.getByRole("button", { name: "Past weeks" }).click();
  const dialog = page.getByRole("dialog", { name: "Past stand-up weeks" });
  await expect(dialog).toContainText("Jan 7 – Jan 13");
  await dialog.getByRole("button", { name: "Carry over: Barracuda renewal" }).click();
  await expect(dialog.getByText("Carried over")).toBeVisible();
  await dialog.getByRole("button", { name: "Close past weeks" }).click();
  await expect(section.getByText("Barracuda renewal")).toContainText("carried over");
  expect(standup.filter((r) => r.carried_from)).toHaveLength(1);
});

const seed = (rows: WorkItem[], kind: WorkItem["kind"], title: string, extra: Partial<WorkItem> = {}) => {
  const stamp = new Date().toISOString();
  const row = { ...newItem(kind, uid), id: crypto.randomUUID(), title, original_body: "", version: 1, created_at: stamp, updated_at: stamp, completed_at: null, ...extra } as WorkItem;
  rows.push(row);
  return row;
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

test("Close the Day: finish, move and drop with one tap each, pick tomorrow's first item, and get a receipt", async ({ page }) => {
  await page.setViewportSize({ width: 744, height: 1133 });
  const { rows, closes, closeCalls } = await setup(page);
  const today = daysAgo(0);
  const due = seed(rows, "task", "Send the budget memo", { due_date: today, status: "Next" });
  const roll = seed(rows, "task", "Review vendor quote", { due_date: daysAgo(2), status: "Next" });
  const datto = seed(rows, "task", "Draft email regarding Datto upgrade", { due_date: daysAgo(24), status: "Inbox" });
  const barracuda = seed(rows, "reminder", "Ensure Barracuda renewal moves forward", { due_date: daysAgo(19), status: "Active", updated_at: new Date(Date.now() - 20 * 86400000).toISOString() });
  const first = seed(rows, "task", "Plan the GIS rollout", { priority: "High", due_date: null, status: "Next" });
  await page.goto("/close");
  await expect(page.getByRole("heading", { name: "Close the Day", level: 1 })).toBeVisible();
  // Stale shows the two old items with a suggestion, not an action already taken.
  const stale = page.locator(".close-section").filter({ hasText: "Stale" });
  await expect(stale).toContainText(datto.title);
  await expect(stale).toContainText(barracuda.title);
  await expect(stale).toContainText("Suggested: Never started and 24 days overdue");
  expect(closeCalls).toHaveLength(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // One tap each.
  const open = page.locator(".close-section").filter({ hasText: "Still open" });
  await open.getByRole("group", { name: `Actions for ${due.title}` }).getByRole("button", { name: "Done" }).click();
  await expect(page.getByText(`Done: ${due.title}`)).toBeVisible();
  await open.getByRole("group", { name: `Actions for ${roll.title}` }).getByRole("button", { name: /^(Tomorrow|Monday)$/ }).click();
  await expect(open).not.toContainText(roll.title);
  await stale.getByRole("button", { name: "Drop it" }).first().click();
  await expect(page.getByText(/Dropped \(archived\)/)).toBeVisible();
  expect(closeCalls.map((c) => (c.p_actions as { op: string }[])[0]!.op)).toEqual(["done", "date", "drop"]);
  expect(rows.find((r) => r.id === datto.id)!.archived).toBe(true);
  expect(rows.find((r) => r.id === datto.id)!.status).toBe("Inbox");
  await page.getByLabel(new RegExp(first.title)).check();
  await page.getByRole("button", { name: "Finish the day" }).click();
  await expect(page.getByRole("heading", { name: "Day closed" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "1 done · 1 moved · 1 dropped" })).toContainText(`First thing tomorrow: ${first.title}`);
  expect(closes.at(-1)).toMatchObject({ first_item_id: first.id, counts: { done: 1, rolled: 1, dropped: 1, converted: 0 } });
  expect(rows.find((r) => r.id === first.id)!.focus_slot).toBe(1);
});

test("Close the Day: a stale record is reported plainly and nothing is half applied", async ({ page }) => {
  const { rows, control } = await setup(page);
  const task = seed(rows, "task", "Edited elsewhere", { due_date: daysAgo(0), status: "Next" });
  await page.goto("/close");
  control.failWrites = true;
  await page.locator(".close-section").filter({ hasText: "Still open" }).getByRole("group", { name: `Actions for ${task.title}` }).getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("alert")).toContainText("Something changed since you opened Close the Day");
  control.failWrites = false;
  expect(rows.find((r) => r.id === task.id)!.status).toBe("Next");
});

test("Projects keeps Proposed projects in their own collapsed group below the rest", async ({ page }) => {
  const { rows } = await setup(page);
  seed(rows, "project", "Active project", { status: "Active" });
  seed(rows, "project", "Paused project", { status: "On Hold" });
  seed(rows, "project", "Variance maps idea", { status: "Proposed" });
  await page.getByRole("button", { name: "Projects", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Active project", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Paused project", exact: true })).toBeVisible();
  const group = page.locator("details.proposed-group");
  await expect(group.locator(":scope > summary")).toContainText("Proposed");
  await expect(group).not.toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: "Variance maps idea", exact: true })).toBeHidden();
  await group.locator(":scope > summary").click();
  await expect(page.getByRole("button", { name: "Variance maps idea", exact: true })).toBeVisible();
});

test("a person shows what they owe me and what I owe them, and keeps phone numbers out of view", async ({ page }) => {
  const { rows } = await setup(page);
  const person = seed(rows, "person", "Alex Chen", { person_role: "GIS Manager", organization: "HCPA", details: { email: "alex@example.org", phone: "813-555-0100" } });
  seed(rows, "waiting", "Parcel export from Alex", { status: "Active", person_id: person.id });
  seed(rows, "task", "Send Alex the schema", { status: "Next", person_id: person.id });
  seed(rows, "reminder", "Call Alex Friday", { status: "Active", person_id: person.id });
  await page.goto(`/?record=${person.id}`);
  const owe = page.getByRole("heading", { name: "They owe me" });
  await expect(owe).toBeVisible();
  await expect(page.locator("#ctx-waiting").locator("xpath=..")).toContainText("Parcel export from Alex");
  await expect(page.getByRole("heading", { name: "I owe them" })).toBeVisible();
  const mine = page.locator("#ctx-owe").locator("xpath=..");
  await expect(mine).toContainText("Send Alex the schema");
  await expect(mine).toContainText("Call Alex Friday");
  await expect(page.getByText("813-555-0100")).toHaveCount(0);
});

test("Work Day names the SITREP source that was the problem", async ({ page }) => {
  const { rows } = await setup(page);
  void rows;
  await page.route("**/rest/v1/sitrep_runs*", (r) =>
    r.fulfill({ json: [{ run_id: uid, for_date: daysAgo(0), run_slot: "am", status: "partial", started_at: new Date().toISOString(), generated_at: new Date().toISOString(), sources: { command: "ok", calendar: "ok", mail: "ok", teams: "failed", helix: "partial", flagged: "ok" }, payload: null, error_note: null }] }),
  );
  await page.reload();
  await expect(page.locator(".wd-sitrep-status")).toContainText(/SITREP is partial: Teams unavailable, Helix incomplete (this morning|this afternoon|this evening)\./);
});
