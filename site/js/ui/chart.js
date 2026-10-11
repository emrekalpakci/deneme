// Küçük çizgi grafik (sparkline). Sadece gerçek veri noktaları çizilir.

import { svg } from './dom.js';

export function sparkline(values, { label = 'Son 30 günün grafiği' } = {}) {
  const pts = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (pts.length < 2) return null;
  const W = 300;
  const H = 44;
  const pad = 3;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const x = (i) => pad + (i * (W - 2 * pad)) / (pts.length - 1);
  const y = (v) => H - pad - ((v - min) * (H - 2 * pad)) / span;
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const up = pts[pts.length - 1] >= pts[0];
  return svg(
    'svg',
    { class: 'spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': label },
    svg('path', { d, class: up ? 'line-up' : 'line-down', 'vector-effect': 'non-scaling-stroke' }),
  );
}
