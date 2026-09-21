import AxeBuilder from '@axe-core/playwright';
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
const userId = "11111111-1111-4111-8111-111111111111";
const user = {
  id: userId,
  aud: "authenticated",
  role: "authenticated",
  email: "owner@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
  is_anonymous: false,
};
const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.synthetic`;
async function mockBackend(
  page: Page,
  options: {
    approved?: boolean;
    wrongPassword?: boolean;
    revoked?: boolean;
  } = {},
) {
  await page.route("**/api/microsoft/status", route => route.fulfill({ json: { configured: false, connected: false } }));
  let preferences = {
    user_id: userId,
    theme: "dark",
    timezone: "America/New_York",
    version: 1,
    updated_at: "2026-09-21T12:00:00Z",
  };
  await page.route("https://command-test.supabase.co/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/token") {
      if (options.wrongPassword)
        return route.fulfill({
          status: 400,
          json: {
            error: "invalid_grant",
            error_description: "Invalid login credentials",
          },
        });
      return route.fulfill({
        json: {
          access_token: token,
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: "synthetic-refresh",
          user,
        },
      });
    }
    if (url.pathname === "/auth/v1/user") return route.fulfill({ json: user });
    if (url.pathname === "/rest/v1/app_memberships")
      return route.fulfill({
        json:
          options.approved === false || options.revoked
            ? null
            : { user_id: userId, active: true },
      });
    if (url.pathname === "/rest/v1/work_items")
      return route.fulfill({ json: [] });
    if (url.pathname === "/rest/v1/user_preferences") {
      if (route.request().method() === "PATCH")
        preferences = {
          ...preferences,
          ...route.request().postDataJSON(),
          version: preferences.version + 1,
        };
      return route.fulfill({ json: preferences });
    }
    if (
      url.pathname === "/auth/v1/logout" ||
      url.pathname === "/auth/v1/recover"
    )
      return route.fulfill({ json: {} });
    return route.fulfill({
      status: 404,
      json: { error: "Unexpected test request" },
    });
  });
}
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-password-for-test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
test("Microsoft connection settings, callback, source prompts and disconnect", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockBackend(page);
  let connected = true;
  await page.route("**/api/microsoft/status", route => route.fulfill({ json: { configured: true, connected, email: user.email } }));
  await page.route("**/api/microsoft/disconnect", route => { connected = false; return route.fulfill({ json: { connected: false } }); });
  await page.route("**/api/cora/history*", route => route.fulfill({ json: { conversations: [] } }));
  await login(page);
  await expect(page.getByRole("heading", { name: "Work Day", exact: true })).toBeVisible();
  await page.goto("/?page=settings&microsoft=connected");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  const panel = page.getByRole("region", { name: "Microsoft 365" });
  await expect(panel).toContainText("Connected as owner@example.test");
  await expect(page).not.toHaveURL(/microsoft=/);
  for (const theme of ["dark", "light"]) {
    await page.getByRole("combobox", { name: "Appearance" }).selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect((await new AxeBuilder({ page }).include(".microsoft-panel").analyze()).violations).toEqual([]);
    await panel.screenshot({ path: `test-results/microsoft-${theme}.png` });
  }
  await panel.getByRole("button", { name: "Help me prepare for my next meeting." }).click();
  await expect(page.getByRole("textbox", { name: "Ask Cora" })).toHaveValue("Help me prepare for my next meeting.");
  await page.getByRole("button", { name: "Close Cora" }).click();
  await panel.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(panel).toContainText("stored Microsoft credentials have been removed");
  await expect(panel.getByRole("button", { name: "Connect Microsoft 365", exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: "test-results/microsoft-mobile.png" });
});
test("Microsoft outages do not prevent settings or ordinary workspace access", async ({ page }) => {
  await mockBackend(page);
  await page.route("**/api/microsoft/status", route => route.fulfill({ status: 503, json: { message: "Unavailable" } }));
  await login(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("region", { name: "Microsoft 365" })).toContainText("status is unavailable");
  await page.getByRole("combobox", { name: "Appearance" }).selectOption("light");
  await page.getByRole("button", { name: "Work Day", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Work Day", exact: true })).toBeVisible();
});
test("sign in, save preference, reload, and sign out", async ({ page }) => {
  await mockBackend(page);
  await login(page);
  await expect(page.getByRole("heading", { name: "Work Day" })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Appearance" })
    .selectOption("light");
  await expect(page.getByRole("status")).toHaveText("Appearance saved.");
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Appearance" })).toHaveValue(
    "light",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome to Command." }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Welcome to Command." }),
  ).toBeVisible();
});
test("authenticated but unapproved account never sees workspace", async ({
  page,
}) => {
  await mockBackend(page, { approved: false });
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Access is not enabled." }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Appearance" })).toHaveCount(
    0,
  );
});
test("invalid credentials receive a generic error", async ({ page }) => {
  await mockBackend(page, { wrongPassword: true });
  await login(page);
  await expect(page.getByRole("alert")).toContainText("Unable to sign in.");
});
test("email recovery is deferred and administrator help is shown", async ({
  page,
}) => {
  await mockBackend(page);
  await page.goto("/");
  await expect(
    page.getByText(
      "For help with your password, contact the application administrator.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Forgot your password?" }),
  ).toHaveCount(0);
});
test("lost authorization on reload removes private UI", async ({ page }) => {
  const options = { approved: true, revoked: false };
  await mockBackend(page, options);
  await login(page);
  await expect(page.getByRole("heading", { name: "Work Day" })).toBeVisible();
  options.revoked = true;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Access is not enabled." }),
  ).toBeVisible();
});
for (const width of [390, 744, 1133]) {
  test(`sign-in fits ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mockBackend(page);
    await page.goto("/");
    await expect(page.getByLabel("Email")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [390, 844],
  [1440, 900],
]) {
  test(`workspace navigation fits ${width} by ${height}`, async ({ page }) => {
    await page.setViewportSize({ width: width!, height: height! });
    await mockBackend(page);
    await login(page);
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/shell-${width}.png`,
      fullPage: true,
    });
    if (
      await page.getByRole("button", { name: "More", exact: true }).isVisible()
    )
      await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("combobox", { name: "Appearance" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Work Day", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Work Day" })).toBeVisible();
  });
}
test("connection loss is visible and reduced motion disables transitions", async ({
  page,
  context,
}) => {
  await mockBackend(page);
  await login(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .getByRole("button", { name: "Settings", exact: true })
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  await context.setOffline(true);
  await expect(
    page.getByText("You’re offline. Reconnect to load or save your workspace."),
  ).toBeVisible();
});

test("workspace remains usable with doubled text size", async ({ page }) => {
  await page.setViewportSize({ width: 744, height: 1133 });
  await mockBackend(page);
  await login(page);
  await expect(page.getByRole("heading", { name: "Work Day" })).toBeVisible();
  await page.addStyleTag({
    content:
      "html { font-size: 200%; } h1 { font-size: 3rem; } p, button { font-size: 1rem; }",
  });
  if (await page.getByRole("button", { name: "More", exact: true }).isVisible())
    await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Appearance" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('WCAG automated checks cover both themes, mobile navigation, search and settings',async({page})=>{
 await mockBackend(page);await login(page);await expect(page.locator('.day-stats')).toBeVisible()
 for(const theme of ['dark','light']){
  if(theme==='light'){await page.getByRole('button',{name:'Switch color theme'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light')}
  await page.evaluate(()=>Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>undefined))))
  const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(scan.violations).toEqual([])
 }
 await page.getByRole('button',{name:'Search Command'}).click();await page.getByText('Filter results',{exact:true}).click()
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([])
 await page.getByRole('button',{name:'Close search'}).click()
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'More',exact:true}).click()
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([])
 await page.getByRole('button',{name:'Settings',exact:true}).click()
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([])
})

test('Cora streams, preserves page context, and creates a task only through its reviewed card',async({page})=>{
 await mockBackend(page);await page.route('**/api/cora/history*',r=>r.fulfill({json:{conversations:[],turns:[]}}))
 let actions=0;let turn:Record<string,unknown>={}
 await page.route('**/api/cora/chat',async route=>{
  const request=route.request().postDataJSON();expect(request.context.page).toBe('project');expect(request).not.toHaveProperty('userId')
  turn={id:request.requestId,user_id:userId,conversation_id:request.conversationId,message:request.message,context:request.context,response:'Ready to add. Review the task below, then choose Add task.',sources:[{id:'outlook:fixture',title:'Vendor message',kind:'outlook_mail',url:'https://outlook.office.com/mail/id/fixture'},{id:'outlook:unsafe',title:'Unsafe source',kind:'outlook_mail',url:'javascript:alert(1)'}],proposal:{title:'Follow up with Erik',due_date:'2026-09-22',priority:'Normal',project_id:null},task_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',status:'complete',action_status:'proposed',created_at:new Date().toISOString(),finished_at:new Date().toISOString()}
  await route.fulfill({contentType:'application/x-ndjson',body:[{type:'status',message:'Thinking it through…'},{type:'delta',text:'Ready to add.'},{type:'complete',turn}].map(e=>JSON.stringify(e)).join('\n')+'\n'})
 })
 await page.route('**/api/cora/action',r=>{actions++;expect(r.request().postDataJSON()).toEqual({turnId:turn.id});return r.fulfill(actions===1?{status:409,json:{message:'Task creation was not confirmed. Retry this same card.'}}:{json:{taskId:turn.task_id,created:true}})})
 await login(page);await page.getByRole('button',{name:'Ask Cora',exact:true}).click();const panel=page.getByRole('dialog',{name:'Cora',exact:true});await expect(panel).toBeVisible()
 await page.getByRole('button',{name:'Projects',exact:true}).click()
 await panel.getByRole('textbox',{name:'Ask Cora',exact:true}).fill('Add a task for tomorrow to follow up with Erik.')
 await panel.getByRole('button',{name:'Send to Cora'}).click();await expect(panel.getByRole('heading',{name:'Follow up with Erik'})).toBeVisible();expect(actions).toBe(0)
 await panel.locator('summary').filter({hasText:'Sources'}).click()
 await expect(panel.getByRole('link',{name:'Vendor message'})).toHaveAttribute('href','https://outlook.office.com/mail/id/fixture')
 await expect(panel.getByRole('link',{name:'Vendor message'})).toHaveAttribute('rel','noopener noreferrer')
 await expect(panel.getByText('Unsafe source')).toHaveCount(0)
 await panel.getByRole('button',{name:'Add task',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('not confirmed');await expect(panel.getByText('Task created',{exact:true})).toHaveCount(0)
 await panel.getByRole('button',{name:'Add task',exact:true}).click();await expect(panel.getByText('Task created',{exact:true})).toBeVisible();expect(actions).toBe(2)
 for(const theme of ['dark','light']){
  if(theme==='light')await page.getByRole('button',{name:'Switch color theme'}).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme)
  await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>undefined))))
  expect((await new AxeBuilder({page}).include('.cora-panel').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([])
  await page.screenshot({path:`test-results/cora-${theme}.png`})
 }
 await panel.getByRole('button',{name:'Close Cora'}).click();await expect(page.getByRole('heading',{name:'Projects',exact:true})).toBeVisible()
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Ask Cora',exact:true}).click();await expect(panel).toBeVisible();await expect(panel.getByText('Task created',{exact:true})).toBeVisible()
 await page.screenshot({path:'test-results/cora-mobile.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await panel.getByRole('button',{name:'Close Cora'}).click();await expect(page.getByRole('button',{name:'Ask Cora',exact:true})).toBeFocused()
})
