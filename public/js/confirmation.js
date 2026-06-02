(function () {
  const params = new URLSearchParams(window.location.search);
  const orderNumber = params.get("order");
  const loading = document.getElementById("confirm-loading");
  const body = document.getElementById("confirm-body");
  const errorEl = document.getElementById("confirm-error");
  const detailsEl = document.getElementById("confirm-details");
  const numEl = document.getElementById("order-number");

  if (!orderNumber) {
    loading.hidden = true;
    errorEl.textContent = "No order specified.";
    errorEl.hidden = false;
    return;
  }

  UK_API.post(`/checkout/verify/${encodeURIComponent(orderNumber)}`, {})
    .catch(() => UK_API.get(`/checkout/order/${encodeURIComponent(orderNumber)}`))
    .then((order) => {
      if (window.UK_CART) UK_CART.clear();
      loading.hidden = true;
      body.hidden = false;
      numEl.textContent = order.order_number;

      const ship = order.shipping;
      const itemsHtml = order.items
        .map(
          (i) =>
            `<li>${i.product_name} — ${i.size} / ${i.color} × ${i.quantity} — $${i.line_total.toFixed(2)}</li>`
        )
        .join("");

      detailsEl.innerHTML = `
        <div class="confirm-block">
          <h3>Customer</h3>
          <p>${order.customer_name}<br>${order.customer_email}<br>${order.customer_phone || "—"}</p>
        </div>
        <div class="confirm-block">
          <h3>Shipping</h3>
          <p>${ship.line1}${ship.line2 ? "<br>" + ship.line2 : ""}<br>${ship.city}, ${ship.state} ${ship.zip}<br>${ship.country}</p>
        </div>
        <div class="confirm-block">
          <h3>Products</h3>
          <ul>${itemsHtml}</ul>
          <p><strong>Total: $${order.total.toFixed(2)}</strong></p>
          <p>Payment: ${order.payment_status}</p>
        </div>
        ${
          order.referral_code_text
            ? `<div class="confirm-block">
          <h3>Referral</h3>
          <p>Code: ${order.referral_code_text}<br>Barber: ${order.barber_name || "—"}</p>
        </div>`
            : ""
        }`;
    })
    .catch((e) => {
      loading.hidden = true;
      errorEl.textContent = e.message;
      errorEl.hidden = false;
    });
})();
