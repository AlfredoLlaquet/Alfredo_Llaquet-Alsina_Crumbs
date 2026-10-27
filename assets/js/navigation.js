/* Sticky desktop branding and a single-level phone menu. */
(() => {
  "use strict";

  const header = document.getElementById("crumbs-navigation");
  const trigger = document.getElementById("crumbs-nav-trigger");
  const toggle = document.getElementById("crumbs-menu-toggle");
  const links = document.getElementById("crumbs-menu-links");
  const hero = document.getElementById("top");
  if (!header || !trigger || !toggle || !links || !hero) return;

  const phone = window.matchMedia("(max-width: 600px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let updatePending = false;
  let scrollOffset = 0;

  header.classList.add("js-enhanced");

  function closeMenu(returnFocus = false) {
    header.classList.remove("is-menu-open");
    toggle.setAttribute("aria-expanded", "false");
    if (returnFocus) toggle.focus();
  }

  function updateHeader() {
    updatePending = false;
    const brandHeight = phone.matches ? 0 : header.clientWidth * 188 / 2048;
    header.style.setProperty("--crumbs-brand-height", `${brandHeight}px`);
    // Match the sticky top inset, including the compact logo on desktop.
    header.classList.toggle("is-stuck", trigger.getBoundingClientRect().top <= brandHeight);

    // Anticipate the compact desktop logo even when a link is used at the top.
    scrollOffset = Math.ceil(header.getBoundingClientRect().height + brandHeight) + 12;
    document.documentElement.style.setProperty("--crumbs-scroll-offset", `${scrollOffset}px`);
  }

  function scheduleUpdate() {
    if (updatePending) return;
    updatePending = true;
    window.requestAnimationFrame(updateHeader);
  }

  function navigate(hash, smooth, moveFocus) {
    let id;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch (_) {
      return false;
    }
    const target = document.getElementById(id);
    if (!target) return false;

    closeMenu();
    updateHeader();
    const top = id === "top" ? 0 : target.getBoundingClientRect().top + window.scrollY - scrollOffset;
    if (moveFocus) {
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }
    window.scrollTo({
      top: Math.max(0, top),
      behavior: smooth && !reducedMotion.matches ? "smooth" : "auto"
    });
    return true;
  }

  toggle.addEventListener("click", () => {
    if (!phone.matches) return;
    const open = !header.classList.contains("is-menu-open");
    header.classList.toggle("is-menu-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });

  header.addEventListener("click", event => {
    const link = event.target.closest("a[href^='#']");
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const hash = link.getAttribute("href");
    if (!navigate(hash, true, true)) return;
    event.preventDefault();
    if (window.location.hash !== hash) window.history.pushState(window.history.state, "", hash);
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && header.classList.contains("is-menu-open")) {
      closeMenu(true);
    }
  });

  document.addEventListener("click", event => {
    if (!header.contains(event.target)) closeMenu();
  });

  document.addEventListener("focusin", event => {
    if (!header.contains(event.target)) closeMenu();
  });

  phone.addEventListener("change", () => {
    // Keep focus usable if a resize hides a focused phone-menu link or button.
    const focused = document.activeElement;
    if (phone.matches && links.contains(focused)) toggle.focus();
    if (!phone.matches && focused === toggle) links.querySelector("a").focus();
    closeMenu();
    updateHeader();
  });

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate, { passive: true });
  window.addEventListener("hashchange", () => navigate(window.location.hash, false, false));
  window.addEventListener("pageshow", scheduleUpdate);

  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(header);
    observer.observe(hero);
  }

  function alignInitialLink() {
    updateHeader();
    if (window.location.hash) navigate(window.location.hash, false, false);
  }

  updateHeader();
  if (document.readyState === "complete") alignInitialLink();
  else window.addEventListener("load", alignInitialLink, { once: true });
})();
