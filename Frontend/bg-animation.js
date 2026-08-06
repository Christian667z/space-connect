/* ==========================================================================
   Space Connect | Background Animation — Canvas Constellation + Nebula Glows
   Vanilla JS, zero dependencies. Runs on a fixed canvas behind all content.
   Developed by Asta aka Space aka Kimberly
   ========================================================================== */

(function () {
  'use strict';

  /* ── Configuration ──────────────────────────────────────────────────────── */
  const CFG = {
    // Particle counts (reduced on mobile for perf)
    particleCountDesktop: 90,
    particleCountMobile:  45,

    // Particle speed (units/frame)
    speedMin: 0.08,
    speedMax: 0.30,

    // Particle size range (radius, px)
    sizeMin: 0.8,
    sizeMax: 2.4,

    // Connection distance threshold (px)
    linkDistance: 140,

    // Colours: white dots + red dots (ratio ~70% white / 30% red)
    colors: [
      'rgba(255,255,255,',   // white
      'rgba(255,255,255,',   // white
      'rgba(255,255,255,',   // white
      'rgba(255,255,255,',   // white
      'rgba(255,255,255,',   // white (×2 weight)
      'rgba(229,9,20,',      // red
      'rgba(255,30,39,',     // bright red
    ],

    // Max opacity for particles
    alphaMin: 0.25,
    alphaMax: 0.85,

    // Line max opacity (kept very low for subtlety)
    linkAlphaMax: 0.18,

    // FPS cap (use requestAnimationFrame, but limit heavy redraws)
    // Set to 0 to disable cap (full rAF speed)
    fpsCap: 50,
  };

  /* ── State ──────────────────────────────────────────────────────────────── */
  const canvas = document.getElementById('sc-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  let particles = [];
  let animId = null;
  let lastFrameTime = 0;
  const frameInterval = CFG.fpsCap > 0 ? 1000 / CFG.fpsCap : 0;

  /* ── Utilities ───────────────────────────────────────────────────────────── */
  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function isMobile() {
    return window.innerWidth < 768;
  }

  /* ── Particle factory ────────────────────────────────────────────────────── */
  function createParticle() {
    const colorBase = CFG.colors[Math.floor(Math.random() * CFG.colors.length)];
    const alpha     = rand(CFG.alphaMin, CFG.alphaMax);
    return {
      x:      rand(0, W),
      y:      rand(0, H),
      vx:     rand(CFG.speedMin, CFG.speedMax) * (Math.random() < 0.5 ? 1 : -1),
      vy:     rand(CFG.speedMin, CFG.speedMax) * (Math.random() < 0.5 ? 1 : -1),
      r:      rand(CFG.sizeMin, CFG.sizeMax),
      color:  colorBase,
      alpha,
      // Twinkle: each particle has its own phase & speed
      twinklePhase: rand(0, Math.PI * 2),
      twinkleSpeed: rand(0.008, 0.022),
    };
  }

  /* ── Init / resize ───────────────────────────────────────────────────────── */
  function init() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;

    const count = isMobile() ? CFG.particleCountMobile : CFG.particleCountDesktop;

    // Keep existing particles that are still on screen; refill to target count
    particles = particles.filter(p => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H);
    while (particles.length < count) {
      particles.push(createParticle());
    }
    // Trim if oversized after a shrink
    if (particles.length > count) {
      particles = particles.slice(0, count);
    }
  }

  /* ── Draw one frame ──────────────────────────────────────────────────────── */
  function draw() {
    ctx.clearRect(0, 0, W, H);

    const len = particles.length;

    // ── Update & draw particles
    for (let i = 0; i < len; i++) {
      const p = particles[i];

      // Move
      p.x += p.vx;
      p.y += p.vy;

      // Wrap around edges (seamless)
      if (p.x < -5)  p.x = W + 5;
      if (p.x > W + 5) p.x = -5;
      if (p.y < -5)  p.y = H + 5;
      if (p.y > H + 5) p.y = -5;

      // Twinkle: oscillate alpha
      p.twinklePhase += p.twinkleSpeed;
      const tAlpha = p.alpha * (0.55 + 0.45 * Math.sin(p.twinklePhase));

      // Draw glow halo (larger, very translucent)
      const glowR = p.r * 3.5;
      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
      grd.addColorStop(0, p.color + (tAlpha * 0.35).toFixed(3) + ')');
      grd.addColorStop(1, p.color + '0)');
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      // Draw solid core dot
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color + tAlpha.toFixed(3) + ')';
      ctx.fill();
    }

    // ── Draw constellation lines between nearby particles
    for (let i = 0; i < len; i++) {
      const a = particles[i];
      for (let j = i + 1; j < len; j++) {
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CFG.linkDistance) {
          // Fade line linearly with distance
          const ratio = 1 - dist / CFG.linkDistance;
          const lineAlpha = ratio * ratio * CFG.linkAlphaMax;

          // Blend colour toward red when either endpoint is red
          const aIsRed = a.color.includes('229') || a.color.includes('255,30');
          const bIsRed = b.color.includes('229') || b.color.includes('255,30');
          let lineColor;
          if (aIsRed || bIsRed) {
            lineColor = `rgba(229,9,20,${lineAlpha.toFixed(3)})`;
          } else {
            lineColor = `rgba(200,180,185,${lineAlpha.toFixed(3)})`;
          }

          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = lineColor;
          ctx.lineWidth   = 0.6;
          ctx.stroke();
        }
      }
    }
  }

  /* ── Animation loop ──────────────────────────────────────────────────────── */
  function loop(timestamp) {
    animId = requestAnimationFrame(loop);

    if (frameInterval > 0) {
      const elapsed = timestamp - lastFrameTime;
      if (elapsed < frameInterval) return;
      lastFrameTime = timestamp - (elapsed % frameInterval);
    }

    draw();
  }

  /* ── Resize handler (debounced) ───────────────────────────────────────────── */
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      cancelAnimationFrame(animId);
      init();
      lastFrameTime = 0;
      animId = requestAnimationFrame(loop);
    }, 200);
  });

  /* ── Pause when tab is hidden (save CPU/battery) ─────────────────────────── */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(animId);
      animId = null;
    } else if (!animId) {
      // Guard: only restart if no loop is already scheduled
      lastFrameTime = 0;
      animId = requestAnimationFrame(loop);
    }
  });

  /* ── Boot ────────────────────────────────────────────────────────────────── */
  init();
  animId = requestAnimationFrame(loop);

})();
