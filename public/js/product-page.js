(function () {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug") || params.get("id");

  const titleEl = document.getElementById("product-title");
  const priceEl = document.getElementById("product-price");
  const detailsEl = document.getElementById("product-details");
  const sizeChartEl = document.getElementById("product-size-chart");
  const shippingEl = document.getElementById("product-shipping");
  const galleryEl = document.getElementById("product-gallery");
  const colorPickerEl = document.getElementById("color-picker");
  const sizePickerEl = document.getElementById("size-picker");
  const stockEl = document.getElementById("stock-status");
  const btnCart = document.getElementById("btn-cart");
  const btnCartPrice = document.getElementById("btn-cart-price");
  const colorValueEl = document.getElementById("color-value");
  const sizeValueEl = document.getElementById("size-value");

  let product = null;
  let selectedColor = null;
  let selectedSize = null;
  let selectedVariant = null;

  function variantsForColor(color) {
    return product.variants.filter((v) => v.color === color && v.stock > 0);
  }

  function updateStock() {
    if (!selectedVariant) {
      stockEl.textContent = product.soldOut ? "Sold out" : "Select size and color";
      stockEl.className = "stock-status stock-status--muted";
      btnCart.disabled = true;
      return;
    }
    if (selectedVariant.stock <= 3) {
      stockEl.textContent = `Only ${selectedVariant.stock} left`;
      stockEl.className = "stock-status stock-status--low";
    } else {
      stockEl.textContent = "In stock";
      stockEl.className = "stock-status stock-status--ok";
    }
    btnCart.disabled = product.soldOut;
    updatePickerLabels();
  }

  function renderColors() {
    const inStock = product.variants.filter((v) => v.stock > 0);
    const colors = [...new Set(inStock.map((v) => v.color))];
    colorPickerEl.innerHTML = colors
      .map(
        (c, i) =>
          `<button type="button" class="color-picker__btn${i === 0 ? " is-selected" : ""}" data-color="${c}" title="${c}" style="--swatch:${colorToCss(c)}"></button>`
      )
      .join("");
    selectedColor = colors[0] || null;
    renderSizes();
  }

  function colorToCss(name) {
    const map = {
      Black: "#111",
      White: "#f5f5f5",
      Charcoal: "#444",
      Navy: "#1e3a5f",
      Olive: "#4a5d3f",
      Stone: "#a8a29e",
      Cream: "#f3ead8",
      Periwinkle: "#8b9dc3",
      "Red/Black": "linear-gradient(135deg,#c41e3a 50%,#111 50%)",
      Multi: "linear-gradient(135deg,#111 33%,#fff 33%,#fff 66%,#888 66%)",
      "Black/White": "linear-gradient(135deg,#111 50%,#fff 50%)",
      "All Black": "#000",
    };
    return map[name] || "#ccc";
  }

  const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "OS", "8", "9", "10", "11", "12"];

  function sortSizes(sizes) {
    return [...sizes].sort((a, b) => {
      const ia = SIZE_ORDER.indexOf(a);
      const ib = SIZE_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }

  function renderSizes() {
    const variants = variantsForColor(selectedColor);
    const sizes = sortSizes([...new Set(variants.map((v) => v.size))]);
    sizePickerEl.innerHTML = sizes
      .map(
        (s, i) =>
          `<button type="button" class="size-picker__btn${i === 0 ? " is-selected" : ""}" data-size="${s}">${s}</button>`
      )
      .join("");
    selectedSize = sizes[0] || null;
    pickVariant();
  }

  function pickVariant() {
    selectedVariant = product.variants.find(
      (v) => v.color === selectedColor && v.size === selectedSize
    );
    updateStock();
    updateCartLabel();
  }

  function updatePickerLabels() {
    if (colorValueEl) {
      if (selectedColor) {
        colorValueEl.textContent = selectedColor;
        colorValueEl.hidden = false;
      } else {
        colorValueEl.hidden = true;
      }
    }
    if (sizeValueEl) {
      if (selectedSize) {
        sizeValueEl.textContent = selectedSize;
        sizeValueEl.hidden = false;
      } else {
        sizeValueEl.hidden = true;
      }
    }
  }

  function updateCartLabel() {
    if (!product) return;
    const price = product.price;
    const label = btnCart?.querySelector(".btn-cart__label");
    if (product.soldOut) {
      if (label) label.textContent = "Sold out";
      if (btnCartPrice) btnCartPrice.textContent = "";
      else if (btnCart) btnCart.textContent = "Sold out";
    } else {
      if (label) label.textContent = "Add to cart";
      if (btnCartPrice) btnCartPrice.textContent = `$${price.toFixed(2)}`;
      else if (btnCart) btnCart.textContent = `Add to cart — $${price.toFixed(2)}`;
    }
    updatePickerLabels();
  }

  colorPickerEl?.addEventListener("click", (e) => {
    const btn = e.target.closest(".color-picker__btn");
    if (!btn) return;
    colorPickerEl.querySelectorAll(".color-picker__btn").forEach((b) => {
      b.classList.toggle("is-selected", b === btn);
    });
    selectedColor = btn.dataset.color;
    renderSizes();
  });

  sizePickerEl?.addEventListener("click", (e) => {
    const btn = e.target.closest(".size-picker__btn");
    if (!btn) return;
    sizePickerEl.querySelectorAll(".size-picker__btn").forEach((b) => {
      b.classList.toggle("is-selected", b === btn);
    });
    selectedSize = btn.dataset.size;
    pickVariant();
  });

  btnCart?.addEventListener("click", () => {
    if (!selectedVariant || product.soldOut) return;
    UK_CART.add({
      variantId: selectedVariant.id,
      productId: product.id,
      slug: product.slug,
      name: product.name,
      size: selectedSize,
      color: selectedColor,
      price: product.price,
      quantity: 1,
      image: product.imagePrimary,
    });
    const label = btnCart.querySelector(".btn-cart__label");
    if (label) label.textContent = "Added to cart";
    else btnCart.textContent = "Added to cart";
    if (btnCartPrice) btnCartPrice.textContent = "";
    setTimeout(updateCartLabel, 1500);
    UK_CART.updateBadge();
  });

  function renderGallery(images) {
    const urls = images?.length ? images : [product?.imagePrimary].filter(Boolean);
    if (!urls.length) {
      galleryEl.innerHTML = "";
      return;
    }

    const multi = urls.length > 1;
    galleryEl.innerHTML = `
      <div class="product-gallery__viewport">
        <div class="product-gallery__track" id="gallery-track">
          ${urls
            .map(
              (src, i) => `
            <figure class="product-gallery__slide">
              <img src="${src}" alt="${product.name} — view ${i + 1}" loading="${i === 0 ? "eager" : "lazy"}" decoding="async" />
            </figure>`
            )
            .join("")}
        </div>
        ${
          multi
            ? `<button type="button" class="product-gallery__nav" id="gallery-next" aria-label="Next image">›</button>`
            : ""
        }
      </div>
      ${
        multi
          ? `<div class="product-gallery__dots" id="gallery-dots" role="tablist" aria-label="Choose image">
          ${urls
            .map(
              (_, i) =>
                `<button type="button" class="product-gallery__dot${i === 0 ? " is-active" : ""}" data-index="${i}" role="tab" aria-selected="${i === 0}" aria-label="Image ${i + 1}"></button>`
            )
            .join("")}
        </div>`
          : ""
      }`;

    if (!multi) return;

    const mobileGallery = window.matchMedia("(max-width: 1024px)");
    let index = 0;
    const viewport = galleryEl.querySelector(".product-gallery__viewport");
    const track = document.getElementById("gallery-track");
    const dots = galleryEl.querySelectorAll(".product-gallery__dot");
    const nextBtn = document.getElementById("gallery-next");

    function slideWidth() {
      return viewport?.clientWidth || galleryEl.clientWidth || 0;
    }

    function goTo(i) {
      index = ((i % urls.length) + urls.length) % urls.length;
      if (mobileGallery.matches) {
        track.style.transform = `translateX(-${index * slideWidth()}px)`;
      } else {
        track.style.transform = "";
      }
      dots.forEach((dot, j) => {
        const active = j === index;
        dot.classList.toggle("is-active", active);
        dot.setAttribute("aria-selected", active ? "true" : "false");
      });
    }

    function syncLayout() {
      if (mobileGallery.matches) {
        goTo(index);
      } else {
        track.style.transform = "";
      }
    }

    nextBtn.addEventListener("click", () => {
      if (mobileGallery.matches) goTo(index + 1);
    });
    dots.forEach((dot) => {
      dot.addEventListener("click", () => {
        if (mobileGallery.matches) goTo(parseInt(dot.dataset.index, 10));
      });
    });

    let touchStartX = 0;
    viewport.addEventListener(
      "touchstart",
      (e) => {
        if (!mobileGallery.matches) return;
        touchStartX = e.changedTouches[0].screenX;
      },
      { passive: true }
    );
    viewport.addEventListener(
      "touchend",
      (e) => {
        if (!mobileGallery.matches) return;
        const dx = e.changedTouches[0].screenX - touchStartX;
        if (Math.abs(dx) < 40) return;
        goTo(dx < 0 ? index + 1 : index - 1);
      },
      { passive: true }
    );

    window.addEventListener("resize", syncLayout, { passive: true });
    mobileGallery.addEventListener("change", syncLayout);
    syncLayout();
  }

  document.querySelectorAll("[data-accordion]").forEach((item) => {
    const trigger = item.querySelector(".accordion__trigger");
    trigger.addEventListener("click", () => {
      const isOpen = item.classList.contains("is-open");
      document.querySelectorAll("[data-accordion]").forEach((other) => {
        other.classList.remove("is-open");
        other.querySelector(".accordion__trigger").setAttribute("aria-expanded", "false");
      });
      if (!isOpen) {
        item.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
      }
    });
  });

  async function init() {
    if (!slug) {
      window.location.href = "index.html";
      return;
    }
    try {
      product = await UK_API.get(`/products/${slug}`);
    } catch {
      window.location.href = "index.html";
      return;
    }

    document.title = `${product.name} — Unknown Kicks`;
    titleEl.textContent = product.name;
    priceEl.textContent = `$${product.price.toFixed(2)}`;
    detailsEl.textContent = product.description;
    shippingEl.textContent =
      product.shippingInfo ||
      "Standard shipping 3–5 business days. Free returns within 14 days on unworn items.";

    if (product.sizeChart?.length) {
      sizeChartEl.innerHTML = `
        <table class="size-table">
          <thead><tr><th>Size</th><th>Chest</th><th>Length</th></tr></thead>
          <tbody>${product.sizeChart
            .map(
              (r) =>
                `<tr><td>${r.size}</td><td>${r.chest || "—"}</td><td>${r.length || "—"}</td></tr>`
            )
            .join("")}</tbody>
        </table>`;
    } else {
      sizeChartEl.textContent = "See product description for fit notes.";
    }

    renderGallery(product.gallery);

    if (product.soldOut) {
      stockEl.textContent = "Sold out";
      stockEl.className = "stock-status stock-status--muted";
      btnCart.disabled = true;
    } else {
      renderColors();
    }
    updateCartLabel();
    UK_CART.updateBadge();
  }

  init();
})();
