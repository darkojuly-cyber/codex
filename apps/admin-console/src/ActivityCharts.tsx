import { useState } from 'react';
export type ActivityDay = { day: string; joins: number | null; leaves: number | null; messages: number | null; speakers: number | null };
const series = [
  { key: 'joins', title: 'Daily joins', color: '#b8e784' },
  { key: 'leaves', title: 'Daily leaves', color: '#f2a795' },
  { key: 'messages', title: 'Daily messages', color: '#b49aff' },
  { key: 'speakers', title: 'Daily active speakers', color: '#8ccff2' },
] as const;
function Trend({ points, metric, t }: { points: ActivityDay[]; metric: typeof series[number]; t: (key: string) => string }) {
  const [cursor, setCursor] = useState<number | null>(null);
  const selected = Math.min(cursor ?? points.length - 1, points.length - 1);
  const ceiling = Math.max(2, Math.ceil(Math.max(0, ...points.map(point => point[metric.key] ?? 0)) * 1.15));
  const x = (index: number) => 42 + (points.length > 1 ? index / (points.length - 1) : .5) * 538;
  const y = (value: number) => 152 - value / ceiling * 128;
  let segment = false;
  const path = points.map((point, index) => {
    const value = point[metric.key];
    if (value === null) { segment = false; return ''; }
    const step = `${segment ? 'L' : 'M'}${x(index)},${y(value)}`; segment = true; return step;
  }).join(' ');
  const current = points[selected];
  const anyData = points.some(point => point[metric.key] !== null);
  return <article className="activity-chart"><div className="chart-heading"><h3>{t(metric.title)}</h3><span aria-live="polite" aria-atomic="true"><strong style={{ color: metric.color }}>{current?.[metric.key]?.toLocaleString() ?? '—'}</strong><small>{current?.day}</small></span></div>
    <svg viewBox="0 0 600 186" role="img" aria-label={t(metric.title)} tabIndex={0} onKeyDown={event => {
      if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) { event.preventDefault(); setCursor(event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, selected + (event.key === 'ArrowRight' ? 1 : -1)))); }
    }} onMouseMove={event => { const box = event.currentTarget.getBoundingClientRect(); const relative = (event.clientX - box.left) / box.width * 600; setCursor(Math.max(0, Math.min(points.length - 1, Math.round((relative - 42) / 538 * (points.length - 1))))); }}>
      {[0, Math.ceil(ceiling / 2), ceiling].map(value => <g key={value}><line x1={42} x2={580} y1={y(value)} y2={y(value)} stroke="#383240" strokeDasharray="3 5"/><text x={34} y={y(value) + 4} textAnchor="end">{value.toLocaleString()}</text></g>)}
      {points.map((point, index) => point[metric.key] === null ? <rect key={point.day} x={Math.max(42, x(index) - 538 / Math.max(1, points.length - 1) / 2)} y={20} width={Math.min(538, 538 / Math.max(1, points.length - 1))} height={132} fill="#8c829f" opacity=".06"/> : null)}
      {anyData && <path d={path} fill="none" stroke={metric.color} strokeWidth="2.5" strokeLinejoin="round"/>}
      {current && <line x1={x(selected)} x2={x(selected)} y1={20} y2={152} stroke="#8e83a2" strokeDasharray="3 4"/>}
      {points.map((point, index) => { const value = point[metric.key]; return value === null ? null : <circle key={point.day} cx={x(index)} cy={y(value)} r={index === selected ? 4 : 2.5} fill={metric.color}><title>{point.day}: {value}</title></circle>; })}
      {[...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])].filter(index => index >= 0).map(index => <text key={index} x={x(index)} y={177} textAnchor="middle">{points[index]?.day.slice(5)}</text>)}
    </svg>
    {!anyData && <p className="chart-empty">{t('No observed data in this window')}</p>}
  </article>;
}
export function ActivityCharts({ points, t }: { points: ActivityDay[]; t: (key: string) => string }) {
  return <><div className="activity-chart-grid">{series.map(metric => <Trend key={`${metric.key}-${points.length}`} points={points} metric={metric} t={t}/>)}</div><p className="muted">{t('Hover or focus a chart and use arrow keys to inspect each day. Gaps mean unobserved dates, not zero. Today and offline periods may be partial.')}</p></>;
}
