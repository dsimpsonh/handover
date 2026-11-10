/* HANDOVER — hero walkthrough. A small timeline: one scene at a time, captions as real text, pause/replay,
   plays only while visible, respects prefers-reduced-motion (no autoplay; the dots step through scenes). */
"use strict";
(() => {
  const root = document.getElementById("demo");
  if (!root) return;
  const scenes = [...root.querySelectorAll(".sc")];
  const cap = root.querySelector(".demo-cap p");
  const stage = root.querySelector(".demo-stage");
  const bar = root.querySelector(".demo-bar span");
  const dotsBox = root.querySelector(".demo-dots");
  const playBtn = root.querySelector(".demo-play");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const dots = scenes.map((sc, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", `Step ${i + 1} of ${scenes.length}: ${sc.dataset.title}`);
    b.innerHTML = "<i></i>";
    b.addEventListener("click", () => { root.classList.remove("paused"); if (!reduced && !playing) { playing = true; playBtn.textContent = "❚❚"; playBtn.setAttribute("aria-label", "Pause walkthrough"); } go(i); });
    dotsBox.appendChild(b);
    return b;
  });

  let cur = -1, timer = null, playing = false, visible = true, started = 0, remaining = 0;

  function show(i) {
    scenes.forEach((sc, k) => {
      const on = k === i;
      const leaving = sc.classList.contains("on") && !on;   // keep its finished state while it fades out
      sc.classList.toggle("out", leaving);
      if (on) { sc.classList.remove("on", "out"); void sc.offsetWidth; }  // restart the scene's CSS animations
      sc.classList.toggle("on", on);
      sc.setAttribute("aria-hidden", on ? "false" : "true");
    });
    dots.forEach((d, k) => {
      d.classList.toggle("done", k < i);
      const fill = d.firstChild;
      fill.style.transition = "none"; fill.style.width = k < i ? "100%" : "0";
      d.setAttribute("aria-current", k === i ? "step" : "false");
    });
    stage.dataset.theme = scenes[i].dataset.theme || "tool";
    cap.innerHTML = scenes[i].dataset.caption;
    bar.textContent = scenes[i].dataset.title;
    cur = i;
  }

  function arm(ms) {
    clearTimeout(timer);
    remaining = ms; started = performance.now();
    const fill = dots[cur].firstChild;
    requestAnimationFrame(() => { fill.style.transition = `width ${ms}ms linear`; fill.style.width = "100%"; });
    timer = setTimeout(() => go((cur + 1) % scenes.length, true), ms);
  }

  function go(i, auto) {
    show(i);
    if (playing || auto) arm(+scenes[i].dataset.ms || 6500);
  }

  function play() {
    if (playing) return;
    playing = true; playBtn.textContent = "❚❚"; playBtn.setAttribute("aria-label", "Pause walkthrough");
    if (cur < 0) go(0); else arm(remaining || +scenes[cur].dataset.ms);
  }

  function pause(byUser) {
    if (byUser) root.classList.add("paused");
    if (!playing) return;
    playing = false; clearTimeout(timer);
    remaining = Math.max(400, remaining - (performance.now() - started));
    const fill = dots[cur].firstChild;
    const w = getComputedStyle(fill).width; fill.style.transition = "none"; fill.style.width = w;
    playBtn.textContent = "▶"; playBtn.setAttribute("aria-label", "Play walkthrough");
  }

  playBtn.addEventListener("click", () => {
    if (playing) pause(true); else { root.classList.remove("paused"); play(); }
  });

  if (reduced) {
    // No motion: show the first scene; visitors step through with the dots.
    show(0);
    playBtn.hidden = true;
    return;
  }

  // Only run while on screen; pause politely when scrolled away or the tab is hidden.
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !root.classList.contains("paused")) play(); else if (!visible) pause();
  }, { threshold: 0.35 });
  io.observe(root);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(false); else if (visible && !root.classList.contains("paused")) play(); });
  show(0);
})();
