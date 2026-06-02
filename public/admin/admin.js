(function () {
  const loginScreen = document.getElementById("login-screen");
  const app = document.getElementById("app");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");
  const loginSubmit = document.getElementById("login-submit");
  const loginSubmitLabel = loginSubmit.querySelector(".login-submit__label");
  const loginSubmitSpinner = loginSubmit.querySelector(".login-submit__spinner");
  const passwordInput = document.getElementById("login-password");
  const togglePasswordBtn = document.getElementById("toggle-password");
  const viewRoot = document.getElementById("view-root");
  const viewTitle = document.getElementById("view-title");
  const viewSubtitle = document.getElementById("view-subtitle");
  const adminEmail = document.getElementById("admin-email");
  const toastRoot = document.getElementById("toast-root");
  const modalRoot = document.getElementById("modal-root");

  let currentView = "overview";

  const viewMeta = {
    overview: { title: "Dashboard", subtitle: "Your store at a glance" },
    products: { title: "Products", subtitle: "Add, edit, and manage what you sell" },
    orders: { title: "Orders", subtitle: "Track customer purchases and shipping" },
    barbers: { title: "Barbers", subtitle: "Manage referral partners and commissions" },
    content: { title: "Homepage", subtitle: "Update what visitors see on your website" },
  };

  const validViews = Object.keys(viewMeta);

  function getViewFromHash() {
    const view = location.hash.replace(/^#/, "");
    return validViews.includes(view) ? view : "overview";
  }

  function setActiveNav(view) {
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.view === view);
    });
  }

  function navigateTo(view, { updateHash = true } = {}) {
    if (!validViews.includes(view)) view = "overview";
    currentView = view;
    setActiveNav(view);
    if (updateHash && location.hash !== `#${view}`) {
      location.hash = view;
    }
    renderView();
  }

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
    if (!r.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function slugify(text) {
    return String(text || "")
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  }

  function money(n) {
    return `$${Number(n || 0).toFixed(2)}`;
  }

  function toast(message, type = "success") {
    const el = document.createElement("div");
    el.className = `toast${type === "error" ? " toast--error" : ""}`;
    el.textContent = message;
    toastRoot.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function wireFilePreview(form) {
    const input = form.querySelector('input[type="file"]');
    if (!input) return { clear() {} };

    let previewUrl = null;
    let previewEl = form.querySelector(".file-preview");
    if (!previewEl) {
      previewEl = document.createElement("div");
      previewEl.className = "file-preview";
      previewEl.hidden = true;
      input.insertAdjacentElement("afterend", previewEl);
    }

    function clearSelection() {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      input.value = "";
      previewEl.hidden = true;
      previewEl.innerHTML = "";
    }

    input.addEventListener("change", () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = null;
      }
      previewEl.hidden = true;
      previewEl.innerHTML = "";

      const file = input.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        input.value = "";
        toast("Please choose an image file.", "error");
        return;
      }

      previewUrl = URL.createObjectURL(file);
      previewEl.hidden = false;
      previewEl.innerHTML = `
        <div class="file-preview__inner">
          <img src="${previewUrl}" alt="" class="file-preview__img" />
          <div class="file-preview__info">
            <strong>Ready to upload</strong>
            <span>${esc(file.name)}</span>
          </div>
          <button type="button" class="btn ghost sm file-preview__remove">Remove</button>
        </div>`;
      previewEl.querySelector(".file-preview__remove").onclick = clearSelection;
    });

    return { clear: clearSelection };
  }

  function showLoading() {
    viewRoot.innerHTML = `<div class="loading-state"><span class="loading-spinner"></span> Loading…</div>`;
  }

  function closeModal() {
    modalRoot.hidden = true;
    modalRoot.innerHTML = "";
  }

  function openModal(title, subtitle, bodyHtml) {
    modalRoot.hidden = false;
    modalRoot.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal__header">
          <div>
            <h2 class="modal__title" id="modal-title">${title}</h2>
            ${subtitle ? `<p class="modal__subtitle">${subtitle}</p>` : ""}
          </div>
          <button type="button" class="modal__close" aria-label="Close">×</button>
        </div>
        <div class="modal__body">${bodyHtml}</div>
      </div>`;
    modalRoot.querySelector(".modal__close").onclick = closeModal;
    modalRoot.onclick = (e) => {
      if (e.target === modalRoot) closeModal();
    };
  }

  function productThumb(p) {
    const url = p.images?.[0]?.url;
    if (url) return `<img class="product-thumb" src="${esc(url)}" alt="" />`;
    return `<div class="product-thumb product-thumb--empty">No img</div>`;
  }

  function setLoginLoading(loading) {
    loginSubmit.disabled = loading;
    loginSubmit.classList.toggle("is-loading", loading);
    loginSubmitSpinner.hidden = !loading;
    loginSubmitLabel.hidden = loading;
  }

  togglePasswordBtn.addEventListener("click", () => {
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    togglePasswordBtn.textContent = show ? "Hide" : "Show";
    togglePasswordBtn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    setLoginLoading(true);

    const fd = new FormData(loginForm);
    const email = String(fd.get("email") || "").trim().toLowerCase();
    const password = String(fd.get("password") || "");

    try {
      await api("/login", { method: "POST", body: { email, password } });
      loginForm.reset();
      await showApp();
    } catch (err) {
      loginError.textContent = err.message || "Sign in failed. Check your email and password.";
      loginError.hidden = false;
      passwordInput.focus();
    } finally {
      setLoginLoading(false);
    }
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    try {
      await api("/logout", { method: "POST" });
    } catch {
      /* session may already be gone */
    }
    app.hidden = true;
    loginScreen.hidden = false;
    loginForm.reset();
    loginError.hidden = true;
    document.getElementById("login-email").focus();
  });

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.view));
  });

  window.addEventListener("hashchange", () => {
    if (app.hidden) return;
    const view = getViewFromHash();
    if (view !== currentView) navigateTo(view, { updateHash: false });
  });

  async function showApp() {
    try {
      const me = await api("/me");
      adminEmail.textContent = me.email;
      loginScreen.hidden = true;
      app.hidden = false;
      currentView = getViewFromHash();
      setActiveNav(currentView);
      renderView();
    } catch {
      loginScreen.hidden = false;
      app.hidden = true;
    }
  }

  async function renderView() {
    const meta = viewMeta[currentView] || { title: "Admin", subtitle: "" };
    viewTitle.textContent = meta.title;
    viewSubtitle.textContent = meta.subtitle;
    showLoading();

    try {
      if (currentView === "overview") await renderOverview();
      else if (currentView === "products") await renderProducts();
      else if (currentView === "orders") await renderOrders();
      else if (currentView === "barbers") await renderBarbers();
      else if (currentView === "content") await renderContent();
    } catch (e) {
      viewRoot.innerHTML = `<div class="card"><p class="error">${esc(e.message)}</p></div>`;
    }
  }

  function goToView(view) {
    navigateTo(view);
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
      <div class="stat-grid">
        <div class="stat-card">
          <span class="stat-card__label">Products</span>
          <span class="stat-card__value">${products.length}</span>
        </div>
        <div class="stat-card">
          <span class="stat-card__label">Total orders</span>
          <span class="stat-card__value">${orders.length}</span>
        </div>
        <div class="stat-card">
          <span class="stat-card__label">Paid orders</span>
          <span class="stat-card__value">${paid.length}</span>
        </div>
        <div class="stat-card">
          <span class="stat-card__label">Revenue</span>
          <span class="stat-card__value">${money(revenue)}</span>
        </div>
        <div class="stat-card">
          <span class="stat-card__label">Barbers</span>
          <span class="stat-card__value">${barbers.length}</span>
        </div>
      </div>

      <div class="card card--flat">
        <div class="card__header">
          <div>
            <h2 class="card__title">Quick actions</h2>
            <p class="card__desc">Jump to the most common tasks.</p>
          </div>
        </div>
        <div class="quick-links">
          <a href="#" class="quick-link" data-go="products">
            <strong>Add or edit products</strong>
            <span>Update prices, photos, and inventory</span>
          </a>
          <a href="#" class="quick-link" data-go="orders">
            <strong>View recent orders</strong>
            <span>See who bought and update shipping status</span>
          </a>
          <a href="#" class="quick-link" data-go="barbers">
            <strong>Barber referrals</strong>
            <span>Generate codes and pay commissions</span>
          </a>
          <a href="#" class="quick-link" data-go="content">
            <strong>Edit homepage</strong>
            <span>Change hero image, headlines, and banners</span>
          </a>
        </div>
      </div>`;

    viewRoot.querySelectorAll("[data-go]").forEach((link) => {
      link.onclick = (e) => {
        e.preventDefault();
        goToView(link.dataset.go);
      };
    });
  }

  async function renderProducts() {
    const [products, categories] = await Promise.all([
      api("/products"),
      api("/categories"),
    ]);

    const catOpts = categories
      .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
      .join("");
    const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

    viewRoot.innerHTML = `
      <div class="page-toolbar">
        <p class="page-toolbar__meta">${products.length} product${products.length === 1 ? "" : "s"} in your store</p>
        <button type="button" class="btn" id="toggle-add-product">+ Add product</button>
      </div>

      <div class="card" id="add-product-panel" hidden>
        <div class="card__header">
          <div>
            <h2 class="card__title">Add a new product</h2>
            <p class="card__desc">Fill in the basics — you can add photos and sizes after saving.</p>
          </div>
        </div>
        <form id="add-product-form" class="form-grid">
          <div class="form-field">
            <label for="add-name">Product name</label>
            <input id="add-name" name="name" required placeholder="e.g. UK Valley Dreams Tee" />
          </div>
          <div class="form-row">
            <div class="form-field">
              <label for="add-price">Price</label>
              <input id="add-price" name="price" type="number" step="0.01" min="0" required placeholder="55.00" />
            </div>
            <div class="form-field">
              <label for="add-category">Category</label>
              <select id="add-category" name="category_id">
                <option value="">Choose a category</option>
                ${catOpts}
              </select>
            </div>
          </div>
          <div class="form-field">
            <label for="add-description">Description</label>
            <textarea id="add-description" name="description" placeholder="Tell customers about this item…"></textarea>
          </div>
          <div class="switch-field">
            <input type="checkbox" id="add-sold-out" name="sold_out" />
            <label for="add-sold-out">Mark as sold out (hide from customers)</label>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn">Save product</button>
            <button type="button" class="btn ghost" id="cancel-add-product">Cancel</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="card__header">
          <div>
            <h2 class="card__title">All products</h2>
            <p class="card__desc">Click Edit to update photos, sizes, and stock.</p>
          </div>
        </div>
        ${
          products.length
            ? `<div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Price</th>
                <th>In stock</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="product-rows">
              ${products
                .map((p) => {
                  const stock = p.variants.reduce((s, v) => s + v.stock, 0);
                  return `<tr>
                    <td>
                      <div class="product-cell">
                        ${productThumb(p)}
                        <div>
                          <div class="product-name">${esc(p.name)}</div>
                          <div class="product-meta">${esc(catMap[p.category_id] || "Uncategorized")}</div>
                        </div>
                      </div>
                    </td>
                    <td>${money(p.price)}</td>
                    <td>${stock} item${stock === 1 ? "" : "s"}</td>
                    <td>${p.sold_out ? '<span class="badge badge--danger">Sold out</span>' : '<span class="badge badge--success">Live</span>'}</td>
                    <td>
                      <div class="btn-group">
                        <button type="button" class="btn secondary sm" data-edit="${p.id}">Edit</button>
                        <button type="button" class="btn danger sm" data-del="${p.id}">Delete</button>
                      </div>
                    </td>
                  </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>`
            : `<div class="empty-state">
          <strong>No products yet</strong>
          Click "Add product" above to create your first one.
        </div>`
        }
      </div>`;

    const addPanel = document.getElementById("add-product-panel");
    const toggleAdd = document.getElementById("toggle-add-product");

    toggleAdd.onclick = () => {
      const show = addPanel.hidden;
      addPanel.hidden = !show;
      toggleAdd.textContent = show ? "Cancel" : "+ Add product";
      if (show) document.getElementById("add-name").focus();
    };

    document.getElementById("cancel-add-product").onclick = () => {
      addPanel.hidden = true;
      toggleAdd.textContent = "+ Add product";
    };

    document.getElementById("add-product-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = String(fd.get("name") || "").trim();
      await api("/products", {
        method: "POST",
        body: {
          name,
          slug: slugify(name),
          price: parseFloat(fd.get("price")),
          category_id: fd.get("category_id") || null,
          description: fd.get("description"),
          sold_out: fd.get("sold_out") === "on",
        },
      });
      toast("Product added!");
      renderProducts();
    };

    const tbody = document.getElementById("product-rows");
    if (tbody) {
      tbody.onclick = async (e) => {
        const edit = e.target.closest("[data-edit]");
        const del = e.target.closest("[data-del]");
        if (del) {
          const product = products.find((p) => p.id == del.dataset.del);
          if (!confirm(`Delete "${product?.name}"? This cannot be undone.`)) return;
          await api(`/products/${del.dataset.del}`, { method: "DELETE" });
          toast("Product deleted");
          renderProducts();
        }
        if (edit) openProductEditor(products.find((p) => p.id == edit.dataset.edit));
      };
    }
  }

  async function openProductEditor(p) {
    openModal(
      esc(p.name),
      "Update details, photos, sizes, and stock",
      `
      <form id="edit-product-form" class="form-grid">
        <div class="form-field">
          <label>Product name</label>
          <input name="name" value="${esc(p.name)}" required />
        </div>
        <div class="form-row">
          <div class="form-field">
            <label>Price</label>
            <input name="price" type="number" step="0.01" min="0" value="${p.price}" required />
          </div>
          <div class="form-field">
            <label>Web address slug</label>
            <input name="slug" value="${esc(p.slug)}" required />
            <span class="field-hint">Used in the product link — usually auto-generated from the name.</span>
          </div>
        </div>
        <div class="form-field">
          <label>Description</label>
          <textarea name="description">${esc(p.description)}</textarea>
        </div>
        <div class="form-field">
          <label>Shipping info</label>
          <textarea name="shipping_info" placeholder="Delivery times, return policy…">${esc(p.shipping_info || "")}</textarea>
        </div>
        <div class="switch-field">
          <input type="checkbox" id="edit-sold-out" name="sold_out" ${p.sold_out ? "checked" : ""} />
          <label for="edit-sold-out">Mark as sold out</label>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn">Save changes</button>
        </div>
      </form>

      <hr class="section-divider" />

      <div class="modal-section">
        <h3 class="modal-section__title">Photos</h3>
        ${
          p.images.length
            ? `<ul class="image-list">${p.images
                .map(
                  (i) => `<li>
              <img src="${esc(i.url)}" alt="" />
              <span>${i.is_hover ? "Hover image" : "Product photo"} · ${esc(i.url)}</span>
              <button type="button" class="btn danger sm" data-del-img="${i.id}">Remove</button>
            </li>`
                )
                .join("")}</ul>`
            : `<p class="field-hint">No photos yet. Upload one below.</p>`
        }
        <form id="upload-img-form" class="file-upload">
          <input type="file" name="image" accept="image/*" required />
          <div class="switch-field">
            <input type="checkbox" id="upload-hover" name="is_hover" />
            <label for="upload-hover">Use as hover image (shows when customer hovers)</label>
          </div>
          <button type="submit" class="btn secondary">Upload photo</button>
        </form>
      </div>

      <hr class="section-divider" />

      <div class="modal-section">
        <h3 class="modal-section__title">Sizes &amp; stock</h3>
        <p class="field-hint">Change size, color, or quantity below, then click Save.</p>
        ${
          p.variants.length
            ? `<div class="table-wrap">
          <table class="data-table variant-table">
            <thead><tr><th>Size</th><th>Color</th><th>In stock</th><th></th></tr></thead>
            <tbody id="variant-rows">${p.variants
              .map(
                (v) => `<tr data-variant-id="${v.id}" data-sku="${esc(v.sku || "")}">
              <td><input class="variant-field" name="size" value="${esc(v.size)}" aria-label="Size" required /></td>
              <td><input class="variant-field" name="color" value="${esc(v.color)}" aria-label="Color" required /></td>
              <td><input class="variant-field variant-field--stock" name="stock" type="number" min="0" value="${v.stock}" aria-label="Stock" required /></td>
              <td>
                <div class="btn-group">
                  <button type="button" class="btn secondary sm" data-save-var="${v.id}">Save</button>
                  <button type="button" class="btn danger sm" data-del-var="${v.id}">Remove</button>
                </div>
              </td>
            </tr>`
              )
              .join("")}</tbody>
          </table>
        </div>
        <div class="form-actions">
          <button type="button" class="btn secondary" id="save-all-variants">Save all sizes &amp; stock</button>
        </div>`
            : `<p class="field-hint">No sizes added yet.</p>`
        }
        <form id="add-variant-form" class="form-grid">
          <div class="form-row">
            <div class="form-field">
              <label>Size</label>
              <input name="size" required placeholder="M" />
            </div>
            <div class="form-field">
              <label>Color</label>
              <input name="color" required placeholder="Black" />
            </div>
            <div class="form-field">
              <label>How many in stock?</label>
              <input name="stock" type="number" min="0" value="10" required />
            </div>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn secondary">Add size</button>
          </div>
        </form>
      </div>`
    );

    const modal = modalRoot.querySelector(".modal");
    const uploadPreview = wireFilePreview(document.getElementById("upload-img-form"));

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
      toast("Product saved!");
      closeModal();
      renderProducts();
    };

    document.getElementById("upload-img-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      fd.append("is_hover", e.target.is_hover.checked ? "1" : "0");
      fd.append("sort_order", String(p.images.length));
      await api(`/products/${p.id}/images`, { method: "POST", body: fd });
      uploadPreview.clear();
      toast("Photo uploaded!");
      const updated = (await api("/products")).find((x) => x.id === p.id);
      closeModal();
      if (updated) openProductEditor(updated);
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
      toast("Size added!");
      const updated = (await api("/products")).find((x) => x.id === p.id);
      closeModal();
      if (updated) openProductEditor(updated);
    };

    async function saveVariantRow(row) {
      const id = row.dataset.variantId;
      const size = row.querySelector('[name="size"]').value.trim();
      const color = row.querySelector('[name="color"]').value.trim();
      const stock = parseInt(row.querySelector('[name="stock"]').value, 10);
      if (!size || !color || Number.isNaN(stock) || stock < 0) {
        throw new Error("Enter a size, color, and stock amount (0 or more).");
      }
      await api(`/variants/${id}`, {
        method: "PUT",
        body: {
          size,
          color,
          stock,
          sku: row.dataset.sku || null,
        },
      });
    }

    async function reloadProductEditor() {
      const updated = (await api("/products")).find((x) => x.id === p.id);
      closeModal();
      if (updated) openProductEditor(updated);
      renderProducts();
    }

    document.getElementById("save-all-variants")?.addEventListener("click", async () => {
      try {
        const rows = modal.querySelectorAll("[data-variant-id]");
        for (const row of rows) await saveVariantRow(row);
        toast("All sizes & stock saved!");
        await reloadProductEditor();
      } catch (err) {
        toast(err.message, "error");
      }
    });

    modal.onclick = async (e) => {
      const di = e.target.closest("[data-del-img]");
      const dv = e.target.closest("[data-del-var]");
      const sv = e.target.closest("[data-save-var]");
      if (sv) {
        try {
          await saveVariantRow(sv.closest("[data-variant-id]"));
          toast("Size saved!");
          await reloadProductEditor();
        } catch (err) {
          toast(err.message, "error");
        }
      }
      if (di) {
        if (!confirm("Remove this photo?")) return;
        await api(`/product-images/${di.dataset.delImg}`, { method: "DELETE" });
        toast("Photo removed");
        await reloadProductEditor();
      }
      if (dv) {
        if (!confirm("Remove this size?")) return;
        await api(`/variants/${dv.dataset.delVar}`, { method: "DELETE" });
        toast("Size removed");
        await reloadProductEditor();
      }
    };
  }

  async function renderOrders() {
    const orders = await api("/orders");

    viewRoot.innerHTML = `
      <div class="card">
        <div class="card__header">
          <div>
            <h2 class="card__title">All orders</h2>
            <p class="card__desc">${orders.length} order${orders.length === 1 ? "" : "s"} total</p>
          </div>
        </div>
        ${
          orders.length
            ? `<div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Referral</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="order-rows">${orders
              .map(
                (o) => `<tr>
              <td><strong>${esc(o.order_number)}</strong></td>
              <td>
                ${esc(o.customer_name)}<br>
                <span class="product-meta">${esc(o.customer_email)}</span>
              </td>
              <td>${money(o.total)}</td>
              <td><span class="badge ${o.payment_status === "paid" ? "badge--success" : "badge--warning"}">${esc(o.payment_status)}</span></td>
              <td>${o.referral_code_text ? `<span class="code-chip">${esc(o.referral_code_text)}</span>` : "—"}</td>
              <td><button type="button" class="btn secondary sm" data-order="${o.id}">View details</button></td>
            </tr>`
              )
              .join("")}</tbody>
          </table>
        </div>`
            : `<div class="empty-state"><strong>No orders yet</strong>Orders will appear here when customers check out.</div>`
        }
      </div>`;

    const tbody = document.getElementById("order-rows");
    if (!tbody) return;

    tbody.onclick = async (e) => {
      const btn = e.target.closest("[data-order]");
      if (!btn) return;
      const o = orders.find((x) => x.id == btn.dataset.order);
      const ship = o.shipping;

      openModal(
        `Order ${esc(o.order_number)}`,
        `${esc(o.customer_name)} · ${money(o.total)}`,
        `
        <div class="detail-grid">
          <div class="detail-block">
            <dt>Status</dt>
            <dd>${esc(o.status)} · Payment: ${esc(o.payment_status)}</dd>
          </div>
          <div class="detail-block">
            <dt>Customer</dt>
            <dd>${esc(o.customer_name)}<br>${esc(o.customer_email)}<br>${esc(o.customer_phone || "No phone")}</dd>
          </div>
          <div class="detail-block">
            <dt>Ship to</dt>
            <dd>${esc(ship.line1)}<br>${esc(ship.city)}, ${esc(ship.state)} ${esc(ship.zip)}<br>${esc(ship.country)}</dd>
          </div>
          <div class="detail-block">
            <dt>Referral</dt>
            <dd>${o.referral_code_text ? esc(o.referral_code_text) : "None"}${o.barber_name ? `<br>Barber: ${esc(o.barber_name)}` : ""}</dd>
          </div>
        </div>

        <div class="modal-section">
          <h3 class="modal-section__title">Items ordered</h3>
          <ul>${o.items.map((i) => `<li>${esc(i.product_name)} — ${esc(i.size)} / ${esc(i.color)} × ${i.quantity} (${money(i.line_total)})</li>`).join("")}</ul>
        </div>

        <div class="form-field">
          <label for="order-status-select">Update order status</label>
          <select id="order-status-select">
            ${["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"]
              .map((s) => `<option ${s === o.status ? "selected" : ""}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="form-actions">
          <button type="button" class="btn" id="save-order-status">Save status</button>
        </div>`
      );

      document.getElementById("save-order-status").onclick = async () => {
        await api(`/orders/${o.id}/status`, {
          method: "PATCH",
          body: { status: document.getElementById("order-status-select").value.toLowerCase() },
        });
        toast("Order status updated");
        closeModal();
        renderOrders();
      };
    };
  }

  async function renderBarbers() {
    const barbers = await api("/barbers");

    viewRoot.innerHTML = `
      <div class="page-toolbar">
        <p class="page-toolbar__meta">${barbers.length} barber partner${barbers.length === 1 ? "" : "s"}</p>
        <button type="button" class="btn" id="toggle-add-barber">+ Add barber</button>
      </div>

      <div class="card" id="add-barber-panel" hidden>
        <div class="card__header">
          <div>
            <h2 class="card__title">Add a barber</h2>
            <p class="card__desc">Barbers earn commission when customers use their referral code.</p>
          </div>
        </div>
        <form id="add-barber-form" class="form-grid">
          <div class="form-row">
            <div class="form-field">
              <label>Name</label>
              <input name="name" required placeholder="Barber name" />
            </div>
            <div class="form-field">
              <label>Email</label>
              <input name="email" type="email" placeholder="optional" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-field">
              <label>Phone</label>
              <input name="phone" placeholder="optional" />
            </div>
            <div class="form-field">
              <label>Commission rate (%)</label>
              <input name="commission_rate" type="number" value="10" min="0" max="100" />
              <span class="field-hint">Percentage of each referred sale they earn.</span>
            </div>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn">Save barber</button>
            <button type="button" class="btn ghost" id="cancel-add-barber">Cancel</button>
          </div>
        </form>
      </div>

      <div id="barber-list">${barbers.length ? "" : `<div class="card"><div class="empty-state"><strong>No barbers yet</strong>Add your first barber partner above.</div></div>`}</div>`;

    const addPanel = document.getElementById("add-barber-panel");
    const toggleAdd = document.getElementById("toggle-add-barber");
    toggleAdd.onclick = () => {
      const show = addPanel.hidden;
      addPanel.hidden = !show;
      toggleAdd.textContent = show ? "Cancel" : "+ Add barber";
    };
    document.getElementById("cancel-add-barber").onclick = () => {
      addPanel.hidden = true;
      toggleAdd.textContent = "+ Add barber";
    };

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
      toast("Barber added!");
      renderBarbers();
    };

    const list = document.getElementById("barber-list");
    if (!barbers.length) return;

    list.innerHTML = barbers
      .map(
        (b) => `
      <div class="card barber-detail" data-barber-id="${b.id}">
        <div class="card__header">
          <div>
            <h2 class="card__title">${esc(b.name)} ${b.active ? "" : '<span class="badge badge--muted">Inactive</span>'}</h2>
            <p class="card__desc">${b.commission_rate}% commission on referred sales</p>
          </div>
        </div>

        <div class="barber-card__stats">
          <div class="barber-stat"><span>Orders</span><strong>${b.stats.total_orders}</strong></div>
          <div class="barber-stat"><span>Total sales</span><strong>${money(b.stats.total_sales)}</strong></div>
          <div class="barber-stat"><span>Unpaid</span><strong>${money(b.stats.unpaid_commissions)}</strong></div>
          <div class="barber-stat"><span>Paid out</span><strong>${money(b.stats.paid_commissions)}</strong></div>
        </div>

        <div class="btn-group">
          <button type="button" class="btn secondary sm" data-dashboard="${b.id}">View details</button>
          <button type="button" class="btn sm" data-gen-codes="${b.id}">Generate 5 codes</button>
          <button type="button" class="btn secondary sm" data-pay-all="${b.id}">Mark all paid</button>
          <button type="button" class="btn ghost sm" data-toggle-active="${b.id}" data-active="${b.active}">${b.active ? "Deactivate" : "Activate"}</button>
        </div>

        <hr class="section-divider" />

        <h3 class="modal-section__title">Referral codes</h3>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Code</th><th>Status</th></tr></thead>
            <tbody>${b.referralCodes
              .map(
                (c) => `<tr>
              <td><span class="code-chip">${esc(c.code)}</span></td>
              <td>${c.used_at ? '<span class="badge badge--danger">Used</span>' : '<span class="badge badge--success">Available</span>'}</td>
            </tr>`
              )
              .join("")}</tbody>
          </table>
        </div>
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
        toast(`Codes created: ${r.codes.join(", ")}`);
        renderBarbers();
      }
      if (pay) {
        if (!confirm("Mark all unpaid commissions as paid for this barber?")) return;
        await api(`/commissions/pay-all/${pay.dataset.payAll}`, { method: "POST" });
        toast("Commissions marked as paid");
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
        toast(b.active ? "Barber deactivated" : "Barber activated");
        renderBarbers();
      }
      if (dash) {
        const id = dash.dataset.dashboard;
        const data = await api(`/barbers/${id}/dashboard`);
        openModal(
          `${esc(barbers.find((b) => b.id == id)?.name || "Barber")} — Details`,
          "Performance and commission history",
          `
          <div class="barber-card__stats">
            <div class="barber-stat"><span>Orders</span><strong>${data.stats.totalOrders}</strong></div>
            <div class="barber-stat"><span>Sales</span><strong>${money(data.stats.totalSales)}</strong></div>
            <div class="barber-stat"><span>Unpaid</span><strong>${money(data.stats.unpaidCommissions)}</strong></div>
            <div class="barber-stat"><span>Paid</span><strong>${money(data.stats.paidCommissions)}</strong></div>
          </div>

          <div class="modal-section">
            <h3 class="modal-section__title">Referred customers</h3>
            ${data.customers.length ? `<ul>${data.customers.map((c) => `<li>${esc(c.name)} — ${esc(c.email)}</li>`).join("")}</ul>` : `<p class="field-hint">No referred customers yet.</p>`}
          </div>

          <div class="modal-section">
            <h3 class="modal-section__title">Commission history</h3>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Order</th><th>Amount</th><th>Status</th><th></th></tr></thead>
                <tbody id="comm-rows">${data.commissions
                  .map((c) => {
                    const order = data.orders.find((o) => o.id === c.order_id);
                    return `<tr>
                      <td>${esc(order?.order_number || c.order_id)}</td>
                      <td>${money(c.amount)}</td>
                      <td><span class="badge ${c.status === "paid" ? "badge--success" : "badge--warning"}">${esc(c.status)}</span></td>
                      <td>${c.status === "unpaid" ? `<button type="button" class="btn secondary sm" data-pay-comm="${c.id}">Mark paid</button>` : esc(c.paid_at || "—")}</td>
                    </tr>`;
                  })
                  .join("")}</tbody>
              </table>
            </div>
          </div>`
        );

        document.getElementById("comm-rows").onclick = async (ev) => {
          const pc = ev.target.closest("[data-pay-comm]");
          if (pc) {
            await api(`/commissions/${pc.dataset.payComm}/pay`, { method: "POST" });
            toast("Commission marked as paid");
            closeModal();
            renderBarbers();
          }
        };
      }
    };
  }

  async function renderContent() {
    const content = await api("/content");

    viewRoot.innerHTML = `
      <div class="card">
        <div class="card__header">
          <div>
            <h2 class="card__title">Homepage content</h2>
            <p class="card__desc">These settings control the main banner and text on your store homepage.</p>
          </div>
        </div>
        <form id="content-form" class="form-grid">
          <div class="form-field">
            <label>Top banner text</label>
            <input name="hero_tagline" value="${esc(content.hero_tagline || "")}" placeholder="e.g. SS2026 OUT NOW" />
            <span class="field-hint">Small text above the main headline.</span>
          </div>
          <div class="form-field">
            <label>Hero image</label>
            <input name="hero_image" value="${esc(content.hero_image || "")}" placeholder="/herov1.png" />
            <span class="field-hint">Paste a URL, or upload an image below and copy the link.</span>
          </div>
          <div class="form-field">
            <label>Shop button text</label>
            <input name="hero_cta_text" value="${esc(content.hero_cta_text || "")}" placeholder="Shop now" />
          </div>
          <div class="form-field">
            <label>New arrivals heading</label>
            <input name="arrivals_title" value="${esc(content.arrivals_title || "")}" placeholder="New Arrivals" />
          </div>
          <div class="form-field">
            <label>New arrivals description</label>
            <textarea name="arrivals_subtitle" placeholder="Short text under the heading…">${esc(content.arrivals_subtitle || "")}</textarea>
          </div>
          <div class="form-field">
            <label>Promo banner image (optional)</label>
            <input name="promo_banner" value="${esc(content.promo_banner || "")}" placeholder="Leave blank to hide" />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn">Save changes</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="card__header">
          <div>
            <h2 class="card__title">Upload an image</h2>
            <p class="card__desc">Upload a photo, then copy the link into the hero or banner field above.</p>
          </div>
        </div>
        <form id="content-upload-form" class="file-upload">
          <input type="file" accept="image/*" name="image" required />
          <button type="submit" class="btn secondary">Upload image</button>
        </form>
        <p id="upload-result" class="field-hint" style="margin-top:0.75rem"></p>
      </div>`;

    document.getElementById("content-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {};
      for (const [k, v] of fd.entries()) body[k] = v;
      await api("/content", { method: "PUT", body });
      toast("Homepage saved!");
    };

    const contentUploadPreview = wireFilePreview(document.getElementById("content-upload-form"));

    document.getElementById("content-upload-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const r = await api("/content/upload", { method: "POST", body: fd });
      contentUploadPreview.clear();
      document.getElementById("upload-result").textContent = `Uploaded! Copy this link: ${r.url}`;
      toast("Image uploaded — copy the link below");
    };
  }

  currentView = getViewFromHash();
  setActiveNav(currentView);
  showApp();
})();
