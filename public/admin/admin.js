(function () {
  const loginScreen = document.getElementById("login-screen");
  const app = document.getElementById("app");
  const navToggle = document.getElementById("nav-toggle");
  const sidebarBackdrop = document.getElementById("sidebar-backdrop");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");
  const loginSubmit = document.getElementById("login-submit");
  const loginSubmitLabel = loginSubmit.querySelector(".login-submit__label");
  const loginSubmitSpinner = loginSubmit.querySelector(".login-submit__spinner");
  const codeInput = document.getElementById("login-code");
  const viewRoot = document.getElementById("view-root");
  const viewTitle = document.getElementById("view-title");
  const viewSubtitle = document.getElementById("view-subtitle");
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

  function setNavOpen(open) {
    if (!app) return;
    app.classList.toggle("is-nav-open", open);
    if (sidebarBackdrop) {
      sidebarBackdrop.hidden = !open;
      sidebarBackdrop.setAttribute("aria-hidden", open ? "false" : "true");
    }
    if (navToggle) navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    document.body.classList.toggle("admin-nav-open", open);
  }

  function navigateTo(view, { updateHash = true } = {}) {
    if (!validViews.includes(view)) view = "overview";
    currentView = view;
    setActiveNav(view);
    if (updateHash && location.hash !== `#${view}`) {
      location.hash = view;
    }
    setNavOpen(false);
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

  function reqLabel(text) {
    return `${text} <span class="field-required" aria-hidden="true">*</span>`;
  }

  function categoryOptions(categories, selectedId) {
    const selected = selectedId != null ? String(selectedId) : "";
    return (
      `<option value="" disabled${selected ? "" : " selected"}>Select a category</option>` +
      categories
        .map(
          (c) =>
            `<option value="${c.id}"${String(c.id) === selected ? " selected" : ""}>${esc(c.name)}</option>`
        )
        .join("")
    );
  }

  function validateProductForm(fd, { requireSlug = false, requireShipping = false } = {}) {
    if (!String(fd.get("name") || "").trim()) return "Product name is required";
    if (!fd.get("category_id")) return "Category is required";
    const price = parseFloat(fd.get("price"));
    if (!Number.isFinite(price) || price < 0) return "Enter a valid price";
    if (!String(fd.get("description") || "").trim()) return "Description is required";
    if (requireSlug && !String(fd.get("slug") || "").trim()) return "Product URL slug is required";
    if (requireShipping && !String(fd.get("shipping_info") || "").trim()) {
      return "Shipping info is required";
    }
    return null;
  }

  function renderVariantEditor(variants) {
    if (!variants.length) {
      return `<p class="field-hint">No sizes yet — add at least one size and color below.</p>`;
    }

    const card = (v) => `
      <article class="variant-card" data-variant-id="${v.id}" data-sku="${esc(v.sku || "")}">
        <div class="form-field">
          <label>${reqLabel("Size")}</label>
          <input class="variant-field" name="size" value="${esc(v.size)}" required />
        </div>
        <div class="form-field">
          <label>${reqLabel("Color")}</label>
          <input class="variant-field" name="color" value="${esc(v.color)}" required />
        </div>
        <div class="form-field">
          <label>${reqLabel("In stock")}</label>
          <input class="variant-field" name="stock" type="number" min="0" value="${v.stock}" required />
        </div>
        <div class="variant-card__actions">
          <button type="button" class="btn secondary btn--block" data-save-var="${v.id}">Save size</button>
          <button type="button" class="btn danger btn--block" data-del-var="${v.id}">Remove size</button>
        </div>
      </article>`;

    return `
      <div class="variant-list">${variants.map(card).join("")}</div>
      <div class="form-actions form-actions--stack">
        <button type="button" class="btn secondary btn--block" id="save-all-variants">Save all sizes &amp; stock</button>
      </div>`;
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

  function renderOrderItemsList(items) {
    if (!items?.length) {
      return `<p class="field-hint">No items in this order.</p>`;
    }
    return `<ul class="order-items-list">
      ${items
        .map((i) => {
          const thumb = i.image
            ? `<img class="order-item__img" src="${esc(i.image)}" alt="" />`
            : `<div class="order-item__img order-item__img--empty">No photo</div>`;
          const unit = i.quantity > 0 ? i.line_total / i.quantity : i.unit_price;
          return `<li class="order-item">
            ${thumb}
            <div class="order-item__body">
              <div class="order-item__name">${esc(i.product_name)}</div>
              <div class="order-item__meta">
                <span>Size ${esc(i.size)}</span>
                <span>Color ${esc(i.color)}</span>
                <span>Qty ${i.quantity}</span>
              </div>
              <div class="order-item__unit">${money(unit)} each</div>
            </div>
            <div class="order-item__total">${money(i.line_total)}</div>
          </li>`;
        })
        .join("")}
    </ul>`;
  }

  function setLoginLoading(loading) {
    loginSubmit.disabled = loading;
    loginSubmit.classList.toggle("is-loading", loading);
    loginSubmitSpinner.hidden = !loading;
    loginSubmitLabel.hidden = loading;
  }

  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 4);
    if (codeInput.value.length === 4) loginError.hidden = true;
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    setLoginLoading(true);

    const code = String(codeInput.value || "").replace(/\D/g, "");

    try {
      await api("/login", { method: "POST", body: { code } });
      loginForm.reset();
      await showApp();
    } catch (err) {
      loginError.textContent = err.message || "Invalid access code. Try again.";
      loginError.hidden = false;
      codeInput.focus();
      codeInput.select();
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
    loginForm.reset();
    setNavOpen(false);
    showLoginScreen();
  });

  navToggle?.addEventListener("click", () => {
    setNavOpen(!app.classList.contains("is-nav-open"));
  });

  sidebarBackdrop?.addEventListener("click", () => setNavOpen(false));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setNavOpen(false);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) setNavOpen(false);
  });

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.view));
  });

  window.addEventListener("hashchange", () => {
    if (app.hidden) return;
    const view = getViewFromHash();
    if (view !== currentView) navigateTo(view, { updateHash: false });
  });

  function showLoginScreen() {
    app.hidden = true;
    loginScreen.hidden = false;
    loginError.hidden = true;
    codeInput.focus();
  }

  async function showApp() {
    try {
      await api("/me");
      setNavOpen(false);
      loginScreen.hidden = true;
      app.hidden = false;
      currentView = getViewFromHash();
      setActiveNav(currentView);
      renderView();
    } catch {
      showLoginScreen();
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
            <label for="add-name">${reqLabel("Product name")}</label>
            <input id="add-name" name="name" required placeholder="e.g. UK Valley Dreams Tee" />
          </div>
          <div class="form-row">
            <div class="form-field">
              <label for="add-price">${reqLabel("Price")}</label>
              <input id="add-price" name="price" type="number" step="0.01" min="0" required placeholder="55.00" />
            </div>
            <div class="form-field">
              <label for="add-category">${reqLabel("Category")}</label>
              <select id="add-category" name="category_id" required>
                ${categoryOptions(categories)}
              </select>
            </div>
          </div>
          <div class="form-field">
            <label for="add-description">${reqLabel("Description")}</label>
            <textarea id="add-description" name="description" required placeholder="Tell customers about this item…"></textarea>
          </div>
          <div class="switch-field">
            <input type="checkbox" id="add-sold-out" name="sold_out" />
            <label for="add-sold-out">Mark as sold out (hide from customers)</label>
          </div>
          <div class="form-actions form-actions--stack">
            <button type="submit" class="btn btn--block">Save product</button>
            <button type="button" class="btn ghost btn--block" id="cancel-add-product">Cancel</button>
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
            ? `<div class="table-wrap table-wrap--stack">
          <table class="data-table data-table--stack">
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
                    <td data-label="Product">
                      <div class="product-cell">
                        ${productThumb(p)}
                        <div>
                          <div class="product-name">${esc(p.name)}</div>
                          <div class="product-meta">${esc(catMap[p.category_id] || "Uncategorized")}</div>
                        </div>
                      </div>
                    </td>
                    <td data-label="Price">${money(p.price)}</td>
                    <td data-label="In stock">${stock} item${stock === 1 ? "" : "s"}</td>
                    <td data-label="Status">${p.sold_out ? '<span class="badge badge--danger">Sold out</span>' : '<span class="badge badge--success">Live</span>'}</td>
                    <td data-label="Actions">
                      <div class="btn-group btn-group--stack">
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
      const err = validateProductForm(fd);
      if (err) {
        toast(err, "error");
        return;
      }
      const name = String(fd.get("name") || "").trim();
      await api("/products", {
        method: "POST",
        body: {
          name,
          slug: slugify(name),
          price: parseFloat(fd.get("price")),
          category_id: fd.get("category_id"),
          description: String(fd.get("description") || "").trim(),
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
        if (edit) void openProductEditor(products.find((p) => p.id == edit.dataset.edit));
      };
    }
  }

  async function openProductEditor(p) {
    const categories = await api("/categories");
    openModal(
      esc(p.name),
      "Update details, photos, sizes, and stock",
      `
      <form id="edit-product-form" class="form-grid">
        <div class="form-field">
          <label>${reqLabel("Product name")}</label>
          <input name="name" value="${esc(p.name)}" required />
        </div>
        <div class="form-field">
          <label>${reqLabel("Category")}</label>
          <select name="category_id" required>
            ${categoryOptions(categories, p.category_id)}
          </select>
          <span class="field-hint">Controls which filter this item appears under (Streetwear, Footwear, Accessories).</span>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label>${reqLabel("Price")}</label>
            <input name="price" type="number" step="0.01" min="0" value="${p.price}" required />
          </div>
          <div class="form-field">
            <label>${reqLabel("Web address slug")}</label>
            <input name="slug" value="${esc(p.slug)}" required />
            <span class="field-hint">Used in the product link — usually auto-generated from the name.</span>
          </div>
        </div>
        <div class="form-field">
          <label>${reqLabel("Description")}</label>
          <textarea name="description" required>${esc(p.description)}</textarea>
        </div>
        <div class="form-field">
          <label>${reqLabel("Shipping info")}</label>
          <textarea name="shipping_info" required placeholder="Delivery times, return policy…">${esc(p.shipping_info || "")}</textarea>
        </div>
        <div class="switch-field">
          <input type="checkbox" id="edit-sold-out" name="sold_out" ${p.sold_out ? "checked" : ""} />
          <label for="edit-sold-out">Mark as sold out</label>
        </div>
        <div class="form-actions form-actions--stack">
          <button type="submit" class="btn btn--block">Save changes</button>
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
        <p class="field-hint">All size fields are required. Tap Save on each row or use Save all.</p>
        ${renderVariantEditor(p.variants)}
        <div class="add-variant-panel">
          <h4 class="add-variant-panel__title">Add a new size</h4>
          <p class="field-hint">Enter size, color, and stock below, then tap the button to add it to this product.</p>
          <form id="add-variant-form" class="form-grid">
            <div class="form-row">
              <div class="form-field">
                <label>${reqLabel("Size")}</label>
                <input name="size" required placeholder="e.g. M, L, XL" />
              </div>
              <div class="form-field">
                <label>${reqLabel("Color")}</label>
                <input name="color" required placeholder="e.g. Black, Cream" />
              </div>
              <div class="form-field">
                <label>${reqLabel("In stock")}</label>
                <input name="stock" type="number" min="0" value="10" required />
              </div>
            </div>
            <div class="form-actions form-actions--stack">
              <button type="submit" class="btn btn--block add-variant-submit">
                <span class="add-variant-submit__icon" aria-hidden="true">+</span>
                Add size to product
              </button>
            </div>
          </form>
        </div>
      </div>`
    );

    const modal = modalRoot.querySelector(".modal");
    const uploadPreview = wireFilePreview(document.getElementById("upload-img-form"));

    document.getElementById("edit-product-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const err = validateProductForm(fd, { requireSlug: true, requireShipping: true });
      if (err) {
        toast(err, "error");
        return;
      }
      await api(`/products/${p.id}`, {
        method: "PUT",
        body: {
          name: String(fd.get("name") || "").trim(),
          slug: String(fd.get("slug") || "").trim(),
          price: parseFloat(fd.get("price")),
          description: String(fd.get("description") || "").trim(),
          shipping_info: String(fd.get("shipping_info") || "").trim(),
          sold_out: fd.get("sold_out") === "on",
          category_id: fd.get("category_id"),
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
      if (updated) void openProductEditor(updated);
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
      if (updated) void openProductEditor(updated);
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
      if (updated) void openProductEditor(updated);
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
            ? `<div class="table-wrap table-wrap--stack">
          <table class="data-table data-table--stack">
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
              <td data-label="Order"><strong>${esc(o.order_number)}</strong></td>
              <td data-label="Customer">
                ${esc(o.customer_name)}<br>
                <span class="product-meta">${esc(o.customer_email)}</span>
              </td>
              <td data-label="Total">${money(o.total)}</td>
              <td data-label="Payment"><span class="badge ${o.payment_status === "paid" ? "badge--success" : "badge--warning"}">${esc(o.payment_status)}</span></td>
              <td data-label="Referral">${o.referral_code_text ? `<span class="code-chip">${esc(o.referral_code_text)}</span>` : "—"}</td>
              <td data-label="Actions"><button type="button" class="btn secondary sm btn--block" data-order="${o.id}">View details</button></td>
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
      const bill = o.billing;

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
            <dd>${esc(ship.line1)}${ship.line2 ? `<br>${esc(ship.line2)}` : ""}<br>${esc(ship.city)}, ${esc(ship.state)} ${esc(ship.zip)}<br>${esc(ship.country || "US")}</dd>
          </div>
          ${
            bill
              ? `<div class="detail-block">
            <dt>Bill to</dt>
            <dd>${esc(bill.line1)}${bill.line2 ? `<br>${esc(bill.line2)}` : ""}<br>${esc(bill.city)}, ${esc(bill.state)} ${esc(bill.zip)}<br>${esc(bill.country || "US")}</dd>
          </div>`
              : ""
          }
          <div class="detail-block">
            <dt>Referral</dt>
            <dd>${o.referral_code_text ? esc(o.referral_code_text) : "None"}${o.barber_name ? `<br>Barber: ${esc(o.barber_name)}` : ""}</dd>
          </div>
        </div>

        <div class="modal-section">
          <h3 class="modal-section__title">Items ordered</h3>
          ${renderOrderItemsList(o.items)}
        </div>

        <div class="form-field">
          <label for="order-status-select">Update order status</label>
          <select id="order-status-select">
            ${["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"]
              .map((s) => `<option ${s === o.status ? "selected" : ""}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="form-actions form-actions--stack">
          <button type="button" class="btn btn--block" id="save-order-status">Save status</button>
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

  function barberBodyFromForm(fd) {
    return {
      name: String(fd.get("name") || "").trim(),
      email: String(fd.get("email") || "").trim(),
      phone: String(fd.get("phone") || "").trim(),
      commission_rate: parseFloat(fd.get("commission_rate")) || 10,
      active: fd.get("active") === "on",
    };
  }

  function openBarberEditor(b) {
    openModal(
      `Edit barber`,
      esc(b.name),
      `
      <form id="edit-barber-form" class="form-grid">
        <div class="form-field">
          <label>Name</label>
          <input name="name" value="${esc(b.name)}" required />
        </div>
        <div class="form-row">
          <div class="form-field">
            <label>Email</label>
            <input name="email" type="email" value="${esc(b.email || "")}" placeholder="optional" />
          </div>
          <div class="form-field">
            <label>Phone</label>
            <input name="phone" value="${esc(b.phone || "")}" placeholder="optional" />
          </div>
        </div>
        <div class="form-field">
          <label>Commission rate (%)</label>
          <input name="commission_rate" type="number" min="0" max="100" step="0.1" value="${b.commission_rate}" required />
        </div>
        <div class="switch-field">
          <input type="checkbox" id="edit-barber-active" name="active" ${b.active ? "checked" : ""} />
          <label for="edit-barber-active">Active (can use referral codes at checkout)</label>
        </div>
        <div class="form-actions form-actions--stack">
          <button type="submit" class="btn btn--block">Save changes</button>
        </div>
      </form>
      <div class="form-actions form-actions--stack" style="margin-top:0.5rem">
        <button type="button" class="btn danger btn--block" id="delete-barber-btn">Remove barber</button>
      </div>
      <p class="field-hint">Removing a barber deletes their codes and commission records. Past orders are kept but no longer linked to this barber.</p>`
    );

    document.getElementById("edit-barber-form").onsubmit = async (e) => {
      e.preventDefault();
      const body = barberBodyFromForm(new FormData(e.target));
      if (!body.name) {
        toast("Name is required", "error");
        return;
      }
      await api(`/barbers/${b.id}`, { method: "PUT", body });
      toast("Barber updated");
      closeModal();
      renderBarbers();
    };

    document.getElementById("delete-barber-btn").onclick = async () => {
      if (
        !confirm(
          `Remove "${b.name}"? Their referral codes and commission records will be deleted. Existing orders will stay in the store but won't be tied to this barber.`
        )
      ) {
        return;
      }
      await api(`/barbers/${b.id}`, { method: "DELETE" });
      toast("Barber removed");
      closeModal();
      renderBarbers();
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
          <div class="form-actions form-actions--stack">
            <button type="submit" class="btn btn--block">Save barber</button>
            <button type="button" class="btn ghost btn--block" id="cancel-add-barber">Cancel</button>
          </div>
        </form>
      </div>

      <div id="barber-list">${barbers.length ? "" : `<div class="card"><div class="empty-state"><strong>No barbers yet</strong><p>Add your first barber partner above.</p></div></div>`}</div>`;

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
            <p class="card__desc">${b.commission_rate}% commission · ${esc(b.email || "No email")}${b.phone ? ` · ${esc(b.phone)}` : ""}</p>
          </div>
          <div class="btn-group barber-card__actions">
            <button type="button" class="btn secondary sm" data-edit-barber="${b.id}">Edit</button>
            <button type="button" class="btn danger sm" data-del-barber="${b.id}">Remove</button>
          </div>
        </div>

        <div class="barber-card__stats">
          <div class="barber-stat"><span>Orders</span><strong>${b.stats.total_orders}</strong></div>
          <div class="barber-stat"><span>Total sales</span><strong>${money(b.stats.total_sales)}</strong></div>
          <div class="barber-stat"><span>Unpaid</span><strong>${money(b.stats.unpaid_commissions)}</strong></div>
          <div class="barber-stat"><span>Paid out</span><strong>${money(b.stats.paid_commissions)}</strong></div>
        </div>

        <div class="btn-group btn-group--stack">
          <button type="button" class="btn secondary sm" data-dashboard="${b.id}">View details</button>
          <button type="button" class="btn sm" data-gen-codes="${b.id}">Generate 5 codes</button>
          <button type="button" class="btn secondary sm" data-pay-all="${b.id}">Mark all paid</button>
        </div>

        <hr class="section-divider" />

        <h3 class="modal-section__title">Referral codes</h3>
        <div class="table-wrap table-wrap--stack">
          <table class="data-table data-table--stack">
            <thead><tr><th>Code</th><th>Status</th></tr></thead>
            <tbody>${b.referralCodes
              .map(
                (c) => `<tr>
              <td data-label="Code"><span class="code-chip">${esc(c.code)}</span></td>
              <td data-label="Status">${c.used_at ? '<span class="badge badge--danger">Used</span>' : '<span class="badge badge--success">Available</span>'}</td>
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
      const edit = e.target.closest("[data-edit-barber]");
      const del = e.target.closest("[data-del-barber]");
      const gen = e.target.closest("[data-gen-codes]");
      const pay = e.target.closest("[data-pay-all]");
      const dash = e.target.closest("[data-dashboard]");

      if (edit) {
        const b = barbers.find((x) => x.id == edit.dataset.editBarber);
        if (b) openBarberEditor(b);
      }
      if (del) {
        const b = barbers.find((x) => x.id == del.dataset.delBarber);
        if (!b) return;
        if (
          !confirm(
            `Remove "${b.name}"? Their referral codes and commission records will be deleted. Existing orders will stay but won't be tied to this barber.`
          )
        ) {
          return;
        }
        await api(`/barbers/${b.id}`, { method: "DELETE" });
        toast("Barber removed");
        renderBarbers();
      }
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
      if (dash) {
        const id = dash.dataset.dashboard;
        const barber = barbers.find((b) => String(b.id) === String(id));
        openModal(
          `${esc(barber?.name || "Barber")} — Details`,
          "Performance and commission history",
          `<div class="loading-state"><span class="loading-spinner"></span> Loading…</div>`
        );
        try {
          const data = await api(`/barbers/${id}/dashboard`);
          const s = data.stats || {};
          const stats = {
            totalOrders: s.totalOrders ?? s.total_orders ?? barber?.stats?.total_orders ?? 0,
            totalSales: s.totalSales ?? s.total_sales ?? barber?.stats?.total_sales ?? 0,
            unpaidCommissions:
              s.unpaidCommissions ?? s.unpaid_commissions ?? barber?.stats?.unpaid_commissions ?? 0,
            paidCommissions: s.paidCommissions ?? s.paid_commissions ?? barber?.stats?.paid_commissions ?? 0,
          };
          const orders = data.orders || [];
          const commissions = data.commissions || [];
          const customers = data.customers || [];

          openModal(
            `${esc(barber?.name || data.barber?.name || "Barber")} — Details`,
            "Performance and commission history",
            `
          <div class="barber-card__stats">
            <div class="barber-stat"><span>Orders</span><strong>${stats.totalOrders}</strong></div>
            <div class="barber-stat"><span>Sales</span><strong>${money(stats.totalSales)}</strong></div>
            <div class="barber-stat"><span>Unpaid</span><strong>${money(stats.unpaidCommissions)}</strong></div>
            <div class="barber-stat"><span>Paid</span><strong>${money(stats.paidCommissions)}</strong></div>
          </div>

          <div class="modal-section">
            <h3 class="modal-section__title">Referred orders</h3>
            ${
              orders.length
                ? `<div class="table-wrap table-wrap--stack">
              <table class="data-table data-table--stack">
                <thead><tr><th>Order</th><th>Customer</th><th>Total</th></tr></thead>
                <tbody>${orders
                  .map(
                    (o) => `<tr>
                      <td data-label="Order"><strong>${esc(o.order_number)}</strong></td>
                      <td data-label="Customer">${esc(o.customer_name)}<br><span class="product-meta">${esc(o.customer_email)}</span></td>
                      <td data-label="Total">${money(o.total)}</td>
                    </tr>`
                  )
                  .join("")}</tbody>
              </table>
            </div>`
                : `<p class="field-hint">No paid referred orders yet.</p>`
            }
          </div>

          <div class="modal-section">
            <h3 class="modal-section__title">Referred customers</h3>
            ${
              customers.length
                ? `<ul class="barber-customer-list">${customers.map((c) => `<li>${esc(c.name)} — ${esc(c.email)}</li>`).join("")}</ul>`
                : orders.length
                  ? `<p class="field-hint">Customer profiles were not stored for these orders.</p>`
                  : `<p class="field-hint">No referred customers yet.</p>`
            }
          </div>

          <div class="modal-section">
            <h3 class="modal-section__title">Commission history</h3>
            ${
              commissions.length
                ? `<div class="table-wrap table-wrap--stack">
              <table class="data-table data-table--stack">
                <thead><tr><th>Order</th><th>Amount</th><th>Status</th><th></th></tr></thead>
                <tbody class="comm-rows">${commissions
                  .map((c) => {
                    const order = orders.find((o) => String(o.id) === String(c.order_id));
                    return `<tr>
                      <td data-label="Order">${esc(order?.order_number || c.order_id)}</td>
                      <td data-label="Amount">${money(c.amount)}</td>
                      <td data-label="Status"><span class="badge ${c.status === "paid" ? "badge--success" : "badge--warning"}">${esc(c.status)}</span></td>
                      <td data-label="Actions">${c.status === "unpaid" ? `<button type="button" class="btn secondary sm btn--block" data-pay-comm="${c.id}">Mark paid</button>` : esc(c.paid_at || "—")}</td>
                    </tr>`;
                  })
                  .join("")}</tbody>
              </table>
            </div>`
                : `<p class="field-hint">No commissions recorded yet.</p>`
            }
          </div>`
          );

          modalRoot.querySelector(".comm-rows")?.addEventListener("click", async (ev) => {
            const pc = ev.target.closest("[data-pay-comm]");
            if (!pc) return;
            await api(`/commissions/${pc.dataset.payComm}/pay`, { method: "POST" });
            toast("Commission marked as paid");
            closeModal();
            renderBarbers();
          });
        } catch (err) {
          closeModal();
          toast(err.message || "Could not load barber details", "error");
        }
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
        <form id="content-form" class="form-grid form-grid--comfortable">
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
          <div class="form-actions form-actions--stack">
            <button type="submit" class="btn btn--block">Save changes</button>
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
          <button type="submit" class="btn secondary btn--block">Upload image</button>
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
      const heroInput = document.querySelector('[name="hero_image"]');
      if (heroInput) heroInput.value = r.url;
      document.getElementById("upload-result").textContent =
        "Uploaded! The hero image field was updated — click Save changes.";
      toast("Image uploaded — save homepage to apply");
    };
  }

  currentView = getViewFromHash();
  setActiveNav(currentView);
  showApp();
})();
