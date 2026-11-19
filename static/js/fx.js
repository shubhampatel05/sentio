/**
 * fx.js — progressive-enhancement polish. Nothing here is required for the app:
 * if this file fails or motion is reduced, every element is simply visible.
 *   1. Cursor sheen on glass panels (a soft highlight that follows the pointer)
 *   2. Staggered scroll reveals for elements marked [data-reveal]
 */
(function () {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion) return;

  /* 1. cursor sheen — fine pointers only (no touch), one passive listener per panel */
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    document.querySelectorAll(".glass").forEach((el) => {
      const spot = document.createElement("span");
      spot.className = "spot";
      spot.setAttribute("aria-hidden", "true");
      el.appendChild(spot);
      el.addEventListener(
        "pointermove",
        (e) => {
          const r = el.getBoundingClientRect();
          el.style.setProperty("--mx", e.clientX - r.left + "px");
          el.style.setProperty("--my", e.clientY - r.top + "px");
        },
        { passive: true }
      );
    });
  }

  /* 2. scroll reveals — the .js-reveal class is only added once the observer exists,
        so a failure can never leave content hidden */
  if (!("IntersectionObserver" in window)) return;
  const targets = Array.prototype.slice.call(document.querySelectorAll("[data-reveal]"));
  if (!targets.length) return;

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target); // reveal once, then stop watching
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
  );

  // stagger siblings that share a parent (e.g. the four signal-chain tiles)
  const seen = new Map();
  targets.forEach((el) => {
    const n = seen.get(el.parentNode) || 0;
    seen.set(el.parentNode, n + 1);
    el.style.transitionDelay = n * 90 + "ms";
  });

  document.documentElement.classList.add("js-reveal");
  targets.forEach((el) => io.observe(el));
})();
