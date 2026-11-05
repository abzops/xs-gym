// Small SVG charts for Analytics. Thin marks, one axis, recessive grid,
// hover/touch tooltips, and every chart has a table view (see ChartCard).
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';

export type Series = { key: string; label: string; color: string; values: number[] };

/** Watches an element's width so charts redraw crisply at every size. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Up to ~4 round tick values covering [min, max]. */
function niceTicks(min: number, max: number, count = 4) {
  if (max === min) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** Rounded data-end, square at the baseline. Works for negative bars too. */
function barPath(x: number, w: number, y0: number, y1: number, r = 4) {
  const up = y1 < y0;
  const h = Math.abs(y0 - y1);
  const rr = Math.min(r, w / 2, h);
  if (h < 0.5) return '';
  if (up) return `M${x},${y0}V${y1 + rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 + rr}V${y0}Z`;
  return `M${x},${y0}V${y1 - rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 - rr}V${y0}Z`;
}

type TipProps = { x: number; width: number; title: string; rows: { label: string; color: string; value: string }[] };
function Tooltip({ x, width, title, rows }: TipProps) {
  const left = Math.max(4, Math.min(x - 80, width - 164));
  return (
    <div className="viz-tip" style={{ left }} role="status">
      <b>{title}</b>
      {rows.map((r) => (
        <span key={r.label}><i style={{ background: r.color }} />{r.label}<em className="num">{r.value}</em></span>
      ))}
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="viz-legend">
      {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
    </div>
  );
}

const PAD = { top: 12, right: 8, bottom: 26, left: 52 };

function usePointer(n: number, plotLeft: number, plotW: number) {
  const [active, setActive] = useState<number | null>(null);
  // Tapping anywhere else closes a touch tooltip.
  useEffect(() => {
    if (active === null) return;
    const close = (e: Event) => { if (!(e.target as Element).closest?.('.viz-plot')) setActive(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [active]);
  const pick = (e: PointerEvent<SVGElement>) => {
    const box = (e.currentTarget.ownerSVGElement ?? (e.currentTarget as SVGSVGElement)).getBoundingClientRect();
    const i = Math.floor(((e.clientX - box.left - plotLeft) / plotW) * n);
    setActive(i >= 0 && i < n ? i : null);
  };
  // A finger lifting also fires pointerleave; keep the tooltip until the next tap.
  const leave = (e: PointerEvent<SVGElement>) => { if (e.pointerType !== 'touch') setActive(null); };
  return { active, handlers: { onPointerMove: pick, onPointerDown: pick, onPointerLeave: leave } };
}

/** Grouped columns over categories (months). */
export function ColumnChart({ categories, series, format, tick, height = 220, label }: {
  categories: string[]; series: Series[]; format: (n: number) => string; tick: (n: number) => string; height?: number; label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = categories.length;
  const all = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const slot = n ? plotW / n : 0;
  const gap = 2;
  const barW = Math.max(3, Math.min(24, (slot * 0.7 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const { active, handlers } = usePointer(n, PAD.left, plotW);
  const every = Math.ceil(n / Math.max(1, Math.floor(plotW / 44)));
  return (
    <div className="viz" ref={ref}>
      <Legend series={series} />
      {width > 0 && (
        <div className="viz-plot">
          <svg width={width} height={height} role="img" aria-label={label} style={{ touchAction: 'pan-y' }}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-base' : 'viz-grid'} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="viz-axis">{tick(t)}</text>
              </g>
            ))}
            {active !== null && <rect x={PAD.left + active * slot} y={PAD.top} width={slot} height={plotH} className="viz-band" />}
            {categories.map((c, i) => {
              const x0 = PAD.left + i * slot + (slot - groupW) / 2;
              return (
                <g key={c}>
                  {series.map((s, k) => (
                    <path key={s.key} d={barPath(x0 + k * (barW + gap), barW, y(0), y(s.values[i] ?? 0))} fill={s.color}
                      opacity={active === null || active === i ? 1 : 0.45} />
                  ))}
                  {i % every === 0 && <text x={PAD.left + i * slot + slot / 2} y={height - 8} textAnchor="middle" className="viz-axis">{c}</text>}
                </g>
              );
            })}
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent" {...handlers} />
          </svg>
          {active !== null && (
            <Tooltip x={PAD.left + active * slot + slot / 2} width={width} title={categories[active]}
              rows={series.map((s) => ({ label: s.label, color: s.color, value: format(s.values[active] ?? 0) }))} />
          )}
        </div>
      )}
    </div>
  );
}

/** Lines over categories, with a crosshair. Handles negative values. */
export function LineChart({ categories, series, format, tick, height = 200, label }: {
  categories: string[]; series: Series[]; format: (n: number) => string; tick: (n: number) => string; height?: number; label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = categories.length;
  const all = series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all, 1));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const slot = n ? plotW / n : 0;
  const x = (i: number) => PAD.left + i * slot + slot / 2;
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const { active, handlers } = usePointer(n, PAD.left, plotW);
  const every = Math.ceil(n / Math.max(1, Math.floor(plotW / 44)));
  return (
    <div className="viz" ref={ref}>
      <Legend series={series} />
      {width > 0 && (
        <div className="viz-plot">
          <svg width={width} height={height} role="img" aria-label={label} style={{ touchAction: 'pan-y' }}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'viz-base' : 'viz-grid'} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="viz-axis">{tick(t)}</text>
              </g>
            ))}
            {categories.map((c, i) => i % every === 0 && (
              <text key={c} x={x(i)} y={height - 8} textAnchor="middle" className="viz-axis">{c}</text>
            ))}
            {active !== null && <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} className="viz-cross" />}
            {series.map((s) => (
              <g key={s.key}>
                <polyline fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                  points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
                {(active !== null ? [active] : [s.values.length - 1]).map((i) => (
                  <circle key={i} cx={x(i)} cy={y(s.values[i] ?? 0)} r={4.5} fill={s.color} className="viz-dot" />
                ))}
              </g>
            ))}
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent" {...handlers} />
          </svg>
          {active !== null && (
            <Tooltip x={x(active)} width={width} title={categories[active]}
              rows={series.map((s) => ({ label: s.label, color: s.color, value: format(s.values[active] ?? 0) }))} />
          )}
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars (HTML, so long labels wrap naturally). */
export function BarList({ rows, format, color = 'var(--viz-1)', empty = 'No data in this period.' }: {
  rows: { label: string; value: number; note?: string }[]; format: (n: number) => string; color?: string; empty?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="viz-bars">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${format(r.value)}`}>
          <span className="lbl">{r.label}{r.note && <small className="muted"> · {r.note}</small>}</span>
          <span className="val num">{format(r.value)}</span>
          <span className="track"><span style={{ width: `${(r.value / max) * 100}%`, background: color }} /></span>
        </li>
      ))}
    </ul>
  );
}

/** Parts of a whole as one thin segmented bar plus a legend with shares. */
export function ShareBar({ parts, format, label }: {
  parts: { label: string; value: number; color: string }[]; format: (n: number) => string; label: string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  if (!total) return <p className="muted">No data in this period.</p>;
  return (
    <div className="viz-share">
      <div className="bar" role="img" aria-label={`${label}: ${shown.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', ')}`}>
        {shown.map((p) => <span key={p.label} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${format(p.value)}`} />)}
      </div>
      <ul>
        {shown.map((p) => (
          <li key={p.label}><i style={{ background: p.color }} />{p.label}
            <span className="num">{format(p.value)}</span><span className="muted num">{Math.round((p.value / total) * 100)}%</span></li>
        ))}
      </ul>
    </div>
  );
}

/** A titled card with a chart and a Table toggle (the accessible view). */
export function ChartCard({ title, headline, children, table, wide }: {
  title: string; headline?: ReactNode; children: ReactNode; table?: { head: string[]; rows: (string | number)[][] }; wide?: boolean;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card viz-card${wide ? ' wide' : ''}`}>
      <div className="viz-head">
        <div><h2>{title}</h2>{headline && <p className="viz-headline">{headline}</p>}</div>
        {table && <button type="button" className="btn small ghost" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>{asTable ? 'Chart' : 'Table'}</button>}
      </div>
      {asTable && table ? (
        <div className="table-wrap">
          <table className="data">
            <thead><tr>{table.head.map((h, i) => <th key={h} className={i ? 'r' : undefined}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? 'r num' : undefined}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
    </section>
  );
}
