(function () {
  const loginScreen = document.getElementById("login-screen");
  const app = document.getElementById("app");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");
  const viewRoot = document.getElementById("view-root");
  const viewTitle = document.getElementById("view-title");
  const adminEmail = document.getElementById("admin-email");

  let currentView = "overview";

  async function api(path, opts = {}) {
    const isForm = opts.body instanceof FormData;
    const headers = isForm ? {} : { "Content-Type": "application/json" };
    const r = await fetch(`/api/admin${path}`, {
      method: opts.method || (opts.body ? "POST" : "GET"),
      credentials: "same-origin",
      headers: { ...headers, ...opts.headers },
      body: isForm ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    const fd = new FormData(loginForm);
    try {
      await api("/login", { method: "POST", body: { email: fd.get("email"), password: fd.get("password") } });
      showApp();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.hidden = false;
    }
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await api("/logout", { method: "POST" });
    app.hidden = true;
    loginScreen.hidden = false;
  });

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      currentView = btn.dataset.view;
      renderView();
    });
  });

  async function showApp() {
    try {
      const me = await api("/me");
      adminEmail.textContent = me.email;
      loginScreen.hidden = true;
      app.hidden = false;
      renderView();
    } catch {
      loginScreen.hidden = false;
      app.hidden = true;
    }
  }

  async function renderView() {
    const titles = {
      overview: "Overview",
      products: "Product Management",
      orders: "Order Management",
      barbers: "Barbers & Referrals",
      content: "Website Content",
    };
    viewTitle.textContent = titles[currentView] || "Admin";
    viewRoot.innerHTML = "<p>Loading…</p>";

    try {
      if (currentView === "overview") await renderOverview();
      else if (currentView === "products") await renderProducts();
      else if (currentView === "orders") await renderOrders();
      else if (currentView === "barbers") await renderBarbers();
      else if (currentView === "content") await renderContent();
    } catch (e) {
      viewRoot.innerHTML = `<p class="error">${e.message}</p>`;
    }
  }

  async function renderOverview() {
    const [orders, products, barbers] = await Promise.all([
      api("/orders"),
      api("/products"),
      api("/barbers"),
    ]);
    const paid = orders.filter((o) => o.payment_status === "paid");
    const revenue = paid.reduce((s, o) => s + o.total, 0);
    viewRoot.innerHTML = `
      <div class="cards">
        <div class="card">Products<strong>${products.length}</strong></div>
        <div class="card">Orders<strong>${orders.length}</strong></div>
        <div class="card">Paid orders<strong>${paid.length}</strong></div>
        <div class="card">Revenue<strong>$${revenue.toFixed(2)}</strong></div>
        <div class="card">Barbers<strong>${barbers.length}</strong></div>
      </div>
      <p>Manage products, orders, barber referral codes, commissions, and homepage content from the sidebar.</p>`;
  }

  async function renderProducts() {
    const [products, categories] = await Promise.all([
      api("/products"),
      api("/categories"),
    ]);

    const catOpts = categories
      .map((c) => `<option value="${c.id}">${c.name}</option>`)
      .join("");

    viewRoot.innerHTML = `
      <div class="panel">
        <h2>Add product</h2>
        <form id="add-product-form" class="form-grid">
          <label>Name <input name="name" required /></label>
          <label>Slug <input name="slug" required placeholder="uk-tee-black" /></label>
          <label>Price <input name="price" type="number" step="0.01" required /></label>
          <label>Category <select name="category_id"><option value="">—</option>${catOpts}</select></label>
          <label>Description <textarea name="description"></textarea></label>
          <label><input type="checkbox" name="sold_out" /> Mark as sold out</label>
          <button type="submit" class="btn">Create product</button>
        </form>
      </div>
      <div class="panel">
        <h2>All products</h2>
        <table>
          <thead><tr><th>Name</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead>
          <tbody id="product-rows"></tbody>
        </table>
      </div>
      <div id="product-editor" class="panel" hidden></div>`;

    const tbody = document.getElementById("product-rows");
    tbody.innerHTML = products
      .map((p) => {
        const stock = p.variants.reduce((s, v) => s + v.stock, 0);
        return `<tr>
          <td>${p.name}</td>
          <td>$${p.price}</td>
          <td>${stock}</td>
          <td>${p.sold_out ? '<span class="badge">Sold out</span>' : "Active"}</td>
          <td><button type="button" class="btn secondary" data-edit="${p.id}">Edit</button>
          <button type="button" class="btn danger" data-del="${p.id}">Delete</button></td>
        </tr>`;
      })
      .join("");

    document.getElementById("add-product-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api("/products", {
        method: "POST",
        body: {
          name: fd.get("name"),
          slug: fd.get("slug"),
          price: parseFloat(fd.get("price")),
          category_id: fd.get("category_id") || null,
          description: fd.get("description"),
          sold_out: fd.get("sold_out") === "on",
        },
      });
      renderProducts();
    };

    tbody.onclick = async (e) => {
      const edit = e.target.closest("[data-edit]");
      const del = e.target.closest("[data-del]");
      if (del && confirm("Delete this product?")) {
        await api(`/products/${del.dataset.del}`, { method: "DELETE" });
        renderProducts();
      }
      if (edit) openProductEditor(products.find((p) => p.id == edit.dataset.edit));
    };
  }

  async function openProductEditor(p) {
    const editor = document.getElementById("product-editor");
    editor.hidden = false;
    editor.innerHTML = `
      <h2>Edit: ${p.name}</h2>
      <form id="edit-product-form" class="form-grid">
        <label>Name <input name="name" value="${esc(p.name)}" required /></label>
        <label>Slug <input name="slug" value="${esc(p.slug)}" required /></label>
        <label>Price <input name="price" type="number" step="0.01" value="${p.price}" required /></label>
        <label>Description <textarea name="description">${esc(p.description)}</textarea></label>
        <label>Shipping info <textarea name="shipping_info">${esc(p.shipping_info || "")}</textarea></label>
        <label><input type="checkbox" name="sold_out" ${p.sold_out ? "checked" : ""} /> Sold out</label>
        <button type="submit" class="btn">Save</button>
      </form>
      <h3>Images</h3>
      <ul>${p.images.map((i) => `<li>${i.url} <button type="button" class="btn danger" data-del-img="${i.id}">Remove</button></li>`).join("")}</ul>
      <form id="upload-img-form"><input type="file" name="image" accept="image/*" required />
        <label><input type="checkbox" name="is_hover" /> Hover image</label>
        <button type="submit" class="btn secondary">Upload image</button></form>
      <h3>Variants (size / color / stock)</h3>
      <table><thead><tr><th>Size</th><th>Color</th><th>Stock</th><th></th></tr></thead>
      <tbody>${p.variants.map((v) => `<tr>
        <td>${v.size}</td><td>${v.color}</td><td>${v.stock}</td>
        <td><button type="button" class="btn danger" data-del-var="${v.id}">Delete</button></td>
      </tr>`).join("")}</tbody></table>
      <form id="add-variant-form" class="form-grid" style="margin-top:1rem">
        <label>Size <input name="size" required /></label>
        <label>Color <input name="color" required /></label>
        <label>Stock <input name="stock" type="number" min="0" value="10" required /></label>
        <button type="submit" class="btn secondary">Add variant</button>
      </form>`;

    document.getElementById("edit-product-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api(`/products/${p.id}`, {
        method: "PUT",
        body: {
          name: fd.get("name"),
          slug: fd.get("slug"),
          price: parseFloat(fd.get("price")),
          description: fd.get("description"),
          shipping_info: fd.get("shipping_info"),
          sold_out: fd.get("sold_out") === "on",
          category_id: p.category_id,
        },
      });
      renderProducts();
    };

    document.getElementById("upload-img-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      fd.append("is_hover", e.target.is_hover.checked ? "1" : "0");
      fd.append("sort_order", String(p.images.length));
      await api(`/products/${p.id}/images`, { method: "POST", body: fd });
      renderProducts();
    };

    document.getElementById("add-variant-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api(`/products/${p.id}/variants`, {
        method: "POST",
        body: {
          size: fd.get("size"),
          color: fd.get("color"),
          stock: parseInt(fd.get("stock"), 10),
        },
      });
      renderProducts();
    };

    editor.onclick = async (e) => {
      const di = e.target.closest("[data-del-img]");
      const dv = e.target.closest("[data-del-var]");
      if (di) {
        await api(`/product-images/${di.dataset.delImg}`, { method: "DELETE" });
        renderProducts();
      }
      if (dv) {
        await api(`/variants/${dv.dataset.delVar}`, { method: "DELETE" });
        renderProducts();
      }
    };
  }

  async function renderOrders() {
    const orders = await api("/orders");
    viewRoot.innerHTML = `
      <table>
        <thead><tr>
          <th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Referral</th><th>Barber</th><th></th>
        </tr></thead>
        <tbody>${orders.map((o) => `<tr>
          <td>${o.order_number}</td>
          <td>${esc(o.customer_name)}<br><small>${esc(o.customer_email)}</small></td>
          <td>$${o.total.toFixed(2)}</td>
          <td><span class="badge ${o.payment_status}">${o.payment_status}</span></td>
          <td>${o.referral_code_text || "—"}</td>
          <td>${o.barber_name || "—"}</td>
          <td><button type="button" class="btn secondary" data-order="${o.id}">View</button></td>
        </tr>`).join("")}</tbody>
      </table>
      <div id="order-detail-panel" class="panel" hidden></div>`;

    viewRoot.querySelector("tbody").onclick = async (e) => {
      const btn = e.target.closest("[data-order]");
      if (!btn) return;
      const o = orders.find((x) => x.id == btn.dataset.order);
      const panel = document.getElementById("order-detail-panel");
      panel.hidden = false;
      const ship = o.shipping;
      panel.innerHTML = `
        <h2>Order ${o.order_number}</h2>
        <dl class="order-detail">
          <dt>Status</dt><dd>${o.status} · Payment: ${o.payment_status}</dd>
          <dt>Customer</dt><dd>${esc(o.customer_name)} · ${esc(o.customer_email)} · ${esc(o.customer_phone || "—")}</dd>
          <dt>Shipping</dt><dd>${esc(ship.line1)}, ${esc(ship.city)}, ${esc(ship.state)} ${esc(ship.zip)}, ${esc(ship.country)}</dd>
          <dt>Products</dt><dd><ul>${o.items.map((i) => `<li>${i.product_name} — ${i.size}/${i.color} ×${i.quantity} $${i.line_total}</li>`).join("")}</ul></dd>
          <dt>Referral code</dt><dd>${o.referral_code_text || "None"}</dd>
          <dt>Barber</dt><dd>${o.barber_name || "—"}</dd>
        </dl>
        <label>Update status <select id="order-status-select">
          ${["pending","confirmed","processing","shipped","delivered","cancelled"].map((s) => `<option ${s===o.status?"selected":""}>${s}</option>`).join("")}
        </select></label>
        <button type="button" class="btn" id="save-order-status">Save status</button>`;
      document.getElementById("save-order-status").onclick = async () => {
        await api(`/orders/${o.id}/status`, {
          method: "PATCH",
          body: { status: document.getElementById("order-status-select").value },
        });
        renderOrders();
      };
    };
  }

  async function renderBarbers() {
    const barbers = await api("/barbers");
    viewRoot.innerHTML = `
      <div class="panel">
        <h2>Add barber</h2>
        <form id="add-barber-form" class="form-grid">
          <label>Name <input name="name" required /></label>
          <label>Email <input name="email" type="email" /></label>
          <label>Phone <input name="phone" /></label>
          <label>Commission % <input name="commission_rate" type="number" value="10" min="0" max="100" /></label>
          <button type="submit" class="btn">Create barber</button>
        </form>
      </div>
      <div id="barber-list"></div>`;

    document.getElementById("add-barber-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api("/barbers", {
        method: "POST",
        body: {
          name: fd.get("name"),
          email: fd.get("email"),
          phone: fd.get("phone"),
          commission_rate: parseFloat(fd.get("commission_rate")),
          active: true,
        },
      });
      renderBarbers();
    };

    const list = document.getElementById("barber-list");
    list.innerHTML = barbers
      .map(
        (b) => `
      <div class="panel barber-detail" data-barber-id="${b.id}">
        <h2>${esc(b.name)} ${b.active ? "" : "(inactive)"}</h2>
        <p>Commission rate: ${b.commission_rate}% · Orders: ${b.stats.total_orders} · Sales: $${b.stats.total_sales.toFixed(2)}</p>
        <p>Unpaid commissions: $${b.stats.unpaid_commissions.toFixed(2)} · Paid: $${b.stats.paid_commissions.toFixed(2)}</p>
        <button type="button" class="btn secondary" data-dashboard="${b.id}">Full dashboard</button>
        <button type="button" class="btn" data-gen-codes="${b.id}">Generate 5 codes</button>
        <button type="button" class="btn secondary" data-pay-all="${b.id}">Mark all commissions paid</button>
        <button type="button" class="btn secondary" data-toggle-active="${b.id}" data-active="${b.active}">${b.active ? "Deactivate" : "Activate"}</button>
        <h3>Referral codes</h3>
        <table><thead><tr><th>Code</th><th>Status</th></tr></thead>
        <tbody>${b.referralCodes.map((c) => `<tr>
          <td><code>${c.code}</code></td>
          <td>${c.used_at ? '<span class="badge used">Used</span>' : '<span class="badge">Available</span>'}</td>
        </tr>`).join("")}</tbody></table>
        <div id="barber-dash-${b.id}" hidden></div>
      </div>`
      )
      .join("");

    list.onclick = async (e) => {
      const gen = e.target.closest("[data-gen-codes]");
      const pay = e.target.closest("[data-pay-all]");
      const dash = e.target.closest("[data-dashboard]");
      const toggle = e.target.closest("[data-toggle-active]");
      if (gen) {
        const r = await api(`/barbers/${gen.dataset.genCodes}/codes`, {
          method: "POST",
          body: { count: 5 },
        });
        alert("Generated: " + r.codes.join(", "));
        renderBarbers();
      }
      if (pay) {
        await api(`/commissions/pay-all/${pay.dataset.payAll}`, { method: "POST" });
        renderBarbers();
      }
      if (toggle) {
        const id = toggle.dataset.toggleActive;
        const b = barbers.find((x) => x.id == id);
        await api(`/barbers/${id}`, {
          method: "PUT",
          body: {
            name: b.name,
            email: b.email,
            phone: b.phone,
            commission_rate: b.commission_rate,
            active: !b.active,
          },
        });
        renderBarbers();
      }
      if (dash) {
        const id = dash.dataset.dashboard;
        const el = document.getElementById(`barber-dash-${id}`);
        const data = await api(`/barbers/${id}/dashboard`);
        el.hidden = false;
        el.innerHTML = `
          <h3>Performance</h3>
          <p>Total orders: ${data.stats.totalOrders} · Sales: $${data.stats.totalSales.toFixed(2)}</p>
          <p>Unpaid: $${data.stats.unpaidCommissions.toFixed(2)} · Paid: $${data.stats.paidCommissions.toFixed(2)}</p>
          <h4>Referred customers</h4>
          <ul>${data.customers.map((c) => `<li>${esc(c.name)} — ${esc(c.email)}</li>`).join("") || "<li>None yet</li>"}</ul>
          <h4>Commission history</h4>
          <table><thead><tr><th>Order</th><th>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>${data.commissions.map((c) => {
            const order = data.orders.find((o) => o.id === c.order_id);
            return `<tr><td>${order?.order_number || c.order_id}</td><td>$${c.amount}</td>
              <td><span class="badge ${c.status}">${c.status}</span></td>
              <td>${c.status === "unpaid" ? `<button type="button" class="btn secondary" data-pay-comm="${c.id}">Mark paid</button>` : c.paid_at || ""}</td></tr>`;
          }).join("")}</tbody></table>`;
        el.onclick = async (ev) => {
          const pc = ev.target.closest("[data-pay-comm]");
          if (pc) {
            await api(`/commissions/${pc.dataset.payComm}/pay`, { method: "POST" });
            renderBarbers();
          }
        };
      }
    };
  }

  async function renderContent() {
    const content = await api("/content");
    viewRoot.innerHTML = `
      <form id="content-form" class="form-grid">
        <label>Hero tagline <input name="hero_tagline" value="${esc(content.hero_tagline || "")}" /></label>
        <label>Hero image URL <input name="hero_image" value="${esc(content.hero_image || "")}" /></label>
        <label>Hero CTA text <input name="hero_cta_text" value="${esc(content.hero_cta_text || "")}" /></label>
        <label>Arrivals title <input name="arrivals_title" value="${esc(content.arrivals_title || "")}" /></label>
        <label>Arrivals subtitle <textarea name="arrivals_subtitle">${esc(content.arrivals_subtitle || "")}</textarea></label>
        <label>Promo banner URL <input name="promo_banner" value="${esc(content.promo_banner || "")}" /></label>
        <button type="submit" class="btn">Save content</button>
      </form>
      <p style="margin-top:1.5rem;font-size:13px;color:#666">Upload a hero/banner image:</p>
      <form id="content-upload-form"><input type="file" accept="image/*" name="image" required />
      <button type="submit" class="btn secondary">Upload &amp; copy URL</button></form>
      <p id="upload-result"></p>`;

    document.getElementById("content-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {};
      for (const [k, v] of fd.entries()) body[k] = v;
      await api("/content", { method: "PUT", body });
      alert("Saved");
    };

    document.getElementById("content-upload-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const r = await api("/content/upload", { method: "POST", body: fd });
      document.getElementById("upload-result").textContent = `Uploaded: ${r.url} — paste into hero or banner field.`;
    };
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  showApp();
})();
