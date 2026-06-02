(function () {
  const emptyEl = document.getElementById("cart-empty");
  const contentEl = document.getElementById("cart-content");
  const continueEl = document.getElementById("cart-continue");
  const itemsEl = document.getElementById("cart-items");
  const subtotalEl = document.getElementById("cart-subtotal");
  const totalEl = document.getElementById("cart-total");
  const countEl = document.getElementById("cart-item-count");

  function render() {
    const items = UK_CART.load();
    UK_CART.updateBadge();

    if (!items.length) {
      emptyEl.hidden = false;
      contentEl.hidden = true;
      if (continueEl) continueEl.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    contentEl.hidden = false;
    if (continueEl) continueEl.hidden = false;

    let subtotal = 0;
    let itemCount = 0;

    itemsEl.innerHTML = items
      .map((item) => {
        const line = item.price * item.quantity;
        subtotal += line;
        itemCount += item.quantity;
        const slug = encodeURIComponent(item.slug || "");
        const href = `product.html?slug=${slug}`;

        return `
        <article class="cart-card" data-variant="${item.variantId}">
          <a class="cart-card__media" href="${href}">
            <img src="${item.image || ""}" alt="" width="96" height="120" />
          </a>
          <div class="cart-card__body">
            <a class="cart-card__name" href="${href}">${item.name}</a>
            <div class="cart-card__meta">
              <span class="cart-card__tag"><span class="cart-card__tag-label">Size</span> ${item.size}</span>
              <span class="cart-card__tag"><span class="cart-card__tag-label">Color</span> ${item.color}</span>
            </div>
            <p class="cart-card__price">$${line.toFixed(2)}</p>
          </div>
          <div class="cart-card__actions">
            <div class="qty-stepper">
              <button type="button" class="qty-stepper__btn" data-qty-minus="${item.variantId}" aria-label="Decrease quantity">−</button>
              <span class="qty-stepper__val">${item.quantity}</span>
              <button type="button" class="qty-stepper__btn" data-qty-plus="${item.variantId}" aria-label="Increase quantity">+</button>
            </div>
            <button type="button" class="link-btn cart-card__remove" data-remove="${item.variantId}">Remove</button>
          </div>
        </article>`;
      })
      .join("");

    const formatted = `$${subtotal.toFixed(2)}`;
    subtotalEl.textContent = formatted;
    totalEl.textContent = formatted;
    countEl.textContent = String(itemCount);
  }

  itemsEl.addEventListener("click", (e) => {
    const minus = e.target.closest("[data-qty-minus]");
    if (minus) {
      const id = parseInt(minus.dataset.qtyMinus, 10);
      const row = UK_CART.load().find((i) => i.variantId === id);
      if (row) UK_CART.setQty(id, row.quantity - 1);
      render();
      return;
    }

    const plus = e.target.closest("[data-qty-plus]");
    if (plus) {
      const id = parseInt(plus.dataset.qtyPlus, 10);
      const row = UK_CART.load().find((i) => i.variantId === id);
      if (row) UK_CART.setQty(id, Math.min(99, row.quantity + 1));
      render();
      return;
    }

    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    UK_CART.remove(parseInt(btn.dataset.remove, 10));
    render();
  });

  render();
})();
