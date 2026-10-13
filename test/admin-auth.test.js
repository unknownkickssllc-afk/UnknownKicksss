const assert = require("node:assert/strict");
const { fork } = require("node:child_process");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { before, after, describe, it } = require("node:test");

const root = path.resolve(__dirname, "..");
const testPin = "1357";
const testSecret = "test-only-random-session-key-3d34bc416e077ff2";

async function startServer(overrides = {}) {
  const child = fork(path.join(__dirname, "fixtures", "auth-server.cjs"), [], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      ADMIN_PIN: testPin,
      SESSION_SECRET: testSecret,
      SUPABASE_URL: "https://test-database.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "test-only-fake-service-role-key-never-use-in-production",
      USE_SQLITE: "false",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      STRIPE_PUBLISHABLE_KEY: "",
      ...overrides,
    },
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Test server did not start: ${output}`));
    }, 10000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Test server exited (${code}): ${output}`));
    });
    child.on("message", (message) => {
      if (message.type === "ready") {
        clearTimeout(timer);
        resolve(message.port);
      }
    });
  });
  let messageId = 0;
  return {
    request(url, options = {}) {
      const { headers, ...rest } = options;
      return fetch(`http://127.0.0.1:${port}${url}`, {
        redirect: "manual",
        ...rest,
        headers: { "x-forwarded-proto": "https", ...headers },
      });
    },
    stats() {
      const id = ++messageId;
      return new Promise((resolve) => {
        function listener(message) {
          if (message.type === "stats" && message.id === id) {
            child.off("message", listener);
            resolve(message.databaseCalls);
          }
        }
        child.on("message", listener);
        child.send({ type: "stats", id });
      });
    },
    async close() {
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    },
  };
}

function json(body, cookie) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  };
}

function cookieHeader(response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

function assertPrivate(response) {
  assert.match(response.headers.get("cache-control") || "", /no-store/i);
}

async function login(server) {
  const response = await server.request("/api/admin/login", json({ code: testPin }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  return { response, cookie: cookieHeader(response) };
}

describe("admin authentication through the deployment entry point", () => {
  let server;
  before(async () => { server = await startServer(); });
  after(async () => { await server?.close(); });

  it("rejects private pages and every OS read/write before touching the database", async () => {
    const beforeCalls = await server.stats();
    for (const url of ["/admin/os", "/admin/os/", "/admin/os/analytics", "/admin/os/analytics/"]) {
      const response = await server.request(url);
      assert.equal(response.status, 302, url);
      assert.equal(response.headers.get("location"), "/admin/", url);
      assertPrivate(response);
      assert.doesNotMatch(await response.text(), /Add funding source/);
    }
    const urls = [
      ["GET", "/api/admin/me"],
      ["GET", "/api/admin/products"],
      ["GET", "/api/os/dashboard"],
      ["GET", "/api/os/history"],
      ["PATCH", "/api/os/history/references/fixture-capacity"],
      ["PATCH", "/api/os/history/items/fixture-item"],
      ["PATCH", "/api/os/history/expenses/fixture-expense"],
      ["POST", "/api/os/assistant/draft"],
      ["PATCH", "/api/os/funding-accounts/1"],
      ["PATCH", "/api/os/deals/1"],
      ["PATCH", "/api/os/consignments/1"],
      ["PATCH", "/api/os/expenses/1"],
      ["PATCH", "/api/os/referral-programs/1"],
      ["GET", "/api/os/analytics"],
      ["PUT", "/api/os/analytics/product-costs/1"],
      ["PUT", "/api/os/analytics/item-costs/1"],
      ["POST", "/api/os/funding-accounts"],
      ["POST", "/api/os/deals"],
      ["POST", "/api/os/consignments"],
      ["POST", "/api/os/expenses"],
      ["POST", "/api/os/referral-programs"],
    ];
    for (const [method, url] of urls) {
      const response = await server.request(url, method === "GET" ? {} : { ...json({}), method });
      assert.equal(response.status, 401, `${method} ${url}`);
      assert.deepEqual(await response.json(), { error: "Unauthorized" });
      assertPrivate(response);
    }
    assert.equal(await server.stats(), beforeCalls, "Unauthorized requests must never query business data");
  });

  it("loads automatic analytics from paid orders only and protects cost updates", async () => {
    const { cookie } = await login(server);
    const page = await server.request("/admin/os/analytics", { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Sales over time/);
    assertPrivate(page);
    const response = await server.request("/api/os/analytics?days=30", { headers: { cookie } });
    assert.equal(response.status, 200);
    assertPrivate(response);
    const report = await response.json();
    assert.equal(report.summary.revenue, 100, "pending payments never become revenue");
    assert.equal(report.summary.grossProfit, 60);
    assert.equal(report.summary.orders, 1);
    assert.ok(report.attention.some(a => a.title === "Duplicate payment references need review"));
    assert.equal(report.costs.products[0].unitCost, 20);
    assert.equal(report.daily.length, 30);
    const beforeCalls = await server.stats();
    for (const unitCost of [-1, "20", "", 1.234, null]) {
      const invalid = await server.request("/api/os/analytics/item-costs/1", { ...json({ unitCost }, cookie), method: "PUT" });
      assert.equal(invalid.status, 400);
    }
    assert.equal(await server.stats(), beforeCalls, "invalid costs must not touch the database");
    for (const path of ["product-costs", "item-costs"]) {
      const saved = await server.request(`/api/os/analytics/${path}/1`, { ...json({ unitCost: 19.25 }, cookie), method: "PUT" });
      assert.equal(saved.status, 200);
      assert.deepEqual(await saved.json(), { ok: true });
      assertPrivate(saved);
    }
    const badPeriod = await server.request("/api/os/analytics?days=999", { headers: { cookie } });
    assert.equal(badPeriod.status, 400);
    for (const url of ["/analytics.html", "/admin/analytics.html", "/server/views/analytics.html"]) {
      assert.equal((await server.request(url)).status, 404);
    }
  });

  it("keeps historical source data private and separate from current financial totals", async () => {
    const { cookie } = await login(server);
    const response = await server.request("/api/os/history", { headers: { cookie } });
    assert.equal(response.status, 200);
    assertPrivate(response);
    const history = await response.json();
    assert.equal(history.records[0].confidence, "user_reported");
    assert.equal(history.records[0].value_text, "$120–$180");
    assert.equal(history.sheet.periods[0].label, "June and July");
    assert.equal(history.sheet.periods[0].revenue, 200);
    assert.equal(history.sheet.sourceTitle, "Fixture sheet");
    const dashboard = await (await server.request("/api/os/dashboard", { headers: { cookie } })).json();
    assert.equal(dashboard.totals.buyingCapacity, 0, "historical capacity is not a current account balance");
    const analytics = await (await server.request("/api/os/analytics", { headers: { cookie } })).json();
    assert.equal(analytics.summary.revenue, 100, "period-only spreadsheet history does not create dated paid orders");
    assert.equal(analytics.finance.recordCounts.accounts, 0);
  });

  it("saves admin history edits privately and rejects invalid or stale changes", async () => {
    const { cookie } = await login(server);
    const url = "/api/os/history/references/fixture-capacity";
    const beforeCalls = await server.stats();
    const invalid = await server.request(url, { ...json({ patch: { source_ref: "Replace source" }, expectedUpdatedAt: null }, cookie), method: "PATCH" });
    assert.equal(invalid.status, 400);
    assert.equal(await server.stats(), beforeCalls, "invalid updates must not touch business data");
    const saved = await server.request(url, { ...json({ patch: { detail: "Owner clarification" }, expectedUpdatedAt: null }, cookie), method: "PATCH" });
    assert.equal(saved.status, 200);
    assertPrivate(saved);
    const row = (await saved.json()).row;
    assert.equal(row.detail, "Owner clarification");
    assert.equal(row.editing.original.detail, "Historical buying capacity, not cash");
    assert.ok(row.editing.updatedAt);
    const stale = await server.request(url, { ...json({ patch: { detail: "Stale window" }, expectedUpdatedAt: null }, cookie), method: "PATCH" });
    assert.equal(stale.status, 409);
    assertPrivate(stale);
    const history = await (await server.request("/api/os/history", { headers: { cookie } })).json();
    assert.equal(history.records[0].detail, "Owner clarification");
    assert.equal(history.records[0].source_ref, "Synthetic fixture");
  });

  it("returns JSON for wrong or malformed access codes without issuing a session", async () => {
    for (const [code, status] of [["2468", 401], ["", 400], ["135", 400], ["13579", 400], ["1a357", 400]]) {
      const response = await server.request("/api/admin/login", json({ code }));
      assert.equal(response.status, status, JSON.stringify(code));
      assert.equal(typeof (await response.json()).error, "string");
      assert.equal(response.headers.get("set-cookie"), null);
      assertPrivate(response);
    }
  });

  it("logs in without a database call and issues signed secure cookies behind the Vercel proxy", async () => {
    const beforeCalls = await server.stats();
    const { response, cookie } = await login(server);
    assert.equal(await server.stats(), beforeCalls);
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.match(cookie, /uk_session=/);
    assert.match(cookie, /uk_session\.sig=/);
    for (const setCookie of cookies) {
      assert.match(setCookie, /; httponly/i);
      assert.match(setCookie, /; secure/i);
      assert.match(setCookie, /; samesite=lax/i);
      assert.match(setCookie, /; path=\//i);
    }
    assertPrivate(response);
    const me = await server.request("/api/admin/me", { headers: { cookie } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { authenticated: true });
    assertPrivate(me);
  });

  it("serves Business OS only with authentication and reads back an authenticated write", async () => {
    const { cookie } = await login(server);
    const page = await server.request("/admin/os", { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Add funding source/);
    assertPrivate(page);

    const initial = await server.request("/api/os/dashboard", { headers: { cookie } });
    assert.equal(initial.status, 200);
    const initialData = await initial.json();
    assert.equal(initialData.members[0].name, "Test partner");
    assert.equal(initialData.totals.buyingCapacity, 0);
    assertPrivate(initial);

    const created = await server.request("/api/os/funding-accounts", json({
      label: "Test cash account",
      member_id: 1,
      available_to_business: 250,
      business_balance: 40,
    }, cookie));
    assert.equal(created.status, 200);
    assert.equal((await created.json()).label, "Test cash account");
    assertPrivate(created);
    const updated = await server.request("/api/os/dashboard", { headers: { cookie } });
    const dashboard = await updated.json();
    assert.equal(updated.status, 200);
    assert.equal(dashboard.accounts[0].label, "Test cash account");
    assert.equal(dashboard.totals.buyingCapacity, 250);
    assert.equal(dashboard.totals.businessDebt, 40);
  });

  it("rejects a forged, unsigned, or modified cookie", async () => {
    const { cookie } = await login(server);
    const forged = Buffer.from(JSON.stringify({ adminAuthenticated: true })).toString("base64");
    const cookies = [
      `uk_session=${forged}`,
      cookie.replace(/uk_session\.sig=[^;]+/, "uk_session.sig=invalid-signature"),
      cookie.replace(/uk_session=[^;]+/, `uk_session=${Buffer.from('{"adminAuthenticated":true,"forged":true}').toString("base64")}`),
    ];
    const beforeCalls = await server.stats();
    for (const value of cookies) {
      for (const url of ["/api/admin/me", "/api/os/dashboard"]) {
        const response = await server.request(url, { headers: { cookie: value } });
        assert.equal(response.status, 401, url);
      }
      const page = await server.request("/admin/os", { headers: { cookie: value } });
      assert.equal(page.status, 302);
    }
    assert.equal(await server.stats(), beforeCalls);
  });

  it("clears the browser session on logout and requires login again", async () => {
    const { cookie } = await login(server);
    const response = await server.request("/api/admin/logout", json({}, cookie));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assertPrivate(response);
    assert.ok(response.headers.getSetCookie().some((value) => /^uk_session=;/.test(value)));
    assert.match(response.headers.get("set-cookie"), /expires=Thu, 01 Jan 1970/i);
    const me = await server.request("/api/admin/me");
    assert.equal(me.status, 401);
    const os = await server.request("/api/os/dashboard");
    assert.equal(os.status, 401);
  });

  it("keeps the original storefront public and removes obsolete public OS paths", async () => {
    const response = await server.request("/");
    assert.equal(response.status, 200);
    assert.equal(await response.text(), await readFile(path.join(root, "public/index.html"), "utf8"));
    assert.doesNotMatch(await readFile(path.join(root, "public/index.html"), "utf8"), /href=["'](?:\/os|\/admin\/os)/);
    const { cookie } = await login(server);
    for (const url of ["/os", "/os/", "/os.html", "/admin/os.html", "/server/views/os.html"]) {
      for (const headers of [{}, { cookie }]) {
        const oldPath = await server.request(url, { headers });
        assert.equal(oldPath.status, 404, url);
        assert.doesNotMatch(await oldPath.text(), /Add funding source/);
      }
    }
    const admin = await server.request("/admin/");
    assert.equal(admin.status, 200);
    assert.match(await admin.text(), /id="app"[^>]*hidden/);
  });
});

describe("production configuration fails closed without breaking the storefront", () => {
  for (const [name, overrides] of [
    ["missing ADMIN_PIN", { ADMIN_PIN: "" }],
    ["default ADMIN_PIN", { ADMIN_PIN: "0000" }],
    ["malformed ADMIN_PIN", { ADMIN_PIN: "12345" }],
    ["missing SESSION_SECRET", { SESSION_SECRET: "" }],
    ["placeholder SESSION_SECRET", { SESSION_SECRET: "unknown-kicks-dev-secret-change-me" }],
  ]) {
    it(name, async () => {
      const server = await startServer(overrides);
      try {
        const response = await server.request("/api/admin/login", json({ code: testPin }));
        assert.equal(response.status, 503);
        const body = await response.text();
        assert.equal(typeof JSON.parse(body).error, "string");
        assert.ok(!body.includes(testSecret), "Never return secrets in an error");
        assert.ok(!body.includes(testPin), "Never return the configured PIN");
        assert.equal(response.headers.get("set-cookie"), null);
        assertPrivate(response);
        const storefront = await server.request("/");
        assert.equal(storefront.status, 200);
        assert.equal(await storefront.text(), await readFile(path.join(root, "public/index.html"), "utf8"));
        assert.equal((await server.request("/admin/")).status, 200);
        assert.equal((await server.request("/api/os/dashboard")).status, 503);
        assert.equal(await server.stats(), 0);
      } finally {
        await server.close();
      }
    });
  }
});
