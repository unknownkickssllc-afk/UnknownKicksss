(function () {
  const form = document.getElementById("checkout-form");
  const itemsEl = document.getElementById("checkout-items");
  const totalEl = document.getElementById("checkout-total");
  const errorEl = document.getElementById("checkout-error");
  const referralInput = document.getElementById("referral-code");
  const referralStatus = document.getElementById("referral-status");
  const payBtn = document.getElementById("pay-btn");

  const items = UK_CART.load();
  if (!items.length) {
    window.location.href = "cart.html";
    return;
  }

  let referralValid = null;
  let debounce;

  function subtotal() {
    return items.reduce((s, i) => s + i.price * i.quantity, 0);
  }

  itemsEl.innerHTML = items
    .map(
      (i) =>
        `<li>${i.name} — ${i.size} / ${i.color} × ${i.quantity} — $${(i.price * i.quantity).toFixed(2)}</li>`
    )
    .join("");
  totalEl.textContent = `$${subtotal().toFixed(2)}`;

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
    const referralCode = fd.get("referralCode")?.trim() || "";
    if (referralCode && referralValid === false) {
      errorEl.textContent = "Fix or remove the invalid referral code.";
      errorEl.hidden = false;
      payBtn.disabled = false;
      payBtn.textContent = "Pay securely";
      return;
    }

    const payload = {
      items: items.map((i) => ({
        variantId: i.variantId,
        quantity: i.quantity,
        image: i.image,
      })),
      customer: {
        name: fd.get("name"),
        email: fd.get("email"),
        phone: fd.get("phone"),
      },
      shipping: {
        line1: fd.get("line1"),
        line2: fd.get("line2") || "",
        city: fd.get("city"),
        state: fd.get("state"),
        zip: fd.get("zip"),
        country: fd.get("country"),
      },
      referralCode: referralCode || undefined,
    };

    try {
      const session = await UK_API.post("/checkout/create-session", payload);

      if (session.url) {
        UK_CART.clear();
        window.location.href = session.url;
        return;
      }

      if (session.devMode) {
        const done = await UK_API.post("/checkout/complete-dev", payload);
        UK_CART.clear();
        window.location.href = `confirmation.html?order=${done.order.order_number}`;
        return;
      }
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }

    payBtn.disabled = false;
    payBtn.textContent = "Pay securely";
  });
})();
