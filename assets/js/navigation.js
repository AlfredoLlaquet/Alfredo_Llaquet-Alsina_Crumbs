/* Sticky branding, a phone menu, batch exits, and desktop section tracking. */
(() => {
  "use strict";

  const header = document.getElementById("crumbs-navigation");
  const trigger = document.getElementById("crumbs-nav-trigger");
  const toggle = document.getElementById("crumbs-menu-toggle");
  const links = document.getElementById("crumbs-menu-links");
  const hero = document.getElementById("top");
  if (!header || !trigger || !toggle || !links || !hero) return;

  const phoneBrand = header.querySelector(".crumbs-phone-brand");
  const phoneBrandImage = phoneBrand?.querySelector("img");
  const nextSection = document.getElementById("crumbs-next-section");
  const prevSection = document.getElementById("crumbs-prev-section");
  const batchControls = [prevSection, nextSection].filter(Boolean);
  const latest = document.getElementById("latest");
  const disclaimer = document.getElementById("disclaimer");
  const appendix = document.getElementById("automated-readers");
  const sections = Array.from(links.querySelectorAll('a[href^="#"]'), link => ({
    link,
    target: document.getElementById(link.getAttribute("href").slice(1))
  })).filter(section => section.target);
  const appendixIsLinked = sections.some(section => section.target === appendix);
  const phone = window.matchMedia("(max-width: 600px)");
  const content = header.closest(".markdown-body");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const sectionGap = 12;
  let updatePending = false;
  let scrollOffset = 0;
  let currentSectionLink = null;

  // Fixed scroll controls beside the list; they never cover or move a link.
  const menuScrollHint = document.createElement("span");
  menuScrollHint.className = "crumbs-menu-scroll-hint";
  menuScrollHint.hidden = true;
  menuScrollHint.setAttribute("role", "group");
  menuScrollHint.setAttribute("aria-label", "Menu scroll controls");
  function createMenuScrollButton(direction, label, arrow) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `crumbs-menu-scroll-button crumbs-scroll-${direction}`;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-controls", links.id);
    button.title = label;
    button.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" focusable="false" aria-hidden="true"><path d="M12 2v20"/><path d="${arrow}"/></svg>`;
    button.addEventListener("click", () => {
      if (!phone.matches || !header.classList.contains("is-menu-open") || menuScrollHint.hidden) return;
      links.scrollTop = direction === "up" ? 0 : links.scrollHeight - links.clientHeight;
      updateMenuScrollHint();
    });
    menuScrollHint.append(button);
    return button;
  }
  const menuScrollUp = createMenuScrollButton("up", "Scroll menu to top", "m5 9 7-7 7 7");
  const menuScrollDown = createMenuScrollButton("down", "Scroll menu to bottom", "m5 15 7 7 7-7");
  header.append(menuScrollHint);

  function updateMenuScrollHint() {
    const focused = document.activeElement;
    const maxScroll = links.scrollHeight - links.clientHeight;
    menuScrollHint.hidden = !phone.matches || !header.classList.contains("is-menu-open") ||
      links.clientHeight === 0 || maxScroll <= 2;
    if (menuScrollHint.hidden) {
      if (menuScrollHint.contains(focused)) {
        (phone.matches ? toggle : links.querySelector("a"))?.focus({ preventScroll: true });
      }
      return;
    }

    // Clamp elastic overscroll and tolerate fractional scroll positions at either end.
    const position = Math.max(0, Math.min(maxScroll, links.scrollTop));
    menuScrollHint.dataset.direction = position <= 2 ? "down" :
      maxScroll - position <= 2 ? "up" : "both";
    menuScrollUp.hidden = menuScrollHint.dataset.direction === "down";
    menuScrollDown.hidden = menuScrollHint.dataset.direction === "up";
    // Keep keyboard focus usable when a jump hides the arrow just activated.
    if (focused === menuScrollUp && menuScrollUp.hidden) menuScrollDown.focus({ preventScroll: true });
    else if (focused === menuScrollDown && menuScrollDown.hidden) menuScrollUp.focus({ preventScroll: true });
    menuScrollHint.style.setProperty("--crumbs-menu-height", `${links.clientHeight}px`);
    // Leave native scrollbars unobstructed, including browsers with wide scrollbars.
    const rightInset = links.offsetWidth - links.clientWidth - links.clientLeft;
    menuScrollHint.style.setProperty("--crumbs-menu-right-inset", `${rightInset}px`);
  }

  function placeHero() {
    const hadFocus = document.activeElement === hero;
    if (phone.matches) {
      header.after(hero);
    } else if (trigger.previousElementSibling !== hero) {
      trigger.before(hero);
    }
    content?.classList.toggle("crumbs-menu-first", phone.matches);
    if (hadFocus) hero.focus({ preventScroll: true });
  }

  placeHero();
  header.classList.add("js-enhanced");

  // Keep the menu usable while the new image is awaiting upload.
  if (phoneBrand && phoneBrandImage) {
    const updatePhoneBrand = () => {
      phoneBrand.hidden = phoneBrandImage.naturalWidth === 0;
      scheduleUpdate();
    };
    phoneBrandImage.addEventListener("load", updatePhoneBrand);
    phoneBrandImage.addEventListener("error", updatePhoneBrand);
    if (phoneBrandImage.complete) updatePhoneBrand();
  }

  function closeMenu(returnFocus = false) {
    const wasOpen = header.classList.contains("is-menu-open");
    header.classList.remove("is-menu-open");
    toggle.setAttribute("aria-expanded", "false");
    menuScrollHint.hidden = true;
    if (returnFocus) toggle.focus();
    if (wasOpen) scheduleUpdate();
  }

  function updateBatchControls() {
    if (!latest || !disclaimer) return;
    const viewport = window.visualViewport;
    const viewportBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    const readingTop = Math.max(0, header.getBoundingClientRect().bottom);
    const batchFillsView = latest.getBoundingClientRect().top <= readingTop &&
      disclaimer.getBoundingClientRect().top >= viewportBottom;
    const hidden = !(
      header.classList.contains("is-stuck") &&
      !header.classList.contains("is-menu-open") &&
      viewportBottom - readingTop >= 160 &&
      batchFillsView
    );
    for (const control of batchControls) control.hidden = hidden;
  }

  function updateCurrentSection() {
    let current = null;
    if (!phone.matches) {
      // Match the gap used by section jumps, including fractional rounding.
      const readingLine = header.getBoundingClientRect().bottom + sectionGap + 1;
      if (appendixIsLinked || !appendix || appendix.getBoundingClientRect().top > readingLine) {
        current = sections[0]?.link || null;
        let closestTop = -Infinity;
        for (const section of sections) {
          const top = section.target.getBoundingClientRect().top;
          if (top <= readingLine && top > closestTop) {
            current = section.link;
            closestTop = top;
          }
        }
      }
    }

    if (current === currentSectionLink) return;
    for (const section of sections) {
      if (section.link === current) section.link.setAttribute("aria-current", "location");
      else section.link.removeAttribute("aria-current");
    }
    currentSectionLink = current;
  }

  function updateHeader() {
    updatePending = false;
    const brandHeight = phone.matches ? 0 : header.clientWidth * 188 / 2048;
    header.style.setProperty("--crumbs-brand-height", `${brandHeight}px`);
    // The phone menu starts at the top; the desktop menu starts below the banner.
    const isStuck = phone.matches
      ? window.scrollY > 0
      : trigger.getBoundingClientRect().top <= brandHeight;
    header.classList.toggle("is-stuck", isStuck);

    // Anticipate the compact desktop logo even when a link is used at the top.
    scrollOffset = Math.ceil(header.getBoundingClientRect().height + brandHeight) + sectionGap;
    document.documentElement.style.setProperty("--crumbs-scroll-offset", `${scrollOffset}px`);
    updateMenuScrollHint();
    updateBatchControls();
    updateCurrentSection();
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

  function followSectionLink(event) {
    const link = event.target.closest("a[href^='#']");
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const hash = link.getAttribute("href");
    if (!navigate(hash, true, true)) return;
    event.preventDefault();
    if (window.location.hash !== hash) window.history.pushState(window.history.state, "", hash);
  }

  toggle.addEventListener("click", () => {
    if (!phone.matches) return;
    const open = !header.classList.contains("is-menu-open");
    header.classList.toggle("is-menu-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    scheduleUpdate();
  });

  header.addEventListener("click", followSectionLink);
  for (const control of batchControls) control.addEventListener("click", followSectionLink);

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
    placeHero();
    // Keep focus usable when resizing hides a phone or desktop control.
    const focused = document.activeElement;
    if (phone.matches && (links.contains(focused) || focused?.closest(".crumbs-compact-brand"))) toggle.focus();
    if (!phone.matches && (focused === toggle || phoneBrand?.contains(focused) || menuScrollHint.contains(focused))) links.querySelector("a")?.focus();
    closeMenu();
    updateHeader();
  });

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  links.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate, { passive: true });
  window.addEventListener("hashchange", () => navigate(window.location.hash, false, false));
  window.addEventListener("pageshow", scheduleUpdate);
  window.visualViewport?.addEventListener("resize", scheduleUpdate, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleUpdate, { passive: true });

  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(header);
    observer.observe(hero);
    observer.observe(links);
    if (content) observer.observe(content);
  }

  document.fonts?.ready.then(scheduleUpdate);

  function alignInitialLink() {
    updateHeader();
    if (window.location.hash) navigate(window.location.hash, false, false);
  }

  updateHeader();
  if (document.readyState === "complete") alignInitialLink();
  else window.addEventListener("load", alignInitialLink, { once: true });
})();
