'use strict';

(() => {
  const canvas = document.getElementById('garden');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  let metrics = null;
  let receivedAt = 0;
  let baseline = null;
  const pulseHistory = [];

  const flowers = Array.from({ length: 13 }, (_, i) => ({
    x: 55 + i * 83 + Math.sin(i * 7.3) * 22,
    y: H - 32 + Math.cos(i * 2.1) * 9,
    height: 155 + (Math.sin(i * 4.8) * 0.5 + 0.5) * 230,
    petals: 5 + (i % 4),
    size: 19 + (i % 5) * 4,
    phase: i * 1.71,
    hueOffset: (i % 4) * 14,
  }));
  const stars = Array.from({ length: 85 }, (_, i) => ({
    x: (i * 137.53) % W,
    y: 35 + (i * 71.31) % (H - 160),
    r: 0.35 + (i % 4) * 0.25,
  }));

  function setMetrics(next) {
    metrics = next;
    receivedAt = performance.now();
    if (next?.pulse?.value && next.pulse.confidence >= 30) {
      pulseHistory.push(next.pulse.value);
      if (pulseHistory.length > 12) pulseHistory.shift();
      if (pulseHistory.length >= 4) {
        const sorted = [...pulseHistory].sort((a, b) => a - b);
        baseline = sorted[Math.floor(sorted.length / 2)];
      }
    }
  }

  function reset() {
    metrics = null;
    receivedAt = 0;
    baseline = null;
    pulseHistory.length = 0;
  }

  function parameters() {
    const pulse = metrics?.pulse?.value ?? null;
    const arterial = metrics?.arterial?.value ?? 0;
    const breath = metrics?.breathingTrace?.value ?? 0;
    const reference = baseline ?? pulse ?? 70;
    const delta = pulse == null ? 0 : Math.max(-25, Math.min(25, pulse - reference));
    return {
      energy: Math.max(0.15, Math.min(1.5, 0.45 + Math.abs(arterial) * 2.4 + Math.abs(breath) * 0.4)),
      hue: Math.max(195, Math.min(345, 285 + delta * 3.2)),
      sway: Math.max(-0.45, Math.min(0.45, arterial * 1.6)),
      bloom: Math.max(0.65, Math.min(1.4, 0.95 + delta / 50)),
    };
  }

  function petal(x, y, radius, angle, hue, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const gradient = ctx.createRadialGradient(0, -radius * 0.35, 1, 0, 0, radius);
    gradient.addColorStop(0, `hsla(${hue + 25},85%,88%,${alpha})`);
    gradient.addColorStop(0.45, `hsla(${hue},72%,65%,${alpha * 0.9})`);
    gradient.addColorStop(1, `hsla(${hue - 18},68%,38%,0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(0, -radius * 0.52, radius * 0.38, radius * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawFlower(f, p, index) {
    const sway = p.sway * 50 + Math.sin(f.phase) * 8;
    const topX = f.x + sway;
    const topY = f.y - f.height;
    ctx.strokeStyle = `hsla(${135 + index * 2},36%,42%,.8)`;
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.bezierCurveTo(f.x - sway * 0.2, f.y - f.height * 0.35, topX - sway * 0.35, topY + 65, topX, topY);
    ctx.stroke();

    for (const side of [-1, 1]) {
      const ly = f.y - f.height * (side === -1 ? 0.38 : 0.58);
      const lx = f.x + sway * (f.y - ly) / f.height;
      ctx.fillStyle = `hsla(${142 + index},35%,34%,.7)`;
      ctx.beginPath();
      ctx.ellipse(lx + side * 14, ly, 19, 6, side * -0.48, 0, Math.PI * 2);
      ctx.fill();
    }

    const radius = f.size * p.bloom * (0.82 + p.energy * 0.26);
    const hue = p.hue + f.hueOffset;
    const glow = ctx.createRadialGradient(topX, topY, 0, topX, topY, radius * 3.5);
    glow.addColorStop(0, `hsla(${hue},80%,65%,${0.12 + p.energy * 0.08})`);
    glow.addColorStop(1, `hsla(${hue},80%,50%,0)`);
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(topX, topY, radius * 3.5, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < f.petals; k++) {
      petal(topX, topY, radius, k * Math.PI * 2 / f.petals + f.phase * 0.08, hue, 0.82);
    }
    ctx.fillStyle = `hsla(${hue + 45},85%,82%,.95)`;
    ctx.beginPath(); ctx.arc(topX, topY, radius * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `hsla(${hue + 20},90%,95%,.8)`;
    ctx.beginPath(); ctx.arc(topX - 2, topY - 2, radius * 0.07, 0, Math.PI * 2); ctx.fill();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#101c16'); bg.addColorStop(0.65, '#0a110d'); bg.addColorStop(1, '#101a13');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    for (const s of stars) {
      ctx.fillStyle = 'rgba(172,211,184,.22)';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    const ground = ctx.createLinearGradient(0, H - 110, 0, H);
    ground.addColorStop(0, 'rgba(35,68,44,0)'); ground.addColorStop(1, 'rgba(40,80,48,.45)');
    ctx.fillStyle = ground; ctx.fillRect(0, H - 110, W, 110);

    if (metrics && (metrics.pulse || metrics.arterial || metrics.breathingTrace)) {
      const p = parameters();
      // A stale packet never drives a fake animation: freeze on its last real values.
      const stale = performance.now() - receivedAt > 2000;
      const adjusted = stale ? { ...p, energy: 0.35, sway: 0 } : p;
      flowers.forEach((f, i) => drawFlower(f, adjusted, i));
    }
    requestAnimationFrame(draw);
  }

  window.AuraGarden = { setMetrics, reset };
  draw();
})();
