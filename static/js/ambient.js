(function () {
  "use strict";

  const canvas = document.querySelector(".ambient-field");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
  const colors = {
    amber: "244, 162, 97",
    copper: "224, 122, 95",
  };
  let width = 0;
  let height = 0;
  let dpr = 1;
  let animationFrame = 0;
  let lastFrame = 0;

  function fit() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(performance.now());
  }

  function project(x, depth, time) {
    const perspective = 1 / (1 + depth * 0.42);
    const spread = width * 0.83;
    const centerX = width * (0.5 + pointer.x * 0.025);
    const horizon = height * (0.49 + pointer.y * 0.018);
    const wave =
      Math.sin(x * 8.5 - time * 0.00055 + depth * 2.4) * 0.09 +
      Math.sin(x * 17 + time * 0.00035 - depth * 3) * 0.025;
    const pulse = Math.exp(-Math.pow((x + 0.18 - Math.sin(time * 0.00022) * 0.32) * 2.2, 2));
    const yDisplacement = (wave + pulse * Math.sin(depth * 15 - time * 0.0012) * 0.14) * height;

    return {
      x: centerX + x * spread * perspective,
      y: horizon + depth * height * 0.39 + yDisplacement * perspective,
      perspective,
    };
  }

  function draw(time) {
    ctx.clearRect(0, 0, width, height);
    pointer.x += (pointer.targetX - pointer.x) * 0.035;
    pointer.y += (pointer.targetY - pointer.y) * 0.035;

    const columns = width < 700 ? 52 : 88;
    const rows = width < 700 ? 13 : 19;
    const span = width < 700 ? 1.28 : 1.7;

    for (let row = 0; row < rows; row++) {
      const depth = row / (rows - 1);
      const alpha = (0.1 + depth * 0.22) * (1 - depth * 0.48);
      ctx.beginPath();
      for (let column = 0; column <= columns; column++) {
        const x = (column / columns) * 2 - 1;
        const point = project(x * span, depth, time);
        if (column === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }
      ctx.strokeStyle = "rgba(" + colors.amber + ", " + alpha + ")";
      ctx.lineWidth = 0.65 + depth * 0.35;
      ctx.stroke();
    }

    for (let column = 0; column <= columns; column += 2) {
      const x = ((column / columns) * 2 - 1) * span;
      ctx.beginPath();
      for (let row = 0; row < rows; row++) {
        const depth = row / (rows - 1);
        const point = project(x, depth, time);
        if (row === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }
      ctx.strokeStyle = "rgba(" + colors.copper + ", 0.075)";
      ctx.lineWidth = 0.55;
      ctx.stroke();
    }

  }

  function animate(time) {
    if (time - lastFrame < 30) {
      animationFrame = requestAnimationFrame(animate);
      return;
    }
    lastFrame = time;
    draw(time);
    animationFrame = requestAnimationFrame(animate);
  }

  window.addEventListener("resize", fit, { passive: true });
  window.addEventListener("pointermove", (event) => {
    pointer.targetX = (event.clientX / Math.max(width, 1) - 0.5) * 2;
    pointer.targetY = (event.clientY / Math.max(height, 1) - 0.5) * 2;
  }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    cancelAnimationFrame(animationFrame);
    if (!document.hidden && !reduceMotion) animationFrame = requestAnimationFrame(animate);
  });

  fit();
  if (!reduceMotion) animationFrame = requestAnimationFrame(animate);
})();
