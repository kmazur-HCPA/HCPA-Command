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
  await page.route('**/rest/v1/cora_workday_reviews*',r=>r.fulfill({json:[]}));
  await page.route('**/rest/v1/cora_review_preferences*',r=>r.fulfill({json:{automatic_reminders:false}}));
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
  let theme = "dark";
  await page.route("https://command-test.supabase.co/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      p = url.searchParams,
      method = request.method();
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
        .filter((r) => r.kind === "journal")
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
  return { rows, control, history };
}
test("create a task, choose a priority, edit, and complete it", async ({
  page,
}) => {
  const { rows } = await setup(page);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "New task", exact: true }).click();
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
      .locator(".focus-panel")
      .getByRole("button", { name: "Review architecture" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Complete Review architecture", exact: true }).click();
  await page.getByRole("combobox",{name:"Filter status",exact:true}).selectOption("Complete");
  await expect(page.locator(".record-meta")).toContainText("Complete");
});
test("capture survives failed save and reload, then a lost acknowledgement produces one entry", async ({
  page,
}) => {
  const { rows, control } = await setup(page);
  await page
    .getByRole("button", { name: "Quick Capture", exact: true })
    .click();
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
  await page
    .getByRole("button", { name: "Quick Capture", exact: true })
    .click();
  await expect(page.getByLabel("What’s on your mind?")).toHaveValue(
    "  Keep the original words.\nSecond line.  ",
  );
  control.failWrites = false;
  control.loseAck = true;
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Journal", exact: true }),
  ).toBeVisible();
  expect(rows.filter((r) => r.kind === "journal")).toHaveLength(1);
  expect(rows[0]?.original_body).toBe(
    "  Keep the original words.\nSecond line.  ",
  );
});
test("journal revisions preserve original text and drafts block logout until deliberately discarded", async ({
  page,
}) => {
  const { history } = await setup(page);
  await page
    .getByRole("button", { name: "Quick Capture", exact: true })
    .click();
  await page.getByLabel("What’s on your mind?").fill("Original decision");
  await page.getByRole("button", { name: "Save capture", exact: true }).click();
  await page
    .getByRole("button", { name: "Original decision", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("Revised decision");
  await page.getByLabel("Entry type").selectOption("Decision");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Original entry", { exact: true }).click();
  await expect(
    page.locator("details").filter({ hasText: "Original entry" }),
  ).toContainText("Original decision");
  expect(history).toHaveLength(2);
  await page
    .getByRole("button", { name: "Quick Capture", exact: true })
    .click();
  await page.getByLabel("What’s on your mind?").fill("Unsent note");
  await page
    .getByRole("button", { name: "Close · keep draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("unsaved local drafts");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to Command." }),
  ).toBeVisible();
});
test("reminder remains visible after its due time and converts explicitly", async ({
  page,
}) => {
  const { rows } = await setup(page);
  await page
    .getByRole("button", { name: "All reminders", exact: true })
    .click();
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
  await page.getByRole("button", { name: "New task", exact: true }).click();
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
test("a decision links to a project and generates a traceable task", async ({
  page,
}) => {
  const { rows } = await setup(page);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Service improvement");
  await page
    .getByRole("textbox", { name: "Goals", exact: true })
    .fill("Reduce interruptions");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("button", { name: "New journal", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Adopt the new process");
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("Evidence and reasoning");
  await page
    .getByRole("combobox", { name: "Entry type", exact: true })
    .selectOption("Decision");
  await page.getByText("Links and context", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption(rows[0]!.id);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Adopt the new process", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Service improvement", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create resulting task" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const task = rows.find((r) => r.kind === "task")!;
  expect(task.source_entry_id).toBe(rows.find((r) => r.kind === "journal")!.id);
  expect(task.project_id).toBe(rows[0]!.id);
  await expect(
    page.getByRole("link", { name: "Adopt the new process", exact: true }),
  ).toBeVisible();
});

test("learning connects to an experiment and a recorded decision", async ({
  page,
}) => {
  const { rows } = await setup(page);
  await page.getByRole("button", { name: "Learning", exact: true }).click();
  await page.getByRole("button", { name: "New learning", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Evaluation course");
  await page.getByLabel("Progress (%)", { exact: true }).fill("100");
  await page
    .getByLabel("Key takeaways", { exact: true })
    .fill("Use representative synthetic examples");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "AI Lab", exact: true }).click();
  await page.getByRole("button", { name: "Experiments", exact: true }).click();
  await page
    .getByRole("button", { name: "New experiment", exact: true })
    .click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Compare evaluation methods");
  await page
    .getByLabel("Hypothesis", { exact: true })
    .fill("A rubric improves agreement");
  await page.getByLabel("Conclusion", { exact: true }).fill("Adopt rubric");
  await page.getByText("Links and context", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Learning source", exact: true })
    .selectOption(rows[0]!.id);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Journal", exact: true }).click();
  await page.getByRole("button", { name: "New journal", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Use the rubric");
  await page
    .getByRole("combobox", { name: "Entry type", exact: true })
    .selectOption("Decision");
  await page.getByText("Links and context", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Experiment", exact: true })
    .selectOption(rows.find((r) => r.kind === "experiment")!.id);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Use the rubric", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Compare evaluation methods", exact: true }),
  ).toBeVisible();
  expect(rows.find((r) => r.kind === "experiment")!.learning_id).toBe(
    rows[0]!.id,
  );
});
test("Library preserves metadata links and recovers an interrupted original upload", async ({
  page,
}) => {
  const { rows } = await setup(page);
  const versions: Record<string, unknown>[] = [];
  let fail = true;
  await page.route(
    "https://command-test.supabase.co/rest/v1/library_versions*",
    (route) => route.fulfill({ json: versions }),
  );
  await page.route(
    "https://command-test.supabase.co/functions/v1/library",
    async (route) => {
      if (
        route.request().headers()["content-type"]?.includes("application/json")
      )
        return route.fulfill({
          contentType: "application/octet-stream",
          body: "Synthetic original",
        });
      const raw = route.request().postDataBuffer()!.toString(),
        id = raw.match(/name="id"\r\n\r\n([^\r]+)/)![1]!;
      if (!versions.length)
        versions.push({
          id,
          user_id: uid,
          document_id: rows.find((r) => r.kind === "library")!.id,
          filename: "reference.txt",
          media_type: "text/plain",
          size_bytes: 18,
          sha256: "a".repeat(64),
          state: "pending",
          created_at: new Date().toISOString(),
        });
      if (fail) {
        fail = false;
        return route.fulfill({
          status: 503,
          json: {
            error:
              "Original uploaded; finalization is pending. Retry the same version and file.",
          },
        });
      }
      expect(id).toBe(versions[0]!.id);
      versions[0]!.state = "ready";
      return route.fulfill({ json: versions[0] });
    },
  );
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "New library", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Reference document");
  await page
    .getByRole("combobox", { name: "Classification", exact: true })
    .selectOption("Internal");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "Reference document", exact: true })
    .click();
  const fixture = {
    name: "reference.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic original"),
  };
  await page.getByLabel("Choose original file").setInputFiles(fixture);
  await page
    .getByRole("button", { name: "Upload new version", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "finalization is pending",
  );
  await page.reload();
  await expect(
    page.getByText("Pending attempt:", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Choose original file").setInputFiles(fixture);
  await page.getByRole("button", { name: "Retry upload", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Original verified and saved",
  );
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download original", exact: true })
    .click();
  expect((await downloaded).suggestedFilename()).toBe("reference.txt");
  expect(versions).toHaveLength(1);
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
    ["learning", "Designing better public services", "In Progress", null],
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
  await expect(page.locator(".stat-card").first()).toContainText("4");
  await expect(page.locator(".focus-panel")).toContainText(
    "Finalize WorkHUB improvements",
  );
  await page.screenshot({
    animations: "disabled",
    path: "test-results/design-dark.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Switch color theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    animations: "disabled",
    path: "test-results/design-light.png",
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "Complete Review AI pilot notes",
      exact: true,
    })
    .click();
  await expect(page.locator(".stat-card").first()).toContainText("3");
  expect(rows.find((r) => r.title === "Review AI pilot notes")?.status).toBe(
    "Complete",
  );
  await page.getByRole("button", { name: "Search Command" }).click();
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
 await page.getByRole('button',{name:'Search Command',exact:true}).click()
 await page.getByRole('searchbox',{name:'Search Command'}).fill('Spatial')
 await expect(page.locator('.search-result')).toHaveCount(25)
 await page.getByRole('button',{name:'Next results'}).click();await expect(page.locator('.search-result')).toHaveCount(4)
 await page.getByText('Filter results',{exact:true}).click()
 await page.getByRole('combobox',{name:'Archive',exact:true}).selectOption('archived');await expect(page.locator('.search-result')).toHaveCount(1)
 await expect(page.locator('.search-result')).toContainText('Archived')
 await page.getByRole('combobox',{name:'Module',exact:true}).selectOption('learning');await expect(page.getByText('No matching records. Try fewer words or include archived records.')).toBeVisible()
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
 await page.getByRole('button',{name:'Work Day',exact:true}).click();
 await expect(page.getByRole('button',{name:'Future task',exact:true})).toBeVisible();
 await expect(page.locator('.reminders-panel + .waiting-panel')).toBeVisible();
 const radarBox=await page.locator('.reminders-panel').boundingBox(),waitingBox=await page.locator('.waiting-panel').boundingBox();
 expect(waitingBox!.y-radarBox!.y-radarBox!.height).toBeLessThan(24);
 const scroller=page.getByRole('region',{name:'Scrollable tasks',exact:true});
 expect(await scroller.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await page.getByRole('button',{name:'Load more tasks',exact:true}).click();
 await expect(scroller.getByRole('button',{name:'Unassigned 51',exact:true})).toHaveCount(1);
 await scroller.evaluate(el=>el.scrollTop=0);
 await page.screenshot({path:'test-results/compact-ipad-dark.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Tasks',exact:true}).click();
 await page.getByRole('button',{name:'Switch color theme'}).click();
 await expect(page.getByRole('button',{name:'Future task',exact:true})).toBeVisible();
 await expect(page.getByRole('status').filter({hasText:'Loading'})).toHaveCount(0);
 expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 expect((await page.locator('.compact-list > li').first().boundingBox())!.height).toBeLessThan(80);
 await page.screenshot({path:'test-results/compact-tasks-light.png',animations:'disabled'});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/compact-tasks-mobile.png',animations:'disabled'});
});

test('People directory supports contact fields, CSV preview, failed acknowledgement retry and mobile contact links',async({page})=>{
 const {rows,control}=await setup(page);
 await page.getByRole('button',{name:'People',exact:true}).click();
 await page.getByRole('button',{name:'New person',exact:true}).click();
 await page.getByLabel('Full name',{exact:true}).fill('Alex Chen');
 await page.getByLabel('Job title',{exact:true}).fill('GIS Manager');
 await page.getByLabel('Organization',{exact:true}).fill('HCPA');
 await page.getByLabel('Email',{exact:true}).fill('alex@example.org');
 await page.getByLabel('Phone',{exact:true}).fill('813-555-0100');
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
 await page.getByRole('searchbox',{name:'Search directory'}).fill('0111');
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

test('Work Day gives tasks more room and shows calendar, reminders and waiting on in both themes',async({page})=>{
 await page.setViewportSize({width:1600,height:1100});
 const {rows}=await setup(page);
 for(let i=0;i<24;i++)rows.push({...newItem('task',uid),title:`Work item ${i+1}`,original_body:'',version:1,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),completed_at:null});
 let fail=false;
 await page.route('**/api/microsoft/calendar?**',r=>r.fulfill(fail?{status:503,json:{message:'Calendar temporarily unavailable.'}}:{json:{events:[{id:'one',subject:'Leadership sync',start:'2026-09-22T13:00:00.000Z',end:'2026-09-22T14:30:00.000Z',allDay:false,durationMinutes:90},{id:'two',subject:'Planning day',start:'2026-09-22T04:00:00.000Z',end:'2026-09-23T04:00:00.000Z',allDay:true,durationMinutes:1440}],truncated:false,retrievedAt:new Date().toISOString()}}));
 await page.getByRole('button',{name:'Tasks',exact:true}).click();
 await page.getByRole('button',{name:'Work Day',exact:true}).click();
 await expect(page.locator('.calendar-panel')).toContainText('Leadership sync');
 await expect(page.locator('.calendar-panel')).toContainText('9:00 AM');
 await expect(page.locator('.calendar-panel')).toContainText('1h 30m');
 await expect(page.locator('.calendar-panel')).toContainText('All day');
 await expect(page.getByRole('button',{name:'Work item 24',exact:true})).toBeAttached();
 expect((await page.locator('.task-scroll-region').boundingBox())!.height).toBeGreaterThan(650);
 await expect(page.locator('.projects-panel,.learning-panel')).toHaveCount(0);
 await expect(page.locator('.reminders-panel')).toBeVisible();await expect(page.locator('.waiting-panel')).toBeVisible();
 await page.screenshot({animations:'disabled',path:'test-results/workday-expanded-dark.png',fullPage:true});
 await page.getByRole('button',{name:'Switch color theme'}).click();
 await page.screenshot({animations:'disabled',path:'test-results/workday-expanded-light.png',fullPage:true});
 await page.getByRole('combobox',{name:'Calendar range'}).selectOption('7');
 await expect(page.locator('.calendar-panel')).toContainText('Leadership sync');
 expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({animations:'disabled',path:'test-results/workday-expanded-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 fail=true;await page.locator('.calendar-panel').getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(page.locator('.calendar-panel')).toContainText('Calendar temporarily unavailable');
 await expect(page.getByRole('button',{name:'Work item 1',exact:true})).toBeVisible();
});
