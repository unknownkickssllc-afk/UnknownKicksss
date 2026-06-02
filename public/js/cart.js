window.UK_CART = (function () {
  const KEY = "uk_cart";

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch {
      return [];
    }
  }

  function save(items) {
    localStorage.setItem(KEY, JSON.stringify(items));
    updateBadge();
  }

  function count() {
    return load().reduce((s, i) => s + i.quantity, 0);
  }

  function updateBadge() {
    const n = count();
    document.querySelectorAll("[data-cart-count]").forEach((el) => {
      el.textContent = `Cart (${n})`;
    });
  }

  function add(item) {
    const items = load();
    const idx = items.findIndex((i) => i.variantId === item.variantId);
    if (idx >= 0) {
      items[idx].quantity += item.quantity;
    } else {
      items.push({ ...item });
    }
    save(items);
    return items;
  }

  function setQty(variantId, quantity) {
    let items = load();
    if (quantity <= 0) {
      items = items.filter((i) => i.variantId !== variantId);
    } else {
      const row = items.find((i) => i.variantId === variantId);
      if (row) row.quantity = quantity;
    }
    save(items);
    return items;
  }

  function remove(variantId) {
    return setQty(variantId, 0);
  }

  function clear() {
    save([]);
  }

  document.addEventListener("DOMContentLoaded", updateBadge);

  return { load, save, add, setQty, remove, clear, count, updateBadge };
})();
