(function () {
  const emptyEl = document.getElementById("cart-empty");
  const contentEl = document.getElementById("cart-content");
  const rowsEl = document.getElementById("cart-rows");
  const subtotalEl = document.getElementById("cart-subtotal");

  function render() {
    const items = UK_CART.load();
    UK_CART.updateBadge();

    if (!items.length) {
      emptyEl.hidden = false;
      contentEl.hidden = true;
      return;
    }

    emptyEl.hidden = true;
    contentEl.hidden = false;

    let subtotal = 0;
    rowsEl.innerHTML = items
      .map((item) => {
        const line = item.price * item.quantity;
        subtotal += line;
        return `
        <tr data-variant="${item.variantId}">
          <td class="cart-product">
            <img src="${item.image || ""}" alt="" width="64" height="80" />
            <div>
              <a href="product.html?slug=${encodeURIComponent(item.slug || "")}">${item.name}</a>
            </div>
          </td>
          <td>${item.size}</td>
          <td>${item.color}</td>
          <td>
            <input type="number" class="qty-input" min="1" max="99" value="${item.quantity}" data-variant="${item.variantId}" />
          </td>
          <td>$${line.toFixed(2)}</td>
          <td><button type="button" class="link-btn" data-remove="${item.variantId}">Remove</button></td>
        </tr>`;
      })
      .join("");

    subtotalEl.textContent = `$${subtotal.toFixed(2)}`;
  }

  rowsEl.addEventListener("change", (e) => {
    if (!e.target.classList.contains("qty-input")) return;
    UK_CART.setQty(parseInt(e.target.dataset.variant, 10), parseInt(e.target.value, 10));
    render();
  });

  rowsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    UK_CART.remove(parseInt(btn.dataset.remove, 10));
    render();
  });

  render();
})();
