(function () {
  const header = document.querySelector(".site-header");
  const nav = header?.querySelector(".nav-left");
  if (!header || !nav) return;

  nav.id = "primary-nav";

  let toggle = header.querySelector(".nav-toggle");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-toggle";
    toggle.setAttribute("aria-label", "Open menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "primary-nav");
    toggle.innerHTML = "<span></span><span></span><span></span>";
    header.insertBefore(toggle, nav);
  }

  function setOpen(open) {
    header.classList.toggle("is-nav-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    document.body.classList.toggle("nav-open", open);
  }

  toggle.addEventListener("click", () => setOpen(!header.classList.contains("is-nav-open")));

  nav.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => setOpen(false));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  window.addEventListener(
    "resize",
    () => {
      if (window.innerWidth > 768) setOpen(false);
    },
    { passive: true }
  );
})();
