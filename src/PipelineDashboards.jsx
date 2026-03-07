import { useState, useEffect, useMemo } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n) {
  if (!n || isNaN(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

function getConf(deal) {
  if (deal.useAlgoConfidence) {
    let score = deal.hubspotStageProbability != null ? deal.hubspotStageProbability * 100 : 30;
    if (deal.meetingBooked) score += 15;
    const t = deal.touchCount || 0;
    if (t >= 6) score += 20; else if (t >= 3) score += 10; else if (t >= 1) score += 5;
    if (deal.lastActivityDate) {
      const days = Math.floor((Date.now() - new Date(deal.lastActivityDate)) / 86_400_000);
      if (days >= 60) score -= 20; else if (days >= 30) score -= 10;
    }
    return Math.max(0, Math.min(100, Math.round(score)));
  }
  return deal.manualConfidence ?? 50;
}

function adjValue(deal) {
  return (deal.value || 0) * (getConf(deal) / 100);
}

const PROD_COLOR = {
  uniqlearn: "#0ea5e9",
  uniqpath: "#a855f7",
  both: "#f59e0b",
  "": "#64748b",
};

const PROD_LABEL = {
  uniqlearn: "UniqLearn",
  uniqpath: "UniqPath",
  both: "Both",
  "": "Unassigned",
};

// ─── US State Map — TopoJSON loader ──────────────────────────────────────────
// Maps FIPS code strings to state abbreviations
const FIPS_TO_STATE = {
  "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT",
  "10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL",
  "18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD",
  "25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE",
  "32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND",
  "39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD",
  "47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV",
  "55":"WI","56":"WY",
};

// Parse a us-atlas states-albers-10m.json TopoJSON into SVG path strings
// and approximate state centroids. Returns { statePaths, stateCentroids, nationPath }.
function parseTopojson(topo) {
  const { transform: { scale: [sx, sy], translate: [tx, ty] }, arcs: rawArcs, objects } = topo;

  // Delta-decode one arc; negative index means reversed arc
  function decodeArc(idx) {
    const arc = rawArcs[idx < 0 ? ~idx : idx];
    let x = 0, y = 0;
    const pts = arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * sx + tx, y * sy + ty];
    });
    if (idx < 0) pts.reverse();
    return pts;
  }

  // rings: array of arc-index arrays  →  SVG path string (M…L…Z per ring)
  function ringsToPath(rings) {
    let d = "";
    for (const ring of rings) {
      const pts = ring.flatMap(i => decodeArc(i));
      if (!pts.length) continue;
      d += `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        d += `L${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)}`;
      }
      d += "Z";
    }
    return d;
  }

  // Centroid: use the ring with the most points (= largest polygon, e.g. lower MI not upper)
  function computeCentroid(rings) {
    let bestPts = [];
    for (const ring of rings) {
      const pts = ring.flatMap(i => decodeArc(i));
      if (pts.length > bestPts.length) bestPts = pts;
    }
    if (!bestPts.length) return [487, 305];
    const sumX = bestPts.reduce((s, [px]) => s + px, 0);
    const sumY = bestPts.reduce((s, [, py]) => s + py, 0);
    return [sumX / bestPts.length, sumY / bestPts.length];
  }

  const statePaths = {};
  const stateCentroids = {};

  for (const geom of objects.states.geometries) {
    const abbr = FIPS_TO_STATE[geom.id];
    if (!abbr) continue;
    const rings = geom.type === "MultiPolygon" ? geom.arcs.flat(1) : geom.arcs;
    statePaths[abbr] = ringsToPath(rings);
    stateCentroids[abbr] = computeCentroid(rings);
  }

  // Overall US boundary (nation object is a GeometryCollection)
  let nationPath = "";
  for (const geom of (objects.nation.geometries || [])) {
    const rings = geom.type === "MultiPolygon" ? geom.arcs.flat(1) : geom.arcs;
    nationPath += ringsToPath(rings);
  }

  return { statePaths, stateCentroids, nationPath };
}

// ─── Monthly Revenue Forecast Chart ──────────────────────────────────────────
function MonthlyForecastChart({ deals }) {
  const [hoveredIdx, setHoveredIdx] = useState(null);

  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Build list of months: current month + next 11, plus any deal months in range
  const months = useMemo(() => {
    const set = new Set();
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    deals.forEach(d => { if (d.expectedCloseMonth) set.add(d.expectedCloseMonth); });
    return Array.from(set).sort().filter(m => m >= thisMonthKey).slice(0, 12);
  }, [deals]);

  const monthData = useMemo(() => months.map(monthKey => {
    const mDeals = deals.filter(d => d.expectedCloseMonth === monthKey);
    const open = mDeals.filter(d => !d.closedWon);
    const won = mDeals.filter(d => d.closedWon);
    return {
      monthKey,
      pipeline: open.reduce((s, d) => s + (d.value || 0), 0),
      adjusted: open.reduce((s, d) => s + adjValue(d), 0),
      closedWon: won.reduce((s, d) => s + (d.value || 0), 0),
      count: mDeals.length,
    };
  }), [deals, months]);

  const W = 600, H = 240;
  const P = { l: 54, r: 16, t: 16, b: 50 };
  const PW = W - P.l - P.r;
  const PH = H - P.t - P.b;

  const maxVal = Math.max(
    ...monthData.map(m => m.pipeline + m.closedWon),
    1
  );

  const n = months.length;
  const spacing = PW / n;
  const barW = Math.max(8, Math.min(34, spacing * 0.58));

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => ({
    val: maxVal * r,
    y: PH - PH * r,
  }));

  return (
    <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "18px 16px 14px" }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>
          Revenue Forecast
        </h3>
        <p style={{ margin: "3px 0 0", fontSize: 11, color: "#64748b" }}>
          Monthly pipeline · confidence-adjusted · next 12 months · live
        </p>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
        <g transform={`translate(${P.l},${P.t})`}>
          {/* Y grid + labels */}
          {yTicks.map(({ val, y }) => (
            <g key={y}>
              <line x1={0} y1={y} x2={PW} y2={y} stroke="#1f2f47" strokeDasharray="4,3" />
              <text x={-6} y={y + 4} textAnchor="end" fontSize={9} fill="#475569">{fmt(val)}</text>
            </g>
          ))}

          {/* Bars */}
          {monthData.map((m, i) => {
            const cx = (i + 0.5) * spacing;
            const bw2 = barW / 2;
            const pipelineH = maxVal > 0 ? (m.pipeline / maxVal) * PH : 0;
            const adjH = maxVal > 0 ? (m.adjusted / maxVal) * PH : 0;
            const wonH = maxVal > 0 ? (m.closedWon / maxVal) * PH : 0;
            const isCurrent = m.monthKey === thisMonthKey;
            const isHov = hoveredIdx === i;
            const monthDate = new Date(m.monthKey + "-02");

            // Tooltip position
            const tipX = Math.min(Math.max(cx, 56), PW - 56);
            const topBarH = Math.max(pipelineH + wonH, adjH + wonH);
            const tipY = Math.max(4, PH - topBarH - 80);
            const tipLines = [
              { text: monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric" }), color: "#f1f5f9", fw: 600 },
              { text: `Adj forecast: ${fmt(m.adjusted)}`, color: "#a5f3fc", fw: 400 },
              { text: `Pipeline: ${fmt(m.pipeline)} · ${m.count} deal${m.count !== 1 ? "s" : ""}`, color: "#94a3b8", fw: 400 },
              ...(m.closedWon > 0 ? [{ text: `Closed won: ${fmt(m.closedWon)}`, color: "#4ade80", fw: 400 }] : []),
            ];

            return (
              <g
                key={m.monthKey}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{ cursor: "default" }}
              >
                {/* Current month highlight strip */}
                {isCurrent && (
                  <rect x={cx - spacing / 2} y={0} width={spacing} height={PH}
                    fill="rgba(99,102,241,0.05)" />
                )}

                {/* Pipeline bar (ghost) */}
                {pipelineH > 0 && (
                  <rect x={cx - bw2} y={PH - pipelineH} width={barW} height={pipelineH}
                    fill={isCurrent ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.06)"}
                    rx={3} />
                )}

                {/* Confidence-adjusted bar */}
                {adjH > 0 && (
                  <rect x={cx - bw2} y={PH - adjH} width={barW} height={adjH}
                    fill={isCurrent ? "#818cf8" : "#38bdf8"}
                    opacity={isHov ? 1 : 0.88} rx={3} />
                )}

                {/* Closed-won bar (stacked on top of adjusted) */}
                {wonH > 0 && (
                  <rect x={cx - bw2} y={PH - adjH - wonH} width={barW} height={wonH}
                    fill="#4ade80" rx={3} />
                )}

                {/* Current month vertical dashed line */}
                {isCurrent && (
                  <line x1={cx} y1={0} x2={cx} y2={PH}
                    stroke="#6366f1" strokeDasharray="3,3" strokeWidth={1} opacity={0.35} />
                )}

                {/* X-axis labels */}
                <text x={cx} y={PH + 16} textAnchor="middle" fontSize={9}
                  fill={isCurrent ? "#a5b4fc" : "#475569"}
                  fontWeight={isCurrent ? "600" : "400"}>
                  {monthDate.toLocaleDateString("en-US", { month: "short" })}
                </text>
                <text x={cx} y={PH + 28} textAnchor="middle" fontSize={8} fill="#2a3a55">
                  {monthDate.toLocaleDateString("en-US", { year: "2-digit" })}
                </text>

                {/* Hover tooltip */}
                {isHov && (
                  <g>
                    <rect x={tipX - 58} y={tipY} width={116} height={tipLines.length * 14 + 12}
                      rx={5} fill="#0a1628" stroke="#334155" strokeWidth={1} />
                    {tipLines.map((l, li) => (
                      <text key={li} x={tipX} y={tipY + 14 + li * 14}
                        textAnchor="middle" fontSize={9.5}
                        fill={l.color} fontWeight={l.fw}>
                        {l.text}
                      </text>
                    ))}
                  </g>
                )}
              </g>
            );
          })}

          {/* X axis line */}
          <line x1={0} y1={PH} x2={PW} y2={PH} stroke="#334155" />
        </g>
      </svg>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#475569", marginTop: 4, paddingLeft: P.l }}>
        {[
          { color: "#38bdf8", label: "Adj. Forecast" },
          { color: "rgba(255,255,255,0.12)", label: "Pipeline", border: "#334155" },
          { color: "#4ade80", label: "Closed Won" },
        ].map(({ color, label, border }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 9, height: 9, background: color, borderRadius: 2, border: border ? `1px solid ${border}` : "none" }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Product Pipeline Breakdown ───────────────────────────────────────────────
function ProductBreakdownChart({ deals }) {
  const [hovered, setHovered] = useState(null);

  const PRODUCTS = ["uniqlearn", "uniqpath", "both", ""];

  const groups = useMemo(() => {
    return PRODUCTS.map(p => {
      const pDeals = deals.filter(d => (d.product || "") === p && !d.closedWon);
      const wonDeals = deals.filter(d => (d.product || "") === p && d.closedWon);
      return {
        product: p,
        label: PROD_LABEL[p],
        color: PROD_COLOR[p],
        pipeline: pDeals.reduce((s, d) => s + (d.value || 0), 0),
        adjusted: pDeals.reduce((s, d) => s + adjValue(d), 0),
        closedWon: wonDeals.reduce((s, d) => s + (d.value || 0), 0),
        count: pDeals.length,
        wonCount: wonDeals.length,
      };
    });
  }, [deals]);

  const maxVal = Math.max(...groups.map(g => g.pipeline + g.closedWon), 1);

  const W = 480, H = 210;
  const P = { l: 80, r: 100, t: 14, b: 14 };
  const PW = W - P.l - P.r;
  const rowH = 40;

  return (
    <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "18px 16px 14px" }}>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>
          Pipeline by Product
        </h3>
        <p style={{ margin: "3px 0 0", fontSize: 11, color: "#64748b" }}>
          Open deals grouped by product line
        </p>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <g transform={`translate(${P.l},${P.t})`}>
          {groups.map((g, i) => {
            const y = i * rowH + 4;
            const bH = rowH - 14;
            const pipelineW = maxVal > 0 ? (g.pipeline / maxVal) * PW : 0;
            const adjW = maxVal > 0 ? (g.adjusted / maxVal) * PW : 0;
            const wonW = maxVal > 0 ? (g.closedWon / maxVal) * PW : 0;
            const isHov = hovered === g.product;

            return (
              <g key={g.product}
                onMouseEnter={() => setHovered(g.product)}
                onMouseLeave={() => setHovered(null)}
              >
                {/* Product label */}
                <text x={-8} y={y + bH / 2 + 4} textAnchor="end" fontSize={11}
                  fill={isHov ? "#f1f5f9" : "#94a3b8"} fontWeight={isHov ? "600" : "400"}>
                  {g.label}
                </text>

                {/* Pipeline ghost bar */}
                <rect x={0} y={y} width={Math.max(pipelineW, 2)} height={bH}
                  fill="rgba(255,255,255,0.05)" rx={3} />

                {/* Closed won bar */}
                {wonW > 0 && (
                  <rect x={0} y={y} width={wonW} height={bH}
                    fill="rgba(74,222,128,0.18)" rx={3} />
                )}

                {/* Adjusted bar */}
                {adjW > 0 && (
                  <rect x={0} y={y + 3} width={adjW} height={bH - 6}
                    fill={g.color} opacity={isHov ? 1 : 0.85} rx={3} />
                )}

                {/* Right-side value labels */}
                <text x={Math.max(pipelineW, 2) + 8} y={y + bH / 2 + 4}
                  fontSize={10} fill="#64748b">
                  {fmt(g.adjusted)}
                  {g.count > 0 && <tspan fill="#334155"> · {g.count}</tspan>}
                </text>

                {g.closedWon > 0 && (
                  <text x={Math.max(pipelineW, 2) + 8} y={y + bH / 2 + 15}
                    fontSize={9} fill="#4ade80">
                    +{fmt(g.closedWon)} won
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Totals row */}
      {(() => {
        const totalPipeline = groups.reduce((s, g) => s + g.pipeline, 0);
        const totalAdj = groups.reduce((s, g) => s + g.adjusted, 0);
        const totalWon = groups.reduce((s, g) => s + g.closedWon, 0);
        return (
          <div style={{ borderTop: "1px solid #334155", marginTop: 4, paddingTop: 10, display: "flex", gap: 20, paddingLeft: P.l, fontSize: 11 }}>
            <div>
              <span style={{ color: "#475569" }}>Pipeline: </span>
              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{fmt(totalPipeline)}</span>
            </div>
            <div>
              <span style={{ color: "#475569" }}>Adjusted: </span>
              <span style={{ color: "#a5f3fc", fontWeight: 600 }}>{fmt(totalAdj)}</span>
            </div>
            {totalWon > 0 && (
              <div>
                <span style={{ color: "#475569" }}>Won: </span>
                <span style={{ color: "#4ade80", fontWeight: 600 }}>{fmt(totalWon)}</span>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── US Deals Map ─────────────────────────────────────────────────────────────
function USDealsMap({ deals }) {
  const [mapData, setMapData]   = useState(null);   // { statePaths, stateCentroids, nationPath }
  const [mapError, setMapError] = useState(false);
  const [tooltip, setTooltip]   = useState(null);

  // Fetch us-atlas pre-projected Albers TopoJSON once on mount
  useEffect(() => {
    fetch("https://cdn.jsdelivr.net/npm/us-atlas@3/states-albers-10m.json")
      .then(r => r.json())
      .then(topo => setMapData(parseTopojson(topo)))
      .catch(() => setMapError(true));
  }, []);

  // Aggregate deals by state
  const stateData = useMemo(() => {
    const map = {};
    deals.forEach(d => {
      const s = d.state;
      if (!s) return;
      if (!map[s]) map[s] = { pipeline: 0, adjusted: 0, closedWon: 0, count: 0, products: {} };
      const val = d.value || 0;
      if (d.closedWon) {
        map[s].closedWon += val;
      } else {
        map[s].pipeline += val;
        map[s].adjusted += adjValue(d);
      }
      map[s].count += 1;
      const p = d.product || "";
      map[s].products[p] = (map[s].products[p] || 0) + val;
    });
    return map;
  }, [deals]);

  const statesWithDeals = Object.keys(stateData);
  const maxStateVal = Math.max(
    ...statesWithDeals.map(s => stateData[s].pipeline + stateData[s].closedWon),
    1
  );

  function stateColor(abbr) {
    const prods = stateData[abbr]?.products || {};
    let dominant = "", maxV = 0;
    Object.entries(prods).forEach(([p, v]) => { if (v > maxV) { maxV = v; dominant = p; } });
    return PROD_COLOR[dominant] || "#64748b";
  }

  function bubbleR(abbr) {
    const val = (stateData[abbr]?.pipeline || 0) + (stateData[abbr]?.closedWon || 0);
    if (val === 0) return 0;
    return 6 + Math.sqrt(val / maxStateVal) * 22;
  }

  const { statePaths = {}, stateCentroids = {}, nationPath = "" } = mapData || {};

  // SVG coordinate space from us-atlas Albers projection (bbox ≈ -65..958, 5..607)
  const VIEW = "-65 5 1045 615";

  return (
    <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, padding: "18px 16px 14px", marginTop: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>
            Deal Coverage · US Map
          </h3>
          <p style={{ margin: "3px 0 0", fontSize: 11, color: "#64748b" }}>
            {statesWithDeals.length} state{statesWithDeals.length !== 1 ? "s" : ""} with active deals ·
            hover for details · set state in deal editor
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#64748b", flexShrink: 0 }}>
          {Object.entries(PROD_LABEL).map(([k, v]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: PROD_COLOR[k] }} />
              {v}
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: "relative" }}>
        <svg width="100%" viewBox={VIEW} style={{ display: "block" }}>
          {/* Map background */}
          <rect x="-65" y="5" width="1045" height="615" rx={8} fill="#0b1526" />

          {/* ── Geographic state fills ── */}
          {Object.entries(statePaths).map(([abbr, path]) => {
            const hasDeals = Boolean(stateData[abbr]);
            return (
              <path
                key={abbr}
                d={path}
                fill={hasDeals ? "#172236" : "#0e1829"}
                stroke="#233450"
                strokeWidth={0.6}
                strokeLinejoin="round"
              />
            );
          })}

          {/* ── Nation outline — the outer country border ── */}
          {nationPath && (
            <path
              d={nationPath}
              fill="none"
              stroke="#3d5a82"
              strokeWidth={2.2}
              strokeLinejoin="round"
            />
          )}

          {/* Loading / error states */}
          {!mapData && !mapError && (
            <text x="487" y="310" textAnchor="middle" fontSize={14} fill="#334155">
              Loading map…
            </text>
          )}
          {mapError && (
            <text x="487" y="310" textAnchor="middle" fontSize={12} fill="#7f1d1d">
              Map unavailable — check connection
            </text>
          )}

          {/* ── Deal bubbles at geographic centroids ── */}
          {statesWithDeals.map(abbr => {
            const pos = stateCentroids[abbr];
            if (!pos) return null;
            const [cx, cy] = pos;
            const r = bubbleR(abbr);
            const color = stateColor(abbr);
            const d = stateData[abbr];

            return (
              <g key={`bubble-${abbr}`}>
                {/* Glow halo */}
                <circle cx={cx} cy={cy} r={r + 5}
                  fill="none" stroke={color} strokeWidth={1.5} opacity={0.18} />

                {/* Closed-won dashed ring */}
                {d.closedWon > 0 && (
                  <circle cx={cx} cy={cy} r={r + 2}
                    fill="none" stroke="#4ade80"
                    strokeWidth={1.5} strokeDasharray="4,2" opacity={0.55} />
                )}

                {/* Main bubble */}
                <circle
                  cx={cx} cy={cy} r={r}
                  fill={color} fillOpacity={0.72}
                  stroke={color} strokeWidth={1.5} strokeOpacity={0.9}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setTooltip({ abbr, cx, cy, data: d })}
                  onMouseLeave={() => setTooltip(null)}
                />

                {/* Abbreviation label inside larger bubbles */}
                {r >= 14 && (
                  <text x={cx} y={cy + 4} textAnchor="middle"
                    fontSize={10} fill="#fff" fontWeight="700"
                    style={{ pointerEvents: "none" }}>
                    {abbr}
                  </text>
                )}
              </g>
            );
          })}

          {/* ── Hover tooltip ── */}
          {tooltip && (() => {
            const { abbr, cx: bx, cy: by, data } = tooltip;
            const tipW = 152, tipH = data.closedWon > 0 ? 92 : 76;
            const tipX = Math.min(Math.max(bx - tipW / 2, -60), 890 - tipW);
            const tipY = by < 300 ? by + 20 : by - tipH - 14;
            const dominantProduct = Object.entries(data.products)
              .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
            return (
              <g style={{ pointerEvents: "none" }}>
                <rect x={tipX} y={tipY} width={tipW} height={tipH}
                  rx={5} fill="#0a1628" stroke="#3d5a82" strokeWidth={1} />
                <text x={tipX + tipW / 2} y={tipY + 16} textAnchor="middle"
                  fontSize={11} fill="#f1f5f9" fontWeight="600">
                  {abbr} — {PROD_LABEL[dominantProduct] || "Mixed"}
                </text>
                <text x={tipX + tipW / 2} y={tipY + 31} textAnchor="middle"
                  fontSize={9.5} fill="#a5f3fc">
                  Adj forecast: {fmt(data.adjusted)}
                </text>
                <text x={tipX + tipW / 2} y={tipY + 46} textAnchor="middle"
                  fontSize={9.5} fill="#94a3b8">
                  Pipeline: {fmt(data.pipeline)}
                </text>
                <text x={tipX + tipW / 2} y={tipY + 61} textAnchor="middle"
                  fontSize={9.5} fill="#64748b">
                  {data.count} deal{data.count !== 1 ? "s" : ""}
                </text>
                {data.closedWon > 0 && (
                  <text x={tipX + tipW / 2} y={tipY + 76} textAnchor="middle"
                    fontSize={9.5} fill="#4ade80">
                    Closed won: {fmt(data.closedWon)}
                  </text>
                )}
              </g>
            );
          })()}
        </svg>

        {/* No deals assigned yet */}
        {statesWithDeals.length === 0 && mapData && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center", pointerEvents: "none",
          }}>
            <div style={{ background: "rgba(10,18,36,0.88)", padding: "14px 22px", borderRadius: 8, border: "1px solid #334155", textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>No state data yet</div>
              <div style={{ fontSize: 11, color: "#475569", lineHeight: 1.6 }}>
                Edit any deal and set its State field<br />to see it appear on the map.
              </div>
            </div>
          </div>
        )}

        {/* Bubble size legend */}
        <div style={{ position: "absolute", bottom: 12, right: 14, display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
          <span style={{ fontSize: 10, color: "#2d4564" }}>Bubble size = deal value</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {[["8px", "$5k"], ["13px", "$25k"], ["20px", "$50k+"]].map(([size, label]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: size, height: size, borderRadius: "50%", background: "#38bdf8", opacity: 0.7 }} />
                <span style={{ fontSize: 9, color: "#2d4564" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pipeline Dashboards (composed) ───────────────────────────────────────────
export default function PipelineDashboards({ deals }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16, marginBottom: 0 }}>
        <MonthlyForecastChart deals={deals} />
        <ProductBreakdownChart deals={deals} />
      </div>
      <USDealsMap deals={deals} />
    </div>
  );
}
