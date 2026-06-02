(function () {
  const params = new URLSearchParams(window.location.search);
  const orderNumber = params.get("order");
  const loading = document.getElementById("confirm-loading");
  const body = document.getElementById("confirm-body");
  const errorWrap = document.getElementById("confirm-error");
  const errorMsg = document.getElementById("confirm-error-msg");
  const detailsEl = document.getElementById("confirm-details");
  const summaryEl = document.getElementById("confirm-summary");
  const numEl = document.getElementById("order-number");

  function esc(text) {
    const el = document.createElement("span");
    el.textContent = text ?? "";
    return el.innerHTML;
  }

  function formatMoney(amount) {
    return `$${Number(amount).toFixed(2)}`;
  }

  function formatAddress(addr) {
    if (!addr) return "";
    return `
            ${esc(addr.line1)}<br />
            ${addr.line2 ? `${esc(addr.line2)}<br />` : ""}
            ${esc(addr.city)}, ${esc(addr.state)} ${esc(addr.zip)}<br />
            ${esc(addr.country || "US")}`;
  }

  function paymentLabel(status) {
    if (status === "paid") return "Paid";
    if (status === "pending") return "Pending";
    return status ? String(status) : "—";
  }

  function showError(message) {
    loading.hidden = true;
    body.hidden = true;
    errorMsg.textContent = message;
    errorWrap.hidden = false;
  }

  async function enrichItemImages(items) {
    if (!items.length || items.every((item) => item.image)) return items;

    try {
      const products = await UK_API.get("/products");
      const imageByProductId = Object.fromEntries(
        products.map((p) => [p.id, p.imagePrimary || p.images?.[0]?.url || null])
      );
      return items.map((item) => ({
        ...item,
        image: item.image || imageByProductId[item.product_id] || null,
      }));
    } catch {
      return items;
    }
  }

  if (!orderNumber) {
    showError("No order specified.");
    return;
  }

  UK_API.post(`/checkout/verify/${encodeURIComponent(orderNumber)}`, {})
    .catch(() => UK_API.get(`/checkout/order/${encodeURIComponent(orderNumber)}`))
    .then(async (order) => {
      if (window.UK_CART) UK_CART.clear();

      loading.hidden = true;
      body.hidden = false;
      numEl.textContent = order.order_number;

      const ship = order.shipping || {};
      const bill = order.billing || null;
      const items = await enrichItemImages(order.items || []);
      const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
      const paid = order.payment_status === "paid";

      detailsEl.innerHTML = `
        <section class="confirm-card">
          <h2 class="confirm-card__title">Customer</h2>
          <dl class="confirm-dl">
            <div class="confirm-dl__row">
              <dt>Name</dt>
              <dd>${esc(order.customer_name)}</dd>
            </div>
            <div class="confirm-dl__row">
              <dt>Email</dt>
              <dd>${esc(order.customer_email)}</dd>
            </div>
            <div class="confirm-dl__row">
              <dt>Phone</dt>
              <dd>${esc(order.customer_phone || "—")}</dd>
            </div>
          </dl>
        </section>

        <section class="confirm-card">
          <h2 class="confirm-card__title">Shipping address</h2>
          <address class="confirm-address">${formatAddress(ship)}</address>
        </section>
        ${
          bill
            ? `<section class="confirm-card">
          <h2 class="confirm-card__title">Billing address</h2>
          <address class="confirm-address">${formatAddress(bill)}</address>
        </section>`
            : ""
        }
        ${
          order.referral_code_text
            ? `<section class="confirm-card">
          <h2 class="confirm-card__title">Referral</h2>
          <dl class="confirm-dl">
            <div class="confirm-dl__row">
              <dt>Code</dt>
              <dd>${esc(order.referral_code_text)}</dd>
            </div>
            <div class="confirm-dl__row">
              <dt>Barber</dt>
              <dd>${esc(order.barber_name || "—")}</dd>
            </div>
          </dl>
        </section>`
            : ""
        }`;

      const itemsHtml = items
        .map(
          (item) => `
        <article class="confirm-item">
          <div class="confirm-item__thumb${item.image ? "" : " confirm-item__thumb--empty"}">
            ${item.image ? `<img src="${esc(item.image)}" alt="" width="56" height="70" loading="lazy" />` : ""}
          </div>
          <div class="confirm-item__body">
            <p class="confirm-item__name">${esc(item.product_name)}</p>
            <p class="confirm-item__meta">${esc(item.color)} · ${esc(item.size)} · Qty ${item.quantity}</p>
          </div>
          <p class="confirm-item__price">${formatMoney(item.line_total)}</p>
        </article>`
        )
        .join("");

      summaryEl.innerHTML = `
        <div class="confirm-summary__head">
          <h2 class="confirm-summary__title">Order summary</h2>
          <span class="confirm-badge${paid ? " confirm-badge--paid" : ""}">${esc(paymentLabel(order.payment_status))}</span>
        </div>
        <div class="confirm-summary__items">${itemsHtml}</div>
        <div class="confirm-summary__row">
          <span>Subtotal (${itemCount} item${itemCount === 1 ? "" : "s"})</span>
          <span>${formatMoney(order.subtotal ?? order.total)}</span>
        </div>
        <div class="confirm-summary__divider"></div>
        <div class="confirm-summary__row confirm-summary__row--total">
          <span>Total</span>
          <strong>${formatMoney(order.total)}</strong>
        </div>`;
    })
    .catch((e) => {
      showError(e.message);
    });
})();
