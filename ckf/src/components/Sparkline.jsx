// Tiny inline SVG sparkline. Pure render, no deps.
//
// Props:
//   points       — Array<{ x: number, y: number }>  (x usually a timestamp ms; y the value)
//   width, height
//   color        — line + area gradient base
//   showAxis     — show min/max on the right edge
//   direction    — 'higher_better' (green up) | 'lower_better' (green down) for tint
export default function Sparkline({
  points,
  width = 320,
  height = 80,
  color = '#7ec8a4',
  showAxis = true,
  direction = 'higher_better',
}) {
  if (!points || points.length < 2) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        Not enough history yet — log a few values to see the trend.
      </div>
    );
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padX = 6;
  const padTop = 6;
  const padBottom = 6;
  const padRight = showAxis ? 36 : 6;
  const w = width - padX - padRight;
  const h = height - padTop - padBottom;
  const xScale = (x) => padX + (maxX === minX ? w / 2 : ((x - minX) / (maxX - minX)) * w);
  const yScale = (y) => padTop + (maxY === minY ? h / 2 : (1 - (y - minY) / (maxY - minY)) * h);

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`)
    .join(' ');
  const area = `${path} L ${xScale(maxX).toFixed(1)} ${padTop + h} L ${xScale(minX).toFixed(1)} ${padTop + h} Z`;

  // Last value
  const last = points[points.length - 1];
  const first = points[0];
  // Trend tint — show direction-aware
  const trend = last.y - first.y;
  const goingRight = direction === 'higher_better' ? trend >= 0 : trend <= 0;
  const trendColor = trend === 0 ? 'var(--text-muted)' : (goingRight ? 'var(--good)' : 'var(--bad)');

  const areaId = `spark-grad-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${areaId})`} />
      <path d={path} stroke={color} strokeWidth="1.6" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {/* Last value dot */}
      <circle cx={xScale(last.x)} cy={yScale(last.y)} r="2.6" fill={trendColor} />
      {showAxis && (
        <>
          <text x={width - padRight + 4} y={padTop + 8} fontSize="9" fill="var(--text-muted)">
            {fmt(maxY)}
          </text>
          <text x={width - padRight + 4} y={height - padBottom + 2} fontSize="9" fill="var(--text-muted)">
            {fmt(minY)}
          </text>
        </>
      )}
    </svg>
  );
}

function fmt(n) {
  if (n == null) return '';
  const a = Math.abs(n);
  if (a >= 1000) return (Math.round(n / 100) / 10).toString() + 'k';
  if (a >= 100) return Math.round(n).toString();
  if (a >= 10) return (Math.round(n * 10) / 10).toString();
  return (Math.round(n * 100) / 100).toString();
}
