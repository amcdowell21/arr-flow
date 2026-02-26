import { useState, useCallback, useRef, useEffect } from "react";
import html2canvas from "html2canvas";
import { db } from "./firebase";
import {
  collection, addDoc, onSnapshot, deleteDoc, doc, serverTimestamp, query, orderBy,
} from "firebase/firestore";
import { fetchAllDeals, fetchPipelines, closedArrForYear } from "./hubspot";

// ─── helpers ─────────────────────────────────────────────────────────────────
function formatCurrency(n) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}
function fmt(n) { return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1); }

// ─── OUTBOUND ────────────────────────────────────────────────────────────────
const defaultOutbound = { reps: 2, touchesPerRep: 150, bookingRate: 5, showRate: 80, qualRate: 50, winRate: 30, acv: 30000 };
function computeOutbound(i) {
  const touches = i.reps * i.touchesPerRep;
  const booked  = touches * (i.bookingRate / 100);
  const held    = booked  * (i.showRate    / 100);
  const opps    = held    * (i.qualRate    / 100);
  const closed  = opps    * (i.winRate     / 100);
  return { touches, booked, held, opps, closed, weeklyArr: closed * i.acv };
}
const outboundNodes = [
  { id:"ob1", label:"Outbound Activities",     sublabel:"Reps × Touches / Rep / Week",    color:"#6366f1", key:"touches", fmt: v=>`${fmt(v)}/wk` },
  { id:"ob2", label:"Meetings Booked",         sublabel:"Activities × Booking Rate",       color:"#8b5cf6", key:"booked",  fmt: v=>`${fmt(v)}/wk` },
  { id:"ob3", label:"Meetings Held",           sublabel:"Booked × Show Rate",              color:"#a855f7", key:"held",    fmt: v=>`${fmt(v)}/wk` },
  { id:"ob4", label:"Qualified Opportunities", sublabel:"Meetings Held × Qual Rate",       color:"#d946ef", key:"opps",    fmt: v=>`${fmt(v)}/wk` },
  { id:"ob5", label:"Deals Closed",            sublabel:"Opps × Win Rate",                 color:"#f43f5e", key:"closed",  fmt: v=>`${fmt(v*52)}/yr` },
];
const outboundSliders = [
  { section:"Activities", color:"#6366f1", inputs:[
    { key:"reps",          label:"# of Reps",             min:1,    max:20,    step:1,    suffix:" reps" },
    { key:"touchesPerRep", label:"Touches/Rep/Week",      min:10,   max:500,   step:10,   suffix:"" },
  ]},
  { section:"Booking", color:"#8b5cf6", inputs:[
    { key:"bookingRate",   label:"Booking Rate",           min:1,    max:30,    step:0.5,  suffix:"%" },
  ]},
  { section:"Show Rate", color:"#a855f7", inputs:[
    { key:"showRate",      label:"Show Rate",              min:40,   max:100,   step:1,    suffix:"%" },
  ]},
  { section:"Qualification", color:"#d946ef", inputs:[
    { key:"qualRate",      label:"Qual Rate",              min:10,   max:100,   step:5,    suffix:"%" },
  ]},
  { section:"Closing", color:"#f43f5e", inputs:[
    { key:"winRate",       label:"Win Rate",               min:5,    max:80,    step:5,    suffix:"%" },
    { key:"acv",           label:"Avg Contract Value",     min:5000, max:500000,step:5000, suffix:"$", isCurrency:true },
  ]},
];

// ─── IN-PERSON ───────────────────────────────────────────────────────────────
const defaultInPerson = { eventsPerMonth: 2, avgPeopleMet: 15, metToMeeting: 20, meetingToOpp: 50, winRate: 40, acv: 35000 };
function computeInPerson(i) {
  const evWk      = i.eventsPerMonth / 4.33;
  const peopleWk  = evWk   * i.avgPeopleMet;
  const meetingsWk= peopleWk * (i.metToMeeting  / 100);
  const oppsWk    = meetingsWk*(i.meetingToOpp  / 100);
  const closedWk  = oppsWk   * (i.winRate       / 100);
  return { evWk, peopleWk, meetingsWk, oppsWk, closedWk, weeklyArr: closedWk * i.acv };
}
const inPersonNodes = [
  { id:"ip1", label:"Events Attended",         sublabel:"Events per Month",                color:"#f59e0b", key:"evWk",      fmt: v=>`${fmt(v*4.33)}/mo` },
  { id:"ip2", label:"People Met",              sublabel:"Events × Avg People Met",         color:"#f97316", key:"peopleWk",  fmt: v=>`${fmt(v)}/wk` },
  { id:"ip3", label:"Meetings Booked",         sublabel:"People Met × Conversion",         color:"#fb923c", key:"meetingsWk",fmt: v=>`${fmt(v)}/wk` },
  { id:"ip4", label:"Qualified Opportunities", sublabel:"Meetings × Opp Rate",             color:"#ef4444", key:"oppsWk",    fmt: v=>`${fmt(v)}/wk` },
  { id:"ip5", label:"Deals Closed",            sublabel:"Opps × Win Rate",                 color:"#dc2626", key:"closedWk",  fmt: v=>`${fmt(v*52)}/yr` },
];
const inPersonSliders = [
  { section:"Events", color:"#f59e0b", inputs:[
    { key:"eventsPerMonth", label:"Events / Month",        min:1,  max:20,    step:1,    suffix:" events" },
    { key:"avgPeopleMet",   label:"Avg People Met / Event",min:1,  max:100,   step:1,    suffix:" people" },
  ]},
  { section:"Conversion", color:"#f97316", inputs:[
    { key:"metToMeeting",   label:"People → Meeting Rate", min:1,  max:60,    step:1,    suffix:"%" },
  ]},
  { section:"Qualification", color:"#fb923c", inputs:[
    { key:"meetingToOpp",   label:"Meeting → Opp Rate",    min:10, max:100,   step:5,    suffix:"%" },
  ]},
  { section:"Closing", color:"#dc2626", inputs:[
    { key:"winRate",        label:"Win Rate",               min:5,  max:80,    step:5,    suffix:"%" },
    { key:"acv",            label:"Avg Contract Value",     min:5000,max:500000,step:5000,suffix:"$", isCurrency:true },
  ]},
];

// ─── PODCAST ─────────────────────────────────────────────────────────────────
const defaultPodcast = { interviewsPerMonth: 5, guestToFollowup: 70, showRate: 90, winRate: 25, acv: 30000 };
function computePodcast(i) {
  const intWk      = i.interviewsPerMonth / 4.33;
  const followupWk = intWk    * (i.guestToFollowup / 100);
  const heldWk     = followupWk*(i.showRate        / 100);
  const closedWk   = heldWk   * (i.winRate         / 100);
  return { intWk, followupWk, heldWk, closedWk, weeklyArr: closedWk * i.acv };
}
const podcastNodes = [
  { id:"pd1", label:"Interviews Recorded",     sublabel:"Episodes per Month",              color:"#10b981", key:"intWk",      fmt: v=>`${fmt(v*4.33)}/mo` },
  { id:"pd2", label:"Follow-up Meetings Booked",sublabel:"Guests Who Book a Follow-up",   color:"#34d399", key:"followupWk", fmt: v=>`${fmt(v)}/wk` },
  { id:"pd3", label:"Follow-up Meetings Held", sublabel:"Booked × Show Rate",             color:"#6ee7b7", key:"heldWk",     fmt: v=>`${fmt(v)}/wk` },
  { id:"pd4", label:"Deals Closed",            sublabel:"Meetings Held × Win Rate",        color:"#059669", key:"closedWk",   fmt: v=>`${fmt(v*52)}/yr` },
];
const podcastSliders = [
  { section:"Recording", color:"#10b981", inputs:[
    { key:"interviewsPerMonth", label:"Interviews / Month",    min:1,  max:20,    step:1,    suffix:" episodes" },
  ]},
  { section:"Follow-up Booked", color:"#34d399", inputs:[
    { key:"guestToFollowup",    label:"Guest → Follow-up Rate",min:10, max:100,   step:5,    suffix:"%" },
  ]},
  { section:"Show Rate", color:"#6ee7b7", inputs:[
    { key:"showRate",           label:"Follow-up Show Rate",   min:40, max:100,   step:1,    suffix:"%" },
  ]},
  { section:"Closing", color:"#059669", inputs:[
    { key:"winRate",            label:"Win Rate",               min:5,  max:80,    step:5,    suffix:"%" },
    { key:"acv",                label:"Avg Contract Value",     min:5000,max:500000,step:5000,suffix:"$",isCurrency:true },
  ]},
];

// ─── Slider ───────────────────────────────────────────────────────────────────
function Slider({ config, value, onChange }) {
  return (
    <div style={{ marginBottom:12 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
        <label style={{ fontSize:11, color:"rgba(255,255,255,0.38)", fontFamily:"'DM Mono',monospace" }}>{config.label}</label>
        <span style={{ fontSize:12, color:"#fff", fontWeight:600, fontFamily:"'DM Mono',monospace" }}>
          {config.isCurrency ? formatCurrency(value) : `${value}${config.suffix}`}
        </span>
      </div>
      <input type="range" min={config.min} max={config.max} step={config.step} value={value}
        onChange={e=>onChange(config.key, Number(e.target.value))} style={{ width:"100%", cursor:"pointer" }} />
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"rgba(255,255,255,0.15)", fontFamily:"'DM Mono',monospace", marginTop:1 }}>
        <span>{config.isCurrency ? formatCurrency(config.min) : `${config.min}${config.suffix}`}</span>
        <span>{config.isCurrency ? formatCurrency(config.max) : `${config.max}${config.suffix}`}</span>
      </div>
    </div>
  );
}

// ─── Channel label pill ───────────────────────────────────────────────────────
function ChannelPill({ color, label }) {
  return (
    <div style={{ textAlign:"center", marginBottom:8 }}>
      <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:`${color}18`, border:`1px solid ${color}40`, borderRadius:20, padding:"4px 14px" }}>
        <div style={{ width:6, height:6, borderRadius:"50%", background:color, boxShadow:`0 0 6px ${color}90` }} />
        <span style={{ fontSize:11, fontWeight:600, color:`${color}dd`, fontFamily:"'DM Mono',monospace", letterSpacing:"0.07em" }}>{label}</span>
      </div>
    </div>
  );
}

// ─── Node type badge config ───────────────────────────────────────────────────
const NODE_TYPE_CONFIG = {
  input:     { label:"Input Metric",  bg:"rgba(59,130,246,0.14)",  border:"rgba(59,130,246,0.38)",  color:"#93c5fd" },
  influence: { label:"Influence-able", bg:"rgba(245,158,11,0.14)", border:"rgba(245,158,11,0.38)", color:"#fcd34d" },
};

// ─── Funnel column ────────────────────────────────────────────────────────────
function FunnelColumn({ nodes, computed, mode, outputColor, outputLabel, outputValue, nodeTypes, onToggleType }) {
  return (
    <div style={{ flex:1, minWidth:180, maxWidth:280 }}>
      {nodes.map((m, i) => {
        const type = nodeTypes?.[m.id];
        const badge = type ? NODE_TYPE_CONFIG[type] : null;
        return (
        <div key={m.id}>
          {i > 0 && (
            <div style={{ height:20, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                <div style={{ width:2, height:11, background:"rgba(255,255,255,0.1)" }} />
                <svg width="8" height="5" viewBox="0 0 8 5"><path d="M0 0L4 5L8 0" fill="rgba(255,255,255,0.12)"/></svg>
              </div>
            </div>
          )}
          <div style={{ border:`1px solid ${badge ? badge.border : "rgba(255,255,255,0.08)"}`, borderRadius:9, padding:"11px 13px", background: badge ? badge.bg : "rgba(255,255,255,0.025)", position:"relative", overflow:"hidden", transition:"border-color 0.2s, background 0.2s" }}>
            <div style={{ position:"absolute", left:0, top:0, bottom:0, width:3, borderRadius:"3px 0 0 3px", background:m.color, opacity:0.65 }} />
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:600, color:"#fff", marginBottom:2, lineHeight:1.3 }}>{m.label}</div>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.25)", fontFamily:"'DM Mono',monospace", lineHeight:1.4 }}>{m.sublabel}</div>
              </div>
              {mode === "calculator" ? (
                <div style={{ fontFamily:"'DM Mono',monospace", fontSize:11, fontWeight:700, color:m.color, textAlign:"right", flexShrink:0, marginLeft:6 }}>
                  {m.fmt(computed[m.key])}
                </div>
              ) : (
                <div style={{ width:6, height:6, borderRadius:"50%", background:m.color, boxShadow:`0 0 6px ${m.color}80`, flexShrink:0, marginLeft:6, marginTop:3 }} />
              )}
            </div>
            {/* Type badge */}
            <div style={{ marginTop:7, display:"flex", alignItems:"center", gap:5 }}>
              <button
                onClick={() => onToggleType(m.id)}
                style={{
                  display:"inline-flex", alignItems:"center", gap:4,
                  background: badge ? badge.bg : "transparent",
                  border: `1px ${badge ? "solid" : "dashed"} ${badge ? badge.border : "rgba(255,255,255,0.15)"}`,
                  borderRadius:20, padding:"2px 8px", cursor:"pointer",
                  color: badge ? badge.color : "rgba(255,255,255,0.22)",
                  fontSize:9, fontWeight:600, fontFamily:"'DM Mono',monospace",
                  letterSpacing:"0.06em", transition:"all 0.15s",
                }}
              >
                {badge ? badge.label : "label…"}
              </button>
            </div>
          </div>
        </div>
        );
      })}

      {/* Output node */}
      <div style={{ height:20, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
          <div style={{ width:2, height:11, background:"rgba(255,255,255,0.1)" }} />
          <svg width="8" height="5" viewBox="0 0 8 5"><path d="M0 0L4 5L8 0" fill="rgba(255,255,255,0.12)"/></svg>
        </div>
      </div>
      <div style={{ border:`1px solid ${outputColor}35`, borderRadius:9, padding:"12px 13px", background:`${outputColor}0c`, position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", left:0, top:0, bottom:0, width:4, borderRadius:"3px 0 0 3px", background:outputColor }} />
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:outputColor, marginBottom:2 }}>{outputLabel}</div>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.25)", fontFamily:"'DM Mono',monospace" }}>Annual · 52 weeks</div>
          </div>
          {mode === "calculator" && (
            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:13, fontWeight:700, color:outputColor }}>
              {formatCurrency(outputValue)}
            </div>
          )}
          {mode === "explore" && (
            <div style={{ width:7, height:7, borderRadius:"50%", background:outputColor, boxShadow:`0 0 8px ${outputColor}90` }} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sliders panel ────────────────────────────────────────────────────────────
function SlidersPanel({ title, color, sections, values, onChange }) {
  return (
    <div style={{ flex:1, minWidth:240 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
        <div style={{ width:6, height:6, borderRadius:"50%", background:color, boxShadow:`0 0 6px ${color}90` }} />
        <span style={{ fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:"0.1em", textTransform:"uppercase", color:`${color}cc` }}>{title}</span>
      </div>
      <div style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:13, padding:18 }}>
        {sections.map(s => (
          <div key={s.section} style={{ marginBottom:18 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:9 }}>
              <div style={{ width:5, height:5, borderRadius:"50%", background:s.color }} />
              <span style={{ fontSize:10, fontWeight:600, color:"rgba(255,255,255,0.4)" }}>{s.section}</span>
            </div>
            {s.inputs.map(inp => <Slider key={inp.key} config={inp} value={values[inp.key]} onChange={onChange} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Scenario Sidebar ─────────────────────────────────────────────────────────
function ScenarioSidebar({ scenarios, loading, onLoad, onDelete, onSave, hs }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showHsInput, setShowHsInput] = useState(false);

  const isConnected = hs.deals.length > 0;

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    await onSave(name.trim());
    setName("");
    setSaving(false);
  }

  function handleHsSync() {
    hs.onSync();
    // Once synced, collapse the input if successful (handled by isConnected changing)
  }

  return (
    <div style={{
      width: 220, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.07)",
      background: "rgba(255,255,255,0.015)", display: "flex", flexDirection: "column",
      minHeight: "100vh", padding: "28px 0 0",
    }}>
      {/* Header */}
      <div style={{ padding: "0 16px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div style={{ fontFamily:"'DM Mono',monospace", fontSize:9, letterSpacing:"0.12em", textTransform:"uppercase", color:"rgba(255,255,255,0.2)", marginBottom:10 }}>
          Saved Scenarios
        </div>
        <div style={{ display:"flex", gap:6 }}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder="Scenario name…"
            style={{
              flex:1, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)",
              borderRadius:7, padding:"6px 9px", fontSize:11, color:"#fff", outline:"none",
              fontFamily:"'DM Sans',sans-serif",
            }}
          />
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            style={{
              background: name.trim() ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${name.trim() ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.08)"}`,
              borderRadius:7, padding:"6px 9px", cursor: name.trim() ? "pointer" : "default",
              color: name.trim() ? "#a5b4fc" : "rgba(255,255,255,0.2)", fontSize:11, fontWeight:600,
              fontFamily:"'DM Mono',monospace", transition:"all 0.15s",
            }}
          >
            {saving ? "…" : "Save"}
          </button>
        </div>
      </div>

      {/* Scenario list */}
      <div style={{ flex:1, overflowY:"auto", padding:"10px 8px" }}>
        {loading && (
          <div style={{ textAlign:"center", padding:"20px 0", fontSize:11, color:"rgba(255,255,255,0.2)", fontFamily:"'DM Mono',monospace" }}>
            Loading…
          </div>
        )}
        {!loading && scenarios.length === 0 && (
          <div style={{ textAlign:"center", padding:"20px 8px", fontSize:11, color:"rgba(255,255,255,0.18)", fontFamily:"'DM Mono',monospace", lineHeight:1.6 }}>
            No scenarios yet.<br/>Save one above.
          </div>
        )}
        {scenarios.map(s => (
          <div key={s.id}
            style={{
              borderRadius:8, padding:"9px 10px", marginBottom:4,
              background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)",
              position:"relative",
            }}
          >
            <div onClick={() => onLoad(s)} style={{ cursor:"pointer" }}>
              <div style={{ fontSize:12, fontWeight:600, color:"rgba(255,255,255,0.85)", marginBottom:3, paddingRight:20 }}>
                {s.name}
              </div>
              <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, color:"#6ee7b7", marginBottom:2 }}>
                {formatCurrency((s.ob && s.ip && s.pd)
                  ? (computeOutbound(s.ob).weeklyArr + computeInPerson(s.ip).weeklyArr + computePodcast(s.pd).weeklyArr) * 52
                  : 0
                )}<span style={{ color:"rgba(255,255,255,0.2)", fontSize:9 }}> ARR</span>
              </div>
              {s.createdAt && (
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.2)", fontFamily:"'DM Mono',monospace" }}>
                  {new Date(s.createdAt.seconds * 1000).toLocaleDateString()}
                </div>
              )}
            </div>
            {confirmDelete === s.id ? (
              <div style={{ display:"flex", gap:4, marginTop:6 }}>
                <button onClick={() => { onDelete(s.id); setConfirmDelete(null); }}
                  style={{ flex:1, background:"rgba(239,68,68,0.2)", border:"1px solid rgba(239,68,68,0.4)", borderRadius:5, padding:"3px 0", fontSize:10, color:"#fca5a5", cursor:"pointer", fontFamily:"'DM Mono',monospace" }}>
                  Delete
                </button>
                <button onClick={() => setConfirmDelete(null)}
                  style={{ flex:1, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:5, padding:"3px 0", fontSize:10, color:"rgba(255,255,255,0.4)", cursor:"pointer", fontFamily:"'DM Mono',monospace" }}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); setConfirmDelete(s.id); }}
                style={{ position:"absolute", top:8, right:8, background:"transparent", border:"none", padding:2, cursor:"pointer", color:"rgba(255,255,255,0.18)", lineHeight:1 }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* HubSpot button */}
      <div style={{ borderTop:"1px solid rgba(255,255,255,0.07)", padding:"12px" }}>
        {isConnected && !showHsInput ? (
          /* Connected state: full-width button → navigates to HubSpot page */
          <div style={{ display:"flex", gap:6 }}>
            <button
              onClick={hs.onOpenPage}
              style={{
                flex:1, display:"flex", alignItems:"center", gap:8,
                background:"rgba(52,211,153,0.08)", border:"1px solid rgba(52,211,153,0.22)",
                borderRadius:9, padding:"10px 12px", cursor:"pointer", transition:"background 0.15s",
              }}
            >
              <div style={{ width:7, height:7, borderRadius:"50%", background:"#34d399", boxShadow:"0 0 6px rgba(52,211,153,0.7)", flexShrink:0 }} />
              <div style={{ flex:1, textAlign:"left" }}>
                <div style={{ fontSize:11, fontWeight:600, color:"#6ee7b7", fontFamily:"'DM Mono',monospace" }}>HubSpot CRM</div>
                <div style={{ fontSize:9, color:"rgba(255,255,255,0.28)", fontFamily:"'DM Mono',monospace", marginTop:1 }}>
                  {hs.syncing ? "Syncing…" : `${hs.deals.length} deals`}
                </div>
              </div>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink:0, opacity:0.4 }}>
                <path d="M3 1.5L7 5 3 8.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {/* Settings icon to re-enter token */}
            <button
              onClick={() => setShowHsInput(true)}
              title="Change token"
              style={{
                background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)",
                borderRadius:9, padding:"0 10px", cursor:"pointer", color:"rgba(255,255,255,0.25)",
                transition:"all 0.15s",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.5 2.5l.7.7M8.8 8.8l.7.7M2.5 9.5l.7-.7M8.8 3.2l.7-.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
            </button>
          </div>
        ) : (
          /* Not connected or editing token */
          <>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:"rgba(255,255,255,0.15)" }} />
                <span style={{ fontFamily:"'DM Mono',monospace", fontSize:9, letterSpacing:"0.12em", textTransform:"uppercase", color:"rgba(255,255,255,0.2)" }}>
                  HubSpot CRM
                </span>
              </div>
              {isConnected && (
                <button
                  onClick={() => setShowHsInput(false)}
                  style={{ background:"transparent", border:"none", cursor:"pointer", color:"rgba(255,255,255,0.3)", padding:2, lineHeight:1 }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              )}
            </div>
            <div style={{ display:"flex", gap:6, marginBottom:6 }}>
              <input
                type="password"
                value={hs.token}
                onChange={e => hs.onTokenChange(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleHsSync()}
                placeholder="pat-na1-…"
                style={{
                  flex:1, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)",
                  borderRadius:7, padding:"6px 9px", fontSize:11, color:"#fff", outline:"none",
                  fontFamily:"'DM Mono',monospace",
                }}
              />
              <button
                onClick={handleHsSync}
                disabled={!hs.token.trim() || hs.syncing}
                style={{
                  background: hs.token.trim() ? "rgba(52,211,153,0.18)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${hs.token.trim() ? "rgba(52,211,153,0.4)" : "rgba(255,255,255,0.08)"}`,
                  borderRadius:7, padding:"6px 10px",
                  cursor: hs.token.trim() && !hs.syncing ? "pointer" : "default",
                  color: hs.token.trim() ? "#6ee7b7" : "rgba(255,255,255,0.2)",
                  fontSize:11, fontWeight:600, fontFamily:"'DM Mono',monospace",
                  transition:"all 0.15s", flexShrink:0,
                }}
              >
                {hs.syncing ? "…" : "Sync"}
              </button>
            </div>
            {hs.error && (
              <div style={{ fontSize:10, color:"#f87171", fontFamily:"'DM Mono',monospace", marginBottom:5, lineHeight:1.4 }}>
                {hs.error}
              </div>
            )}
            {!hs.token && (
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.14)", fontFamily:"'DM Mono',monospace", lineHeight:1.6 }}>
                Settings → Integrations →<br/>Private Apps · scope: deals.read
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── HubSpot Page ─────────────────────────────────────────────────────────────
function HubSpotPage({ hs }) {
  const { deals, pipelines, syncing, error, lastSync, closedArr } = hs;
  const [activePipelineId, setActivePipelineId] = useState(null);
  const [expandedStageId, setExpandedStageId] = useState(null);

  useEffect(() => {
    if (pipelines.length > 0 && !activePipelineId) {
      setActivePipelineId(pipelines[0].id);
    }
  }, [pipelines, activePipelineId]);

  const pipeline = pipelines.find(p => p.id === activePipelineId);
  const pipelineDeals = deals.filter(d => d.properties?.pipeline === activePipelineId);

  const openPipelineValue = deals
    .filter(d => d.properties?.dealstage !== "closedlost" && d.properties?.dealstage !== "closedwon")
    .reduce((sum, d) => sum + (parseFloat(d.properties?.amount) || 0), 0);

  const sortedStages = (pipeline?.stages ?? []).slice().sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

  return (
    <div style={{ flex:1, padding:"32px 32px 64px", minWidth:0, overflowY:"auto" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:28 }}>
        <button
          onClick={hs.onClosePage}
          style={{
            display:"flex", alignItems:"center", gap:6,
            background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)",
            borderRadius:8, padding:"7px 13px", cursor:"pointer", color:"rgba(255,255,255,0.5)",
            fontSize:12, fontFamily:"'DM Mono',monospace", transition:"all 0.15s",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M7 1.5L3 5 7 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>

        <div style={{ flex:1 }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:"rgba(255,255,255,0.2)", marginBottom:4 }}>
            CRM Integration
          </div>
          <h1 style={{ fontSize:20, fontWeight:600, color:"#fff", letterSpacing:"-0.3px" }}>HubSpot Deals</h1>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {lastSync && !syncing && (
            <span style={{ fontSize:9, color:"rgba(255,255,255,0.2)", fontFamily:"'DM Mono',monospace" }}>
              Synced {lastSync.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={hs.onSync}
            disabled={!hs.token.trim() || syncing}
            style={{
              display:"flex", alignItems:"center", gap:6,
              background: syncing ? "rgba(255,255,255,0.04)" : "rgba(52,211,153,0.12)",
              border:`1px solid ${syncing ? "rgba(255,255,255,0.08)" : "rgba(52,211,153,0.3)"}`,
              borderRadius:8, padding:"7px 13px", cursor: syncing ? "default" : "pointer",
              color: syncing ? "rgba(255,255,255,0.25)" : "#6ee7b7",
              fontSize:12, fontWeight:600, fontFamily:"'DM Mono',monospace", transition:"all 0.15s",
            }}
          >
            {syncing ? "Syncing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.25)", borderRadius:10, padding:"12px 16px", marginBottom:24, fontSize:12, color:"#fca5a5", fontFamily:"'DM Mono',monospace" }}>
          {error}
        </div>
      )}

      {/* Syncing empty state */}
      {syncing && deals.length === 0 && (
        <div style={{ textAlign:"center", padding:"80px 0", color:"rgba(255,255,255,0.2)", fontFamily:"'DM Mono',monospace", fontSize:13 }}>
          Fetching deals…
        </div>
      )}

      {/* Summary cards */}
      {deals.length > 0 && (
        <div style={{ display:"flex", gap:14, marginBottom:32, flexWrap:"wrap" }}>
          {[
            { label:"Total Deals",      value: deals.length,       display: `${deals.length}`,                color:"#fff" },
            { label:"Closed Won YTD",   value: closedArr,          display: formatCurrency(closedArr),        color:"#6ee7b7" },
            { label:"Open Pipeline",    value: openPipelineValue,  display: formatCurrency(openPipelineValue),color:"#c4b5fd" },
            { label:"Pipelines",        value: pipelines.length,   display: `${pipelines.length}`,            color:"#fcd34d" },
          ].map(card => (
            <div key={card.label} style={{
              flex:1, minWidth:130,
              background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.07)",
              borderRadius:12, padding:"16px 18px",
            }}>
              <div style={{ fontSize:9, color:"rgba(255,255,255,0.28)", fontFamily:"'DM Mono',monospace", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>
                {card.label}
              </div>
              <div style={{ fontSize:22, fontWeight:700, color:card.color, fontFamily:"'DM Mono',monospace", letterSpacing:"-0.5px" }}>
                {card.display}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pipeline tabs + stage table */}
      {pipelines.length > 0 && (
        <div>
          {/* Pipeline tabs */}
          <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap" }}>
            {pipelines.map(p => {
              const pDeals = deals.filter(d => d.properties?.pipeline === p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => { setActivePipelineId(p.id); setExpandedStageId(null); }}
                  style={{
                    display:"flex", alignItems:"center", gap:7,
                    padding:"7px 14px", borderRadius:8, fontSize:12, fontWeight:500, cursor:"pointer",
                    background: activePipelineId === p.id ? "rgba(255,255,255,0.09)" : "transparent",
                    border:`1px solid ${activePipelineId === p.id ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"}`,
                    color: activePipelineId === p.id ? "#fff" : "rgba(255,255,255,0.38)",
                    fontFamily:"'DM Sans',sans-serif", transition:"all 0.15s",
                  }}
                >
                  {p.label}
                  <span style={{ fontSize:10, color:"rgba(255,255,255,0.28)", fontFamily:"'DM Mono',monospace" }}>
                    {pDeals.length}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Stage table */}
          {pipeline && (
            <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, overflow:"hidden" }}>
              {/* Column headers */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 70px 130px 28px", padding:"10px 16px", borderBottom:"1px solid rgba(255,255,255,0.06)", background:"rgba(255,255,255,0.03)" }}>
                {["Stage", "Deals", "Value", ""].map((h, i) => (
                  <span key={h+i} style={{ fontSize:9, color:"rgba(255,255,255,0.25)", fontFamily:"'DM Mono',monospace", letterSpacing:"0.1em", textTransform:"uppercase", textAlign: i > 0 ? "right" : "left" }}>
                    {h}
                  </span>
                ))}
              </div>

              {sortedStages.map(stage => {
                const stageDeals = pipelineDeals.filter(d => d.properties?.dealstage === stage.id);
                const stageValue = stageDeals.reduce((sum, d) => sum + (parseFloat(d.properties?.amount) || 0), 0);
                const isExpanded = expandedStageId === stage.id;
                const isClosedWon  = stage.id === "closedwon"  || stage.metadata?.probability === "1.0";
                const isClosedLost = stage.id === "closedlost" || stage.metadata?.probability === "0.0";
                const dotColor = isClosedWon ? "#34d399" : isClosedLost ? "#f87171" : "#818cf8";
                const valueColor = isClosedWon ? "#6ee7b7" : "#c4b5fd";

                return (
                  <div key={stage.id}>
                    <div
                      onClick={() => stageDeals.length > 0 && setExpandedStageId(isExpanded ? null : stage.id)}
                      style={{
                        display:"grid", gridTemplateColumns:"1fr 70px 130px 28px",
                        padding:"12px 16px", borderBottom:"1px solid rgba(255,255,255,0.04)",
                        cursor: stageDeals.length > 0 ? "pointer" : "default",
                        background: isExpanded ? "rgba(255,255,255,0.035)" : "transparent",
                        transition:"background 0.15s",
                      }}
                    >
                      <div style={{ display:"flex", alignItems:"center", gap:9 }}>
                        <div style={{ width:7, height:7, borderRadius:2, background:dotColor, flexShrink:0 }} />
                        <span style={{ fontSize:12, color:"rgba(255,255,255,0.78)" }}>{stage.label}</span>
                      </div>
                      <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)", fontFamily:"'DM Mono',monospace", textAlign:"right" }}>
                        {stageDeals.length || "—"}
                      </span>
                      <span style={{ fontSize:12, fontWeight:600, color: stageValue > 0 ? valueColor : "rgba(255,255,255,0.18)", fontFamily:"'DM Mono',monospace", textAlign:"right" }}>
                        {stageValue > 0 ? formatCurrency(stageValue) : "—"}
                      </span>
                      <span style={{ textAlign:"right", fontSize:9, color:"rgba(255,255,255,0.18)", paddingRight:2 }}>
                        {stageDeals.length > 0 ? (isExpanded ? "▲" : "▼") : ""}
                      </span>
                    </div>

                    {/* Expanded deals */}
                    {isExpanded && stageDeals.map(deal => (
                      <div key={deal.id} style={{
                        display:"grid", gridTemplateColumns:"1fr 70px 130px 28px",
                        padding:"8px 16px 8px 42px",
                        borderBottom:"1px solid rgba(255,255,255,0.025)",
                        background:"rgba(255,255,255,0.012)",
                      }}>
                        <span style={{ fontSize:11, color:"rgba(255,255,255,0.48)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {deal.properties?.dealname || "Untitled deal"}
                        </span>
                        <span />
                        <span style={{ fontSize:11, color:"rgba(255,255,255,0.38)", fontFamily:"'DM Mono',monospace", textAlign:"right" }}>
                          {parseFloat(deal.properties?.amount) > 0 ? formatCurrency(parseFloat(deal.properties.amount)) : "—"}
                        </span>
                        <span />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* No data empty state */}
      {!syncing && !error && deals.length === 0 && hs.token && (
        <div style={{ textAlign:"center", padding:"80px 0", color:"rgba(255,255,255,0.2)", fontFamily:"'DM Mono',monospace", fontSize:12, lineHeight:2 }}>
          No deals found.<br/>Click Refresh to sync from HubSpot.
        </div>
      )}

      {!hs.token && (
        <div style={{ textAlign:"center", padding:"80px 0", color:"rgba(255,255,255,0.2)", fontFamily:"'DM Mono',monospace", fontSize:12, lineHeight:2 }}>
          Add your HubSpot token in the sidebar to get started.
        </div>
      )}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function ARRFlow() {
  const [mode, setMode] = useState("explore");
  const [ob, setOb] = useState(defaultOutbound);
  const [ip, setIp] = useState(defaultInPerson);
  const [pd, setPd] = useState(defaultPodcast);
  const [hsToken, setHsToken]       = useState(() => localStorage.getItem("hs_token") || "");
  const [hsDeals, setHsDeals]       = useState([]);
  const [hsPipelines, setHsPipelines] = useState([]);
  const [hsSyncing, setHsSyncing]   = useState(false);
  const [hsError, setHsError]       = useState(null);
  const [hsLastSync, setHsLastSync] = useState(null);
  const [view, setView]             = useState("main");
  const [nodeTypes, setNodeTypes] = useState({});
  const pageRef = useRef(null);

  const handleToggleType = useCallback((id) => {
    setNodeTypes(p => {
      const cur = p[id];
      const next = cur === undefined ? "input" : cur === "input" ? "influence" : undefined;
      if (next === undefined) { const { [id]: _, ...rest } = p; return rest; }
      return { ...p, [id]: next };
    });
  }, []);

  // Firestore scenarios
  const [scenarios, setScenarios] = useState([]);
  const [scenariosLoading, setScenariosLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "scenarios"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, snap => {
      setScenarios(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setScenariosLoading(false);
    });
    return unsub;
  }, []);

  const handleSaveScenario = useCallback(async (name) => {
    await addDoc(collection(db, "scenarios"), { name, ob, ip, pd, nodeTypes, createdAt: serverTimestamp() });
  }, [ob, ip, pd, nodeTypes]);

  const handleLoadScenario = useCallback((s) => {
    if (s.ob) setOb(s.ob);
    if (s.ip) setIp(s.ip);
    if (s.pd) setPd(s.pd);
    setNodeTypes(s.nodeTypes ?? {});
    setMode("calculator");
  }, []);

  const handleDeleteScenario = useCallback(async (id) => {
    await deleteDoc(doc(db, "scenarios", id));
  }, []);

  const handleHsTokenChange = useCallback((t) => {
    setHsToken(t);
    localStorage.setItem("hs_token", t);
  }, []);

  const syncHubspot = useCallback(async () => {
    if (!hsToken.trim()) return;
    setHsSyncing(true);
    setHsError(null);
    try {
      const [deals, pipelines] = await Promise.all([
        fetchAllDeals(hsToken.trim()),
        fetchPipelines(hsToken.trim()),
      ]);
      setHsDeals(deals);
      setHsPipelines(pipelines);
      setHsLastSync(new Date());
    } catch (e) {
      setHsError(e.message);
    } finally {
      setHsSyncing(false);
    }
  }, [hsToken]);

  // Auto-sync on mount if a token was previously saved
  useEffect(() => {
    const token = localStorage.getItem("hs_token");
    if (!token) return;
    setHsSyncing(true);
    Promise.all([fetchAllDeals(token), fetchPipelines(token)])
      .then(([deals, pipelines]) => {
        setHsDeals(deals);
        setHsPipelines(pipelines);
        setHsLastSync(new Date());
      })
      .catch(e => setHsError(e.message))
      .finally(() => setHsSyncing(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownload = useCallback(async () => {
    if (!pageRef.current) return;
    const canvas = await html2canvas(pageRef.current, { backgroundColor: "#09090e", scale: 2, useCORS: true });
    const link = document.createElement("a");
    link.download = `arr-flow-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, []);

  const cob = computeOutbound(ob);
  const cip = computeInPerson(ip);
  const cpd = computePodcast(pd);

  const obArr = cob.weeklyArr * 52;
  const ipArr = cip.weeklyArr * 52;
  const pdArr = cpd.weeklyArr * 52;
  const total = obArr + ipArr + pdArr;

  const channels = [
    { arr: obArr, color:"#8b5cf6", label:"OUTBOUND",  pct: total>0?Math.round(obArr/total*100):0 },
    { arr: ipArr, color:"#f59e0b", label:"IN-PERSON", pct: total>0?Math.round(ipArr/total*100):0 },
    { arr: pdArr, color:"#10b981", label:"PODCAST",   pct: total>0?Math.round(pdArr/total*100):0 },
  ];

  const handleOb = useCallback((k,v)=>setOb(p=>({...p,[k]:v})),[]);
  const handleIp = useCallback((k,v)=>setIp(p=>({...p,[k]:v})),[]);
  const handlePd = useCallback((k,v)=>setPd(p=>({...p,[k]:v})),[]);

  const closedArr = closedArrForYear(hsDeals);
  const hs = {
    token: hsToken, onTokenChange: handleHsTokenChange,
    syncing: hsSyncing, error: hsError, lastSync: hsLastSync,
    deals: hsDeals, pipelines: hsPipelines, closedArr, onSync: syncHubspot,
    isActive: view === "hubspot",
    onOpenPage: () => setView("hubspot"),
    onClosePage: () => setView("main"),
  };

  return (
    <div style={{ fontFamily:"'DM Sans','Helvetica Neue',sans-serif", background:"#09090e", minHeight:"100vh", color:"#f0f0f5", display:"flex", flexDirection:"row" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        .tab { padding:6px 16px; border-radius:8px; font-size:13px; font-weight:500; cursor:pointer; border:1px solid transparent; transition:all 0.15s; background:transparent; color:rgba(255,255,255,0.35); font-family:'DM Sans',sans-serif; }
        .tab.on { background:rgba(255,255,255,0.09); border-color:rgba(255,255,255,0.12); color:#fff; }
        .tab:hover:not(.on) { color:rgba(255,255,255,0.6); }
        input[type=range] { -webkit-appearance:none; width:100%; height:3px; border-radius:4px; background:rgba(255,255,255,0.1); outline:none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:13px; height:13px; border-radius:50%; background:#6366f1; cursor:pointer; box-shadow:0 0 7px rgba(99,102,241,0.5); }
        input[type=text], input[type=text]::placeholder { color:rgba(255,255,255,0.3); }
        input[type=text]:focus { border-color:rgba(99,102,241,0.5) !important; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .fadein { animation:fadeUp 0.22s ease; }
        ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-track { background:transparent; } ::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:4px; }
      `}</style>

      {/* Sidebar */}
      <ScenarioSidebar
        scenarios={scenarios}
        loading={scenariosLoading}
        onLoad={handleLoadScenario}
        onDelete={handleDeleteScenario}
        onSave={handleSaveScenario}
        hs={hs}
      />

      {/* HubSpot page */}
      {view === "hubspot" && <HubSpotPage hs={hs} />}

      {/* Main content */}
      <div ref={pageRef} style={{ flex:1, padding:"32px 20px 80px", display: view === "hubspot" ? "none" : "flex", flexDirection:"column", alignItems:"center", minWidth:0 }}>

        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:"0.15em", color:"rgba(255,255,255,0.2)", textTransform:"uppercase", marginBottom:8 }}>Working Backwards · New Logo ARR</div>
          <h1 style={{ fontSize:22, fontWeight:600, letterSpacing:"-0.5px", color:"#fff", marginBottom:14 }}>Revenue Input Flow</h1>
          <div style={{ display:"inline-flex", gap:3, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, padding:3 }}>
            <button className={`tab ${mode==="explore"?"on":""}`} onClick={()=>setMode("explore")}>Explore</button>
            <button className={`tab ${mode==="calculator"?"on":""}`} onClick={()=>setMode("calculator")}>Calculator</button>
          </div>
          <button onClick={handleDownload} style={{ marginTop:12, display:"inline-flex", alignItems:"center", gap:6, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"6px 14px", color:"rgba(255,255,255,0.55)", fontSize:12, fontFamily:"'DM Mono',monospace", cursor:"pointer", transition:"all 0.15s" }}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,0.1)";e.currentTarget.style.color="#fff";}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,0.06)";e.currentTarget.style.color="rgba(255,255,255,0.55)";}}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v7M3 5.5l3 3 3-3M1 10h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Download PNG
          </button>
        </div>

        {/* Channel labels */}
        <div style={{ display:"flex", gap:20, width:"100%", maxWidth:960, marginBottom:4, justifyContent:"center", flexWrap:"wrap" }}>
          <div style={{ flex:1, minWidth:180, maxWidth:280 }}><ChannelPill color="#8b5cf6" label="OUTBOUND" /></div>
          <div style={{ flex:1, minWidth:180, maxWidth:280 }}><ChannelPill color="#f59e0b" label="IN-PERSON" /></div>
          <div style={{ flex:1, minWidth:180, maxWidth:280 }}><ChannelPill color="#10b981" label="PODCAST" /></div>
        </div>

        {/* Legend */}
        <div style={{ display:"flex", gap:10, marginBottom:12, alignItems:"center" }}>
          <span style={{ fontSize:9, color:"rgba(255,255,255,0.2)", fontFamily:"'DM Mono',monospace", letterSpacing:"0.08em", textTransform:"uppercase", marginRight:2 }}>Click a node to label it:</span>
          {Object.entries(NODE_TYPE_CONFIG).map(([, cfg]) => (
            <div key={cfg.label} style={{ display:"inline-flex", alignItems:"center", gap:4, background:cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:20, padding:"2px 9px" }}>
              <span style={{ fontSize:9, fontWeight:600, color:cfg.color, fontFamily:"'DM Mono',monospace", letterSpacing:"0.06em" }}>{cfg.label}</span>
            </div>
          ))}
        </div>

        {/* Three funnels */}
        <div style={{ display:"flex", gap:20, width:"100%", maxWidth:960, justifyContent:"center", flexWrap:"wrap" }}>
          <FunnelColumn nodes={outboundNodes} computed={cob} mode={mode} outputColor="#8b5cf6" outputLabel="Outbound ARR" outputValue={obArr} nodeTypes={nodeTypes} onToggleType={handleToggleType} />
          <FunnelColumn nodes={inPersonNodes} computed={cip} mode={mode} outputColor="#f59e0b" outputLabel="In-Person ARR" outputValue={ipArr} nodeTypes={nodeTypes} onToggleType={handleToggleType} />
          <FunnelColumn nodes={podcastNodes}  computed={cpd} mode={mode} outputColor="#10b981" outputLabel="Podcast ARR"   outputValue={pdArr} nodeTypes={nodeTypes} onToggleType={handleToggleType} />
        </div>

        {/* Convergence + Combined */}
        <div style={{ width:"100%", maxWidth:960, display:"flex", flexDirection:"column", alignItems:"center" }}>
          <div style={{ width:"70%", maxWidth:600, position:"relative", height:36 }}>
            <svg width="100%" height="36" viewBox="0 0 600 36" preserveAspectRatio="none">
              <path d="M100 0 Q100 36 300 36" stroke="rgba(255,255,255,0.09)" strokeWidth="1.5" fill="none"/>
              <path d="M300 0 Q300 36 300 36" stroke="rgba(255,255,255,0.09)" strokeWidth="1.5" fill="none"/>
              <path d="M500 0 Q500 36 300 36" stroke="rgba(255,255,255,0.09)" strokeWidth="1.5" fill="none"/>
            </svg>
          </div>

          {/* Combined box */}
          <div className="fadein" style={{ width:"100%", maxWidth:560, borderRadius:18, background:"linear-gradient(135deg,rgba(139,92,246,0.08),rgba(16,185,129,0.06))", border:"1px solid rgba(255,255,255,0.09)", padding:"24px 28px", textAlign:"center", position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse at 20% 50%,rgba(139,92,246,0.07) 0%,transparent 55%), radial-gradient(ellipse at 80% 50%,rgba(16,185,129,0.07) 0%,transparent 55%)", pointerEvents:"none" }} />

            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:"0.14em", textTransform:"uppercase", color:"rgba(255,255,255,0.25)", marginBottom:8 }}>
              Total New Logo ARR
            </div>

            <div style={{ fontSize: mode==="calculator" ? 48 : 28, fontWeight:700, letterSpacing:"-2px", fontFamily:"'DM Mono',monospace", background:"linear-gradient(90deg,#c4b5fd,#6ee7b7)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text", lineHeight:1.1, marginBottom:12 }}>
              {mode === "calculator" ? formatCurrency(total) : "—"}
            </div>

            {/* Channel breakdown */}
            {mode === "calculator" && (
              <div style={{ display:"flex", justifyContent:"center", gap:0, marginTop:4 }}>
                {channels.map((ch, i) => (
                  <div key={ch.label} style={{ display:"flex", alignItems:"stretch" }}>
                    {i>0 && <div style={{ width:1, background:"rgba(255,255,255,0.1)", margin:"0 16px" }} />}
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:10, color:`${ch.color}99`, fontFamily:"'DM Mono',monospace", marginBottom:3, letterSpacing:"0.07em" }}>{ch.label}</div>
                      <div style={{ fontSize:14, fontWeight:700, color:ch.color, fontFamily:"'DM Mono',monospace" }}>{formatCurrency(ch.arr)}</div>
                      <div style={{ fontSize:10, color:"rgba(255,255,255,0.2)", fontFamily:"'DM Mono',monospace", marginTop:2 }}>{ch.pct}%</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Mix bar */}
            {mode === "calculator" && total > 0 && (
              <div style={{ marginTop:16, borderRadius:4, overflow:"hidden", height:4, display:"flex", width:"100%" }}>
                {channels.map(ch => (
                  <div key={ch.label} style={{ flex:ch.arr, background:ch.color, transition:"flex 0.3s ease" }} />
                ))}
              </div>
            )}

            {/* HubSpot: Closed YTD vs Projected */}
            {mode === "calculator" && hsDeals.length > 0 && (
              <div style={{ marginTop:18, paddingTop:14, borderTop:"1px solid rgba(255,255,255,0.07)", display:"flex", justifyContent:"center", gap:0 }}>
                {[
                  { label:"PROJECTED",  value:total,                          color:"#c4b5fd" },
                  { label:"CLOSED YTD", value:closedArr,                      color:"#6ee7b7" },
                  { label:"REMAINING",  value:Math.max(0, total - closedArr), color:"rgba(255,255,255,0.35)" },
                ].map((item, i) => (
                  <div key={item.label} style={{ display:"flex", alignItems:"stretch" }}>
                    {i > 0 && <div style={{ width:1, background:"rgba(255,255,255,0.08)", margin:"0 14px" }} />}
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:9, color:"rgba(255,255,255,0.25)", fontFamily:"'DM Mono',monospace", marginBottom:3, letterSpacing:"0.07em" }}>{item.label}</div>
                      <div style={{ fontSize:13, fontWeight:700, color:item.color, fontFamily:"'DM Mono',monospace" }}>{formatCurrency(item.value)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {mode === "explore" && (
              <p style={{ fontSize:13, color:"rgba(255,255,255,0.28)", lineHeight:1.65 }}>
                Three channels converge into one output. Switch to <span style={{ color:"rgba(255,255,255,0.5)" }}>Calculator mode</span> to see your total ARR and channel mix.
              </p>
            )}
          </div>
        </div>

        {/* Calculator sliders */}
        {mode === "calculator" && (
          <div className="fadein" style={{ display:"flex", gap:20, width:"100%", maxWidth:960, marginTop:28, flexWrap:"wrap" }}>
            <SlidersPanel title="Outbound Inputs"  color="#8b5cf6" sections={outboundSliders} values={ob} onChange={handleOb} />
            <SlidersPanel title="In-Person Inputs" color="#f59e0b" sections={inPersonSliders}  values={ip} onChange={handleIp} />
            <SlidersPanel title="Podcast Inputs"   color="#10b981" sections={podcastSliders}   values={pd} onChange={handlePd} />
          </div>
        )}

        {/* Explore legend */}
        {mode === "explore" && (
          <div className="fadein" style={{ marginTop:28, maxWidth:560, textAlign:"center" }}>
            <p style={{ fontSize:13, color:"rgba(255,255,255,0.27)", lineHeight:1.8 }}>
              <span style={{ color:"rgba(139,92,246,0.8)" }}>Outbound</span> scales with headcount and is your highest-volume channel.{" "}
              <span style={{ color:"rgba(245,158,11,0.8)" }}>In-person</span> tends to close at higher ACV but top-of-funnel is constrained by time.{" "}
              <span style={{ color:"rgba(16,185,129,0.8)" }}>Podcast</span> is a slow-burn channel — guests convert at high rates but volume is limited by recording cadence. Together they give you a resilient, diversified revenue model.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
