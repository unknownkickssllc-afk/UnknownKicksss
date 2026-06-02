(function () {
  const form = document.getElementById("checkout-form");
  const itemsEl = document.getElementById("checkout-items");
  const subtotalEl = document.getElementById("checkout-subtotal");
  const totalEl = document.getElementById("checkout-total");
  const countEl = document.getElementById("checkout-item-count");
  const payBtnAmountEl = document.getElementById("pay-btn-amount");
  const errorEl = document.getElementById("checkout-error");
  const referralInput = document.getElementById("referral-code");
  const referralStatus = document.getElementById("referral-status");
  const payBtn = document.getElementById("pay-btn");
  const billingSameInput = form.querySelector('[name="billingSame"]');
  const billingFields = document.getElementById("billing-fields");
  const paymentLoading = document.getElementById("payment-loading");
  const paymentMount = document.getElementById("payment-element");
  const paymentError = document.getElementById("payment-error");
  const paymentDev = document.getElementById("payment-dev");

  const items = UK_CART.load();
  if (!items.length) {
    window.location.href = "cart.html";
    return;
  }

  let referralValid = null;
  let debounce;
  let stripe = null;
  let elements = null;
  let clientSecret = null;
  let paymentIntentId = null;
  let devMode = false;

  const stripeAppearance = {
    theme: "stripe",
    variables: {
      colorPrimary: "#0a0a0a",
      colorBackground: "#ffffff",
      colorText: "#0a0a0a",
      colorDanger: "#a32a2a",
      fontFamily: '"Inter", system-ui, sans-serif',
      borderRadius: "0px",
      spacingUnit: "4px",
    },
    rules: {
      ".Input": {
        border: "1px solid #e5e5e5",
        boxShadow: "none",
      },
      ".Label": {
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontSize: "10px",
      },
    },
  };

  function cartPayloadItems() {
    return items.map((i) => ({
      variantId: i.variantId,
      quantity: i.quantity,
      image: i.image,
    }));
  }

  function subtotal() {
    return items.reduce((s, i) => s + i.price * i.quantity, 0);
  }

  function itemCount() {
    return items.reduce((s, i) => s + i.quantity, 0);
  }

  function formatMoney(amount) {
    return `$${amount.toFixed(2)}`;
  }

  function showPaymentError(message) {
    paymentError.textContent = message;
    paymentError.hidden = false;
  }

  function renderSummary() {
    const total = subtotal();
    const count = itemCount();

    itemsEl.innerHTML = items
      .map((item) => {
        const line = item.price * item.quantity;
        const href = `product.html?slug=${encodeURIComponent(item.slug || "")}`;
        return `
        <article class="checkout-order__item">
          <a class="checkout-order__thumb" href="${href}">
            <img src="${item.image || ""}" alt="" width="56" height="70" />
          </a>
          <div class="checkout-order__item-body">
            <a class="checkout-order__item-name" href="${href}">${item.name}</a>
            <p class="checkout-order__item-meta">Color: ${item.color} · Size: ${item.size} · Qty: ${item.quantity}</p>
            <p class="checkout-order__item-price">${formatMoney(line)}</p>
          </div>
        </article>`;
      })
      .join("");

    const formatted = formatMoney(total);
    subtotalEl.textContent = formatted;
    totalEl.textContent = formatted;
    payBtnAmountEl.textContent = formatted;
    countEl.textContent = String(count);
  }

  function getBillingAddress(fd, shipping) {
    if (fd.get("billingSame") === "on") return shipping;
    return {
      line1: fd.get("billLine1") || shipping.line1,
      line2: fd.get("billLine2") || "",
      city: fd.get("billCity") || shipping.city,
      state: fd.get("billState") || shipping.state,
      zip: fd.get("billZip") || shipping.zip,
      country: shipping.country,
    };
  }

  function buildPayload(fd) {
    const firstName = fd.get("firstName")?.trim() || "";
    const lastName = fd.get("lastName")?.trim() || "";
    const shipping = {
      line1: fd.get("line1")?.trim(),
      line2: fd.get("line2")?.trim() || "",
      city: fd.get("city")?.trim(),
      state: fd.get("state")?.trim(),
      zip: fd.get("zip")?.trim(),
      country: fd.get("country")?.trim() || "US",
    };

    return {
      items: cartPayloadItems(),
      customer: {
        name: `${firstName} ${lastName}`.trim(),
        email: fd.get("email")?.trim(),
        phone: fd.get("phone")?.trim(),
      },
      shipping,
      billing: getBillingAddress(fd, shipping),
      billingSame: fd.get("billingSame") === "on",
      referralCode: fd.get("referralCode")?.trim() || undefined,
      paymentIntentId,
    };
  }

  function mountPaymentElement(paymentElement) {
    return new Promise((resolve, reject) => {
      paymentElement.on("ready", resolve);
      paymentElement.on("loaderror", (event) => {
        reject(new Error(event.error?.message || "Payment form failed to load."));
      });
      paymentElement.mount("#payment-element");
    });
  }

  async function initStripe() {
    if (typeof Stripe === "undefined") {
      throw new Error("Stripe.js failed to load. Check your connection or disable ad blockers.");
    }

    paymentLoading.hidden = false;
    paymentMount.hidden = true;
    paymentDev.hidden = true;
    paymentError.hidden = true;

    const prep = await UK_API.post("/checkout/prepare-payment", { items: cartPayloadItems() });
    devMode = prep.devMode;

    if (devMode) {
      paymentLoading.hidden = true;
      paymentDev.hidden = false;
      return;
    }

    stripe = Stripe(prep.publishableKey);
    clientSecret = prep.clientSecret;
    paymentIntentId = prep.paymentIntentId;

    elements = stripe.elements({
      clientSecret: prep.clientSecret,
      appearance: stripeAppearance,
    });

    const paymentElement = elements.create("payment");
    await mountPaymentElement(paymentElement);

    paymentLoading.hidden = true;
    paymentMount.hidden = false;
  }

  billingSameInput.addEventListener("change", () => {
    billingFields.hidden = billingSameInput.checked;
  });

  referralInput.addEventListener("input", () => {
    clearTimeout(debounce);
    const code = referralInput.value.trim();
    if (!code) {
      referralStatus.textContent = "";
      referralValid = null;
      return;
    }
    debounce = setTimeout(async () => {
      try {
        const r = await UK_API.get(`/referral/validate?code=${encodeURIComponent(code)}`);
        if (r.valid) {
          referralValid = true;
          referralStatus.textContent = `Valid — referred by ${r.barberName}`;
          referralStatus.className = "referral-status is-valid";
        } else {
          referralValid = false;
          referralStatus.textContent = r.error || "Invalid code";
          referralStatus.className = "referral-status is-invalid";
        }
      } catch {
        referralStatus.textContent = "Could not validate code";
        referralStatus.className = "referral-status is-invalid";
      }
    }, 400);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    payBtn.disabled = true;
    payBtn.textContent = "Processing…";

    const fd = new FormData(form);
    const payload = buildPayload(fd);

    if (payload.referralCode && referralValid === false) {
      errorEl.textContent = "Fix or remove the invalid referral code.";
      errorEl.hidden = false;
      payBtn.disabled = false;
      payBtn.innerHTML = `Place order — <span id="pay-btn-amount">${formatMoney(subtotal())}</span>`;
      return;
    }

    try {
      if (devMode) {
        const done = await UK_API.post("/checkout/complete-dev", payload);
        UK_CART.clear();
        window.location.href = `confirmation.html?order=${done.order.order_number}`;
        return;
      }

      if (!elements || !clientSecret || !paymentIntentId) {
        throw new Error("Payment form is not ready. Refresh the page and try again.");
      }

      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw new Error(submitError.message);
      }

      const finalized = await UK_API.post("/checkout/finalize-order", payload);
      const billing = payload.billing;

      const { error } = await stripe.confirmPayment({
        elements,
        clientSecret: finalized.clientSecret || clientSecret,
        confirmParams: {
          return_url: `${window.location.origin}/confirmation.html?order=${encodeURIComponent(finalized.orderNumber)}`,
          payment_method_data: {
            billing_details: {
              name: payload.customer.name,
              email: payload.customer.email,
              phone: payload.customer.phone,
              address: {
                line1: billing.line1,
                line2: billing.line2 || undefined,
                city: billing.city,
                state: billing.state,
                postal_code: billing.zip,
                country: billing.country,
              },
            },
          },
        },
      });

      if (error) {
        throw new Error(error.message || "Payment could not be completed.");
      }

      UK_CART.clear();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      payBtn.disabled = false;
      payBtn.innerHTML = `Place order — <span id="pay-btn-amount">${formatMoney(subtotal())}</span>`;
    }
  });

  renderSummary();
  initStripe().catch((err) => {
    paymentLoading.hidden = true;
    showPaymentError(err.message || "Could not load payment form.");
  });
})();
