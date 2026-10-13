const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { it } = require("node:test");
const vm = require("node:vm");

it("renders stored business text safely in every OS table and member option", async () => {
  const html = await readFile(path.join(__dirname, "../server/views/os.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "The Business OS client script must exist");
  const attack = '\"><img src=x onerror="globalThis.compromised=true">&\'';
  const dashboard = {
    totals: {},
    members: [{ id: attack, name: attack }],
    accounts: [{
      business_members: { name: attack }, label: attack, account_type: attack,
      apr_percent: attack, available_to_business: 10, business_balance: 5,
    }],
    deals: [{ deal_code: attack, title: attack, ownership_type: attack, status: attack, total_cost: 10 }],
    consignments: [{ item_name: attack, partner_name: attack, payout_status: attack }],
    expenses: [{ expense_date: attack, description: attack, category: attack, amount: 10 }],
    referralPrograms: [{ name: attack }],
  };
  const elements = new Map();
  // Mirror only elements present in the real page. Inventing missing elements
  // would hide runtime failures caused by stale or incorrect DOM selectors.
  const markup = html.replace(/<script>[\s\S]*?<\/script>/g, "");
  for (const match of markup.matchAll(/<[^>]*\bid=["']([^"']+)["'][^>]*>/g)) {
    elements.set(`#${match[1]}`, {
      innerHTML: "", textContent: "", classList: { add() {}, remove() {} },
    });
  }
  const requests = [];
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        return elements.get(selector) || null;
      },
      querySelectorAll() { return []; },
    },
    async fetch(url) {
      requests.push(url);
      assert.equal(url, "/api/os/dashboard");
      return { ok: true, async json() { return dashboard; } };
    },
  });
  // The inline script's final expression is load(), so await the actual render.
  await vm.runInContext(script, context, { timeout: 1000 });
  assert.deepEqual(requests, ["/api/os/dashboard"], "Initial page load must fetch the dashboard");
  assert.match(elements.get("#metric-grid")?.innerHTML || "", /Buying capacity/, "Initial dashboard render must finish");

  for (const selector of [
    "#capacity-table", "#recent-deals", "#funding-member", "#funding-table",
    "#deals-table", "#consignment-table", "#expenses-table", "#referral-table",
  ]) {
    const rendered = elements.get(selector)?.innerHTML;
    assert.ok(rendered, `${selector} must render business data`);
    assert.ok(!rendered.includes(attack), `${selector} must not contain unescaped stored markup`);
    assert.doesNotMatch(rendered, /<img\b|<script\b/i, selector);
    assert.match(rendered, /&lt;img/, selector);
    assert.match(rendered, /&quot;/, selector);
    assert.match(rendered, /&amp;/, selector);
    assert.match(rendered, /&#39;/, selector);
  }
  assert.equal(context.compromised, undefined);
  assert.equal(elements.get("#schema-warning")?.textContent, "", "Rendering must not fail");
});
