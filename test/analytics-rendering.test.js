const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { it } = require('node:test');
const vm = require('node:vm');

const fixture = () => ({
  period: { days: 30, start: '2026-09-14', end: '2026-10-13', timeZone: 'America/New_York' },
  summary: { revenue: 150, orders: 2, units: 3, aov: 75, cogs: 20, grossProfit: null, grossMargin: null, costCoveragePercent: 33.3, operatingExpenses: 10, referralCommissions: 5, trackedResult: null, allCostsKnown: false, returningCustomerRate: 50 },
  growth: { revenuePercent: 50, ordersPercent: 0, aovPercent: null, grossMarginPoints: null },
  daily: [{ date: '2026-10-11', revenue: 50, grossProfit: 30, orders: 1, expenses: 10 }, { date: '2026-10-12', revenue: 100, grossProfit: null, orders: 1, expenses: 0 }, { date: '2026-10-13', revenue: 0, grossProfit: 0, orders: 0, expenses: 0 }],
  products: [{ id: 'p1', name: 'Test item', units: 3, revenue: 150, grossProfit: null, grossMargin: null, missingCostUnits: 2, stock: 4 }],
  referrals: [{ name: 'Test referral', orders: 1, revenue: 50, commission: 5, netBeforeCosts: 45 }],
  expenseCategories: [{ category: 'Test category', amount: 10 }],
  attention: [{ severity: 'warning', title: 'Missing costs', detail: 'Record item costs before using margins.' }],
  finance: { availableCapital: 100, businessDebt: 50, consignmentPending: 10, consignmentActive: 20 },
  costs: { products: [{ id: 'p1', name: 'Test item', unitCost: 20 }], missingItems: [{ id: 'item1', orderNumber: 'TEST-1', productName: 'Test item', quantity: 2, orderDate: '2026-10-12' }] },
});

async function harness(fetcher = async () => ({ ok: true, json: async () => fixture() })) {
  const html = await readFile(path.join(__dirname, '../server/views/analytics.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'Analytics must include its client script');
  const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  const elements = new Map();
  for (const match of markup.matchAll(/<[^>]*\bid=["']([^"']+)["'][^>]*>/g)) {
    const classes = new Set(match[0].match(/class="([^"]*)"/)?.[1].split(/\s+/) || []);
    elements.set('#' + match[1], {
      innerHTML: '', textContent: '', value: match[1] === 'period' ? '30' : '', disabled: false,
      listeners: {}, focused: false, dirtyNode: null,
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      contains() { return this.focused; },
      querySelector(selector) { assert.equal(selector, '[data-dirty="true"]'); return this.dirtyNode; },
    });
  }
  const requests = [], intervals = [], documentListeners = {}, windowListeners = {};
  const document = {
    hidden: false, activeElement: null,
    querySelector(selector) { return elements.get(selector) || null; },
    addEventListener(type, handler) { documentListeners[type] = handler; },
  };
  const context = vm.createContext({
    document, window: { addEventListener(type, handler) { windowListeners[type] = handler; } },
    async fetch(url, options) { requests.push({ url, options }); return fetcher(url, options); },
    setInterval(handler, ms) { intervals.push({ handler, ms }); return intervals.length; },
  });
  const initial = vm.runInContext(script, context, { timeout: 1000 });
  return { html, context, initial, elements, requests, intervals, document, documentListeners, windowListeners };
}

it('renders real analytics with safe stored text and unknown-cost gaps instead of fabricated profit', async () => {
  const data = fixture(), attack = '\"><img src=x onerror="globalThis.compromised=true">&\'';
  data.products[0].name = attack;
  data.referrals[0].name = attack;
  data.expenseCategories[0].category = attack;
  data.attention[0] = { severity: attack, title: attack, detail: attack };
  data.costs.products[0] = { id: attack, name: attack, unitCost: null };
  data.costs.missingItems[0] = { ...data.costs.missingItems[0], id: attack, orderNumber: attack, productName: attack };
  data.costs.missingItems[0].orderDate = '2026-10-13T02:00:00Z';
  const view = await harness(async () => ({ ok: true, json: async () => data }));
  await view.initial;
  assert.equal(view.requests[0].url, '/api/os/analytics?days=30');
  assert.equal(view.requests[0].options.credentials, 'same-origin');
  assert.equal(view.requests[0].options.cache, 'no-store');
  assert.match(view.elements.get('#metrics').innerHTML, /\$150\.00/);
  assert.match(view.elements.get('#metrics').innerHTML, /Needs costs/);
  assert.match(view.elements.get('#profit-breakdown').innerHTML, /Result from/);
  for (const selector of ['#product-chart', '#product-table', '#referrals', '#expenses', '#attention', '#product-costs', '#item-costs']) {
    const rendered = view.elements.get(selector).innerHTML;
    assert.ok(!rendered.includes(attack), selector + ' must escape stored text');
    assert.doesNotMatch(rendered, /<img\b|<script\b/i, selector);
    assert.match(rendered, /&lt;img/, selector);
    assert.match(rendered, /&quot;/, selector);
    assert.match(rendered, /&amp;/, selector);
    assert.match(rendered, /&#39;/, selector);
  }
  const chart = view.elements.get('#sales-chart').innerHTML;
  assert.match(chart, /role="img"/);
  assert.match(chart, /<title id="sales-chart-title">/);
  const profitPath = chart.match(/<path d="([^"]*)"[^>]*stroke="#9bbcff"/)[1];
  assert.equal((profitPath.match(/M/g) || []).length, 2, 'Missing costs must leave separate profit segments');
  assert.doesNotMatch(profitPath, /L/, 'A line must not connect across the unknown-cost day');
  assert.match(view.elements.get('#daily-table').innerHTML, /Oct 12, 2026/);
  assert.match(view.elements.get('#daily-table').innerHTML, /Needs costs/);
  assert.match(view.elements.get('#item-costs').innerHTML, /Oct 12, 2026/, 'Historical sale dates use Eastern time');
  assert.match(view.elements.get('#missing-cost-period').textContent, /newest 200 shown/);
  assert.match(view.html, /In-person, DM, and consignment sales from your Google Sheet are not included yet/);
  assert.equal(view.elements.get('#error-message').classList.contains('hidden'), true);
  assert.equal(view.context.compromised, undefined);
});

it('shows an honest empty state and distinguishes a known zero margin from missing costs', async () => {
  let data = fixture();
  data.summary = { ...data.summary, revenue: 0, orders: 0, grossMargin: null, grossProfit: 0, trackedResult: -10, allCostsKnown: true };
  data.daily = [];
  const view = await harness(async () => ({ ok: true, json: async () => data }));
  await view.initial;
  assert.match(view.elements.get('#sales-chart').innerHTML, /No paid website orders yet/);
  assert.match(view.elements.get('#metrics').innerHTML, /No paid orders in this period/);
  assert.doesNotMatch(view.elements.get('#metrics').innerHTML, /Needs costs/);
  data = fixture();
  data.summary.grossMargin = 0;
  data.summary.grossProfit = 0;
  data.summary.trackedResult = -15;
  await view.elements.get('#refresh').listeners.click();
  assert.match(view.elements.get('#metrics').innerHTML, /0\.0%/);
  assert.doesNotMatch(view.elements.get('#metrics').innerHTML, /Needs costs/);
});

it('refreshes only while visible, serializes requests, and never replaces a cost input being edited', async () => {
  let release, active = 0, maxActive = 0, count = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const view = await harness(async () => {
    count++; active++; maxActive = Math.max(maxActive, active);
    if (count === 1) await gate;
    active--;
    return { ok: true, json: async () => fixture() };
  });
  assert.equal(view.intervals[0].ms, 60000);
  await view.windowListeners.focus();
  await view.intervals[0].handler();
  assert.equal(view.requests.length, 1, 'Repeated refreshes cannot overlap');
  release();
  await view.initial;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.requests.length, 2, 'Coalesce waiting refreshes into one follow-up');
  assert.equal(maxActive, 1);
  view.elements.get('#product-costs').innerHTML = 'Unsaved input still here';
  view.elements.get('#cost-setup').dirtyNode = {};
  await view.elements.get('#refresh').listeners.click();
  assert.equal(view.elements.get('#product-costs').innerHTML, 'Unsaved input still here');
  view.elements.get('#cost-setup').dirtyNode = null;
  view.elements.get('#cost-setup').focused = true;
  await view.elements.get('#refresh').listeners.click();
  assert.equal(view.elements.get('#product-costs').innerHTML, 'Unsaved input still here');
  view.document.hidden = true;
  const before = view.requests.length;
  await view.intervals[0].handler();
  await view.windowListeners.focus();
  assert.equal(view.requests.length, before, 'Hidden tabs must not poll');
  view.document.hidden = false;
  await view.documentListeners.visibilitychange();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.requests.length, before + 1);
});

it('discards a response for a superseded date range and reloads the newly selected period', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const view = await harness(async url => {
    if (url.endsWith('days=30')) await gate;
    const data = fixture();
    data.period.days = url.endsWith('days=90') ? 90 : 30;
    return { ok: true, json: async () => data };
  });
  view.elements.get('#period').value = '90';
  await view.elements.get('#period').listeners.change();
  release();
  await view.initial;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(view.requests.map(request => request.url), ['/api/os/analytics?days=30', '/api/os/analytics?days=90']);
  assert.match(view.elements.get('#period-label').textContent, /previous 90 days/);
});

it('saves product defaults separately from explicit historical costs and preserves other unsaved inputs', async () => {
  const view = await harness(async (url, options) => ({ ok: true, json: async () => options.method === 'PUT' ? { ok: true } : fixture() }));
  await view.initial;
  function costForm(kind, id, value) {
    const input = { value, dataset: { dirty: 'true' } }, button = { disabled: false }, status = { textContent: '' };
    const form = { dataset: { costKind: kind, costId: id }, querySelector: selector => ({ 'input[name="unitCost"]': input, button, '.cost-status': status })[selector] };
    return { form, input, button, status, event: { preventDefault() {}, target: { closest: () => form } } };
  }
  view.elements.get('#cost-setup').dirtyNode = {};
  view.elements.get('#item-costs').innerHTML = 'Another unsaved historical cost';
  const product = costForm('product', 'product/one', '');
  await view.elements.get('#cost-setup').listeners.submit(product.event);
  await new Promise(resolve => setImmediate(resolve));
  const productRequest = view.requests.find(request => request.options.method === 'PUT');
  assert.equal(productRequest.url, '/api/os/analytics/product-costs/product%2Fone');
  assert.deepEqual(JSON.parse(productRequest.options.body), { unitCost: null });
  assert.equal(product.status.textContent, 'Saved for future orders.');
  assert.equal(view.elements.get('#item-costs').innerHTML, 'Another unsaved historical cost');
  const missing = costForm('item', 'item/one', '');
  const before = view.requests.length;
  await view.elements.get('#cost-setup').listeners.submit(missing.event);
  assert.equal(view.requests.length, before, 'An unknown historical cost cannot be saved as zero');
  missing.input.value = '0';
  await view.elements.get('#cost-setup').listeners.submit(missing.event);
  await new Promise(resolve => setImmediate(resolve));
  const historical = view.requests.find(request => request.url.includes('/item-costs/'));
  assert.equal(historical.url, '/api/os/analytics/item-costs/item%2Fone');
  assert.deepEqual(JSON.parse(historical.options.body), { unitCost: 0 });
  assert.equal(missing.status.textContent, 'Historical cost saved.');
});

it('stops refreshing on session expiry and offers a sign-in link without showing a false success', async () => {
  let authorized = true;
  const view = await harness(async () => authorized ? { ok: true, json: async () => fixture() } : { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) });
  await view.initial;
  assert.match(view.elements.get('#metrics').innerHTML, /\$150\.00/);
  authorized = false;
  await view.elements.get('#refresh').listeners.click();
  assert.equal(view.elements.get('#metrics').innerHTML, '', 'Previously loaded private data clears when the session expires');
  assert.equal(view.elements.get('#product-costs').innerHTML, '');
  assert.equal(view.elements.get('#auth-warning').classList.contains('hidden'), false);
  assert.equal(view.elements.get('#refresh').disabled, true);
  assert.equal(view.elements.get('#period').disabled, true);
  assert.match(view.elements.get('#update-status').textContent, /Updates paused/);
  await view.intervals[0].handler();
  await view.windowListeners.focus();
  assert.equal(view.requests.length, 2);
  assert.match(view.html, /href="\/admin\/">Sign in to continue/);
});
