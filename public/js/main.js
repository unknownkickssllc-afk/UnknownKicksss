(function () {
  const header = document.getElementById("site-header");
  const heroPin = document.getElementById("hero-pin");
  const heroMedia = document.getElementById("hero-media");
  const heroTag = document.getElementById("hero-tag");
  const arrivalsWrap = document.getElementById("arrivals-wrap");
  const grid = document.getElementById("product-grid");
  const arrivalsTitle = document.getElementById("arrivals-title");
  const arrivalsSub = document.getElementById("arrivals-sub");
  const categoryFilters = document.getElementById("category-filters");

  let allProducts = [];
  let activeCategory = "";

  async function loadContent() {
    try {
      const c = await UK_API.get("/content");
      if (c.hero_tagline && heroTag) heroTag.textContent = c.hero_tagline;
      if (c.hero_image && heroMedia) {
        heroMedia.innerHTML = `<picture>
            <source media="(max-width: 768px)" srcset="mobilehero.png" />
            <img src="${c.hero_image}" alt="Unknown Kicks — sneakers and streetwear" width="1920" height="1080" />
          </picture>`;
      }
      if (c.arrivals_title && arrivalsTitle) {
        arrivalsTitle.innerHTML = `${c.arrivals_title} <span class="arrivals__count" id="arrivals-count"></span>`;
      }
      if (c.arrivals_subtitle && arrivalsSub) arrivalsSub.textContent = c.arrivals_subtitle;
    } catch (e) {
      console.warn("Content load:", e.message);
    }
  }

  async function loadCategories() {
    if (!categoryFilters) return;
    try {
      const cats = await UK_API.get("/categories");
      categoryFilters.innerHTML =
        `<button type="button" class="filter-btn is-active" data-cat="">All</button>` +
        cats
          .map(
            (c) =>
              `<button type="button" class="filter-btn" data-cat="${c.slug}">${c.name}</button>`
          )
          .join("");
      categoryFilters.addEventListener("click", (e) => {
        const btn = e.target.closest(".filter-btn");
        if (!btn) return;
        categoryFilters.querySelectorAll(".filter-btn").forEach((b) => {
          b.classList.toggle("is-active", b === btn);
        });
        activeCategory = btn.dataset.cat || "";
        renderGrid();
      });
    } catch (e) {
      console.warn(e);
    }
  }

  async function loadProducts() {
    try {
      const path = activeCategory ? `/products?category=${activeCategory}` : "/products";
      allProducts = await UK_API.get(path);
      renderGrid();
    } catch (e) {
      if (grid) grid.innerHTML = `<p class="error-msg">Unable to load products. Run npm run seed && npm start</p>`;
    }
  }

  function renderGrid() {
    if (!grid) return;
    const list = activeCategory
      ? allProducts
      : allProducts;
    const countEl = document.getElementById("arrivals-count");
    if (countEl) countEl.textContent = `/ ${list.length}`;

    grid.innerHTML = list
      .map((p) => {
        const primary = p.imagePrimary || p.gallery[0] || "";
        const hover = p.imageHover || primary;
        const sold = p.soldOut ? " (Sold out)" : "";
        return `
      <article class="product-card reveal ${p.soldOut ? "is-sold-out" : ""}" data-slug="${p.slug}">
        <a href="product.html?slug=${encodeURIComponent(p.slug)}">
          <div class="product-card__media">
            <img class="primary" src="${primary}" alt="${p.name}" loading="lazy" />
            <img class="hover" src="${hover}" alt="" loading="lazy" aria-hidden="true" />
          </div>
          <h3 class="product-card__name">${p.name}${sold}</h3>
          <p class="product-card__price">$${p.price.toFixed(2)} USD</p>
        </a>
      </article>`;
      })
      .join("");

    initReveal();
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const simpleHero = window.matchMedia("(max-width: 768px)").matches || reduceMotion;

  function onScroll() {
    const scrollY = window.scrollY;

    if (!simpleHero) {
      const pinHeight = heroPin ? heroPin.offsetHeight : window.innerHeight * 2;
      const progress = Math.min(1, scrollY / Math.max(1, pinHeight - window.innerHeight));

      if (heroMedia) {
        const scale = 1 + progress * 0.08;
        const y = progress * 12;
        heroMedia.style.transform = `scale(${scale}) translateY(${y}%)`;
      }

      if (arrivalsWrap && progress > 0.35) arrivalsWrap.classList.add("is-revealed");
    } else {
      if (heroMedia) heroMedia.style.transform = "";
      if (arrivalsWrap) arrivalsWrap.classList.add("is-revealed");
    }

    if (header) {
      const threshold = simpleHero ? 120 : window.innerHeight * 0.55;
      const useDark = scrollY > threshold;
      header.classList.toggle("site-header--light", !useDark);
      header.classList.toggle("site-header--dark", useDark);
    }
  }

  function initReveal() {
    const els = document.querySelectorAll(".reveal:not(.is-visible)");
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach((el) => io.observe(el));
  }

  loadContent();
  loadCategories().then(loadProducts);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  UK_CART.updateBadge();
})();
