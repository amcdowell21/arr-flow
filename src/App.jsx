import { useState, useCallback, useRef, useEffect } from "react";
import html2canvas from "html2canvas";
import { db, auth } from "./firebase";
import {
  collection, addDoc, onSnapshot, deleteDoc, doc, serverTimestamp, query, orderBy,
  getDoc, setDoc,
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { fetchAllDeals, fetchPipelines, closedArrForYear, updateDealStage } from "./hubspot";
import PipelinePage from "./PipelinePage";
import LoginPage from "./LoginPage";
import AdminPanel from "./AdminPanel";

const ADMIN_EMAIL = "admin@uniqlearn.co";

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

// ─── App Sidebar ──────────────────────────────────────────────────────────────
function AppSidebar({ view, onNavigate, scenarios, loading, onLoad, onDelete, onSave, hs, currentUser, isAdmin }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showHsInput, setShowHsInput] = useState(false);
  const [scenariosOpen, setScenariosOpen] = useState(view === "main");

  const isConnected = hs.deals.length > 0;

  useEffect(() => {
    if (view === "main") setScenariosOpen(true);
  }, [view]);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    await onSave(name.trim());
    setName("");
    setSaving(false);
  }

  const navItems = [
    {
      id: "pipeline",
      label: "Pipeline Tracker",
      color: "#6366f1",
      icon: (active) => (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="8" width="3" height="5" rx="0.6" fill={active ? "#a5b4fc" : "rgba(255,255,255,0.3)"}/>
          <rect x="5.5" y="5" width="3" height="8" rx="0.6" fill={active ? "#a5b4fc" : "rgba(255,255,255,0.3)"}/>
          <rect x="10" y="1" width="3" height="12" rx="0.6" fill={active ? "#a5b4fc" : "rgba(255,255,255,0.3)"}/>
        </svg>
      ),
    },
    {
      id: "main",
      label: "Input Metrics",
      color: "#8b5cf6",
      hasDropdown: true,
      icon: (active) => (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 4h10M2 7h7M2 10h4" stroke={active ? "#c4b5fd" : "rgba(255,255,255,0.3)"} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: "hubspot",
      label: "HubSpot View",
      color: "#10b981",
      icon: (active) => (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="5.5" stroke={active ? "#6ee7b7" : "rgba(255,255,255,0.3)"} strokeWidth="1.4"/>
          <circle cx="7" cy="7" r="2" fill={active ? "#6ee7b7" : "rgba(255,255,255,0.3)"}/>
        </svg>
      ),
    },
  ];

  const allNavItems = isAdmin ? [...navItems, {
    id: "admin",
    label: "Admin Panel",
    color: "#f59e0b",
    icon: (active) => (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="5" r="2.3" stroke={active ? "#fcd34d" : "rgba(255,255,255,0.3)"} strokeWidth="1.4"/>
        <path d="M2.5 12c0-2.49 2.01-4.5 4.5-4.5s4.5 2.01 4.5 4.5" stroke={active ? "#fcd34d" : "rgba(255,255,255,0.3)"} strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  }] : navItems;

  return (
    <div style={{
      width: 220, flexShrink: 0, borderRight: "1px solid rgba(255,255,255,0.07)",
      background: "rgba(255,255,255,0.015)", display: "flex", flexDirection: "column",
      height: "100vh", position: "sticky", top: 0,
    }}>
      {/* App header / home link */}
      <button
        onClick={() => onNavigate("home")}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "18px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.07)",
          cursor: "pointer", width: "100%", textAlign: "left",
        }}
      >
        <img src="/arr-flow-logo.png" alt="ARR Flow" style={{ width: 32, height: 32, objectFit: "contain", flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", lineHeight: 1.2 }}>ARR Flow</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em" }}>Revenue Intelligence</div>
        </div>
      </button>

      {/* Nav items */}
      <div style={{ padding: "10px 8px", flex: 1, overflowY: "auto" }}>
        <div style={{ fontSize: 9, fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.18)", padding: "6px 8px 8px" }}>
          Workspace
        </div>
        {allNavItems.map(item => {
          const active = view === item.id;
          return (
            <div key={item.id}>
              <button
                onClick={() => {
                  onNavigate(item.id);
                  if (item.hasDropdown) setScenariosOpen(s => view === item.id ? !s : true);
                }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 9,
                  background: active ? `${item.color}18` : "transparent",
                  border: `1px solid ${active ? `${item.color}35` : "transparent"}`,
                  borderRadius: 8, padding: "9px 10px", cursor: "pointer", transition: "all 0.15s",
                  marginBottom: 2,
                }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}}
              >
                {item.icon(active)}
                <span style={{ fontSize: 12, fontWeight: 500, color: active ? "#fff" : "rgba(255,255,255,0.45)", flex: 1, textAlign: "left" }}>
                  {item.label}
                </span>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, opacity: 0.3, transition: "transform 0.2s", transform: (item.hasDropdown && active && scenariosOpen) ? "rotate(90deg)" : "none" }}>
                  <path d="M3 1.5L7 5 3 8.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* Scenarios dropdown under Input Metrics */}
              {item.hasDropdown && active && scenariosOpen && (
                <div style={{ marginLeft: 8, marginBottom: 6, paddingLeft: 10, borderLeft: "1px solid rgba(255,255,255,0.07)" }}>
                  {/* Save input */}
                  <div style={{ padding: "8px 4px 6px", display: "flex", gap: 5 }}>
                    <input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSave()}
                      placeholder="Save scenario…"
                      style={{
                        flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 6, padding: "5px 8px", fontSize: 10, color: "#fff", outline: "none",
                        fontFamily: "'DM Sans',sans-serif",
                      }}
                    />
                    <button
                      onClick={handleSave}
                      disabled={!name.trim() || saving}
                      style={{
                        background: name.trim() ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${name.trim() ? "rgba(99,102,241,0.45)" : "rgba(255,255,255,0.07)"}`,
                        borderRadius: 6, padding: "5px 8px", cursor: name.trim() ? "pointer" : "default",
                        color: name.trim() ? "#a5b4fc" : "rgba(255,255,255,0.18)", fontSize: 10, fontWeight: 600,
                        fontFamily: "'DM Mono',monospace", transition: "all 0.15s", flexShrink: 0,
                      }}
                    >{saving ? "…" : "Save"}</button>
                  </div>

                  {/* Scenario list */}
                  {loading && (
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontFamily: "'DM Mono',monospace", padding: "6px 4px" }}>Loading…</div>
                  )}
                  {!loading && scenarios.length === 0 && (
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.18)", fontFamily: "'DM Mono',monospace", padding: "6px 4px", lineHeight: 1.5 }}>No scenarios yet.</div>
                  )}
                  {scenarios.map(s => (
                    <div key={s.id} style={{ borderRadius: 7, padding: "7px 8px", marginBottom: 3, background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)", position: "relative" }}>
                      <div onClick={() => onLoad(s)} style={{ cursor: "pointer", paddingRight: 18 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.8)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, color: "#6ee7b7" }}>
                          {formatCurrency((s.ob && s.ip && s.pd)
                            ? (computeOutbound(s.ob).weeklyArr + computeInPerson(s.ip).weeklyArr + computePodcast(s.pd).weeklyArr) * 52
                            : 0
                          )} ARR
                        </div>
                      </div>
                      {confirmDelete === s.id ? (
                        <div style={{ display: "flex", gap: 3, marginTop: 5 }}>
                          <button onClick={() => { onDelete(s.id); setConfirmDelete(null); }}
                            style={{ flex: 1, background: "rgba(239,68,68,0.18)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: 4, padding: "2px 0", fontSize: 9, color: "#fca5a5", cursor: "pointer", fontFamily: "'DM Mono',monospace" }}>
                            Delete
                          </button>
                          <button onClick={() => setConfirmDelete(null)}
                            style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 4, padding: "2px 0", fontSize: 9, color: "rgba(255,255,255,0.35)", cursor: "pointer", fontFamily: "'DM Mono',monospace" }}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); setConfirmDelete(s.id); }}
                          style={{ position: "absolute", top: 6, right: 6, background: "transparent", border: "none", padding: 2, cursor: "pointer", color: "rgba(255,255,255,0.15)", lineHeight: 1 }}
                        >
                          <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* HubSpot token at bottom */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "12px" }}>
        {isConnected && !showHsInput ? (
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 2px" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399", boxShadow: "0 0 5px rgba(52,211,153,0.6)", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#6ee7b7", fontFamily: "'DM Mono',monospace" }}>HubSpot Connected</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: "'DM Mono',monospace" }}>
                {hs.syncing ? "Syncing…" : `${hs.deals.length} deals`}
              </div>
            </div>
            <button onClick={() => setShowHsInput(true)} title="Change token"
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.2)", padding: 2, lineHeight: 1 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.5 2.5l.7.7M8.8 8.8l.7.7M2.5 9.5l.7-.7M8.8 3.2l.7-.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.2)" }}>HubSpot Token</span>
              {isConnected && (
                <button onClick={() => setShowHsInput(false)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", padding: 2, lineHeight: 1 }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 5 }}>
              <input
                type="password"
                value={hs.token}
                onChange={e => hs.onTokenChange(e.target.value)}
                onKeyDown={e => e.key === "Enter" && hs.onSync()}
                placeholder="pat-na1-…"
                style={{
                  flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)",
                  borderRadius: 6, padding: "5px 8px", fontSize: 10, color: "#fff", outline: "none",
                  fontFamily: "'DM Mono',monospace",
                }}
              />
              <button
                onClick={hs.onSync}
                disabled={!hs.token.trim() || hs.syncing}
                style={{
                  background: hs.token.trim() ? "rgba(52,211,153,0.16)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${hs.token.trim() ? "rgba(52,211,153,0.38)" : "rgba(255,255,255,0.07)"}`,
                  borderRadius: 6, padding: "5px 9px",
                  cursor: hs.token.trim() && !hs.syncing ? "pointer" : "default",
                  color: hs.token.trim() ? "#6ee7b7" : "rgba(255,255,255,0.18)",
                  fontSize: 10, fontWeight: 600, fontFamily: "'DM Mono',monospace", transition: "all 0.15s", flexShrink: 0,
                }}
              >{hs.syncing ? "…" : "Sync"}</button>
            </div>
            {hs.error && <div style={{ fontSize: 9, color: "#f87171", fontFamily: "'DM Mono',monospace", marginTop: 4, lineHeight: 1.4 }}>{hs.error}</div>}
          </>
        )}
      </div>

      {/* User info + sign out */}
      {currentUser && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "'DM Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {currentUser.email}
            </div>
          </div>
          <button
            onClick={() => signOut(auth)}
            title="Sign out"
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.2)", padding: 4, lineHeight: 1, flexShrink: 0, borderRadius: 4, transition: "color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.color = "rgba(255,255,255,0.5)"}
            onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,0.2)"}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M8 4l3 3-3 3M11 7H5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5 2H2a1 1 0 00-1 1v6a1 1 0 001 1h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Home Page ────────────────────────────────────────────────────────────────
function HomePage({ onNavigate }) {
  const tiles = [
    {
      id: "pipeline",
      title: "Pipeline Tracker",
      desc: "Manage deals, assign buckets, and project close months with confidence scoring.",
      color: "#6366f1",
      icon: (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <rect x="2" y="18" width="7" height="12" rx="1.5" fill="#6366f1" opacity="0.7"/>
          <rect x="12.5" y="11" width="7" height="19" rx="1.5" fill="#6366f1"/>
          <rect x="23" y="2" width="7" height="28" rx="1.5" fill="#6366f1" opacity="0.5"/>
        </svg>
      ),
    },
    {
      id: "main",
      title: "Input Metrics",
      desc: "Model revenue funnel inputs across Outbound, In-Person, and Podcast channels.",
      color: "#8b5cf6",
      icon: (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M4 9h24M4 16h17M4 23h10" stroke="#8b5cf6" strokeWidth="2.8" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: "hubspot",
      title: "HubSpot View",
      desc: "Browse and sync your CRM deal pipeline, stages, and closed ARR year-to-date.",
      color: "#10b981",
      icon: (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="12.5" stroke="#10b981" strokeWidth="2.2"/>
          <circle cx="16" cy="16" r="5" fill="#10b981" opacity="0.75"/>
        </svg>
      ),
    },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 32px", minWidth: 0 }}>
      <div style={{ textAlign: "center", marginBottom: 52 }}>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: "0.15em", color: "rgba(255,255,255,0.18)", textTransform: "uppercase", marginBottom: 12 }}>
          Working Backwards · New Logo ARR
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.5px", color: "#fff", marginBottom: 10 }}>Revenue Intelligence</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.28)", maxWidth: 380, lineHeight: 1.65, margin: "0 auto" }}>
          Choose a workspace to get started.
        </p>
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center", maxWidth: 860 }}>
        {tiles.map(tile => (
          <button
            key={tile.id}
            onClick={() => onNavigate(tile.id)}
            style={{
              width: 250, textAlign: "left", background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 16, padding: "28px 24px", cursor: "pointer", transition: "all 0.18s",
              position: "relative", overflow: "hidden",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = `${tile.color}12`;
              e.currentTarget.style.borderColor = `${tile.color}40`;
              e.currentTarget.style.transform = "translateY(-3px)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(255,255,255,0.025)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, borderRadius: "16px 16px 0 0", background: tile.color, opacity: 0.55 }} />
            <div style={{ marginBottom: 18 }}>{tile.icon}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", marginBottom: 8 }}>{tile.title}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.32)", lineHeight: 1.65 }}>{tile.desc}</div>
            <div style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 11, color: tile.color, fontFamily: "'DM Mono',monospace", fontWeight: 500 }}>Open</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5h6M5.5 2L9 5l-3.5 3" stroke={tile.color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Kanban Board ─────────────────────────────────────────────────────────────
function KanbanBoard({ deals, pipeline, onUpdateDealStage }) {
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);
  const [collapsed, setCollapsed] = useState(new Set());

  const toggleCollapse = (stageId) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(stageId) ? next.delete(stageId) : next.add(stageId);
      return next;
    });
  };

  const sortedStages = (pipeline?.stages ?? []).slice().sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

  const handleDragStart = (e, dealId) => {
    setDraggingId(dealId);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e, stageId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStage(stageId);
  };
  const handleDrop = (e, stageId) => {
    e.preventDefault();
    if (draggingId) {
      const deal = deals.find(d => d.id === draggingId);
      if (deal && deal.properties?.dealstage !== stageId) {
        onUpdateDealStage(draggingId, stageId);
      }
    }
    setDraggingId(null);
    setDragOverStage(null);
  };
  const handleDragEnd = () => { setDraggingId(null); setDragOverStage(null); };

  const pipelineDeals = deals.filter(d => d.properties?.pipeline === pipeline?.id);

  return (
    <div style={{ display:"flex", gap:10, overflowX:"auto", paddingBottom:20, alignItems:"flex-start" }}>
      {sortedStages.map(stage => {
        const stageDeals = pipelineDeals.filter(d => d.properties?.dealstage === stage.id);
        const stageValue = stageDeals.reduce((sum, d) => sum + (parseFloat(d.properties?.amount) || 0), 0);
        const isOver = dragOverStage === stage.id;
        const isCollapsed = collapsed.has(stage.id);
        const isClosedWon  = stage.metadata?.probability === "1.0";
        const isClosedLost = stage.metadata?.probability === "0.0";
        const dotColor = isClosedWon ? "#34d399" : isClosedLost ? "#f87171" : "#818cf8";
        const valColor  = isClosedWon ? "#6ee7b7" : "#c4b5fd";

        if (isCollapsed) {
          return (
            <div
              key={stage.id}
              onDragOver={(e) => handleDragOver(e, stage.id)}
              onDragLeave={() => setDragOverStage(null)}
              onDrop={(e) => handleDrop(e, stage.id)}
              style={{
                flexShrink: 0, width: 36,
                background: isOver ? "rgba(99,102,241,0.07)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${isOver ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.07)"}`,
                borderRadius: 12, overflow: "hidden",
                display: "flex", flexDirection: "column", alignItems: "center",
                transition: "border 0.12s, background 0.12s",
              }}
            >
              {/* Expand arrow */}
              <button
                onClick={() => toggleCollapse(stage.id)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: "10px 0 6px", color: "rgba(255,255,255,0.35)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: "100%", transition: "color 0.15s",
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M3 1.5L7 5 3 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {/* Rotated label */}
              <div style={{
                writingMode: "vertical-rl", transform: "rotate(180deg)",
                fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.4)",
                fontFamily: "'DM Sans',sans-serif", letterSpacing: "0.03em",
                padding: "8px 0", whiteSpace: "nowrap", overflow: "hidden",
                maxHeight: 160, textOverflow: "ellipsis",
              }}>
                {stage.label}
              </div>
              {/* Deal count dot */}
              {stageDeals.length > 0 && (
                <div style={{
                  margin: "6px 0 10px",
                  width: 18, height: 18, borderRadius: "50%",
                  background: dotColor, opacity: 0.7,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, fontWeight: 700, color: "#09090e", fontFamily: "'DM Mono',monospace",
                }}>
                  {stageDeals.length}
                </div>
              )}
            </div>
          );
        }

        return (
          <div
            key={stage.id}
            onDragOver={(e) => handleDragOver(e, stage.id)}
            onDragLeave={() => setDragOverStage(null)}
            onDrop={(e) => handleDrop(e, stage.id)}
            style={{
              flexShrink: 0, width: 230,
              background: isOver ? "rgba(99,102,241,0.07)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${isOver ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.07)"}`,
              borderRadius: 12, overflow: "hidden",
              transition: "border 0.12s, background 0.12s",
            }}
          >
            {/* Column header */}
            <div style={{ padding:"11px 13px 9px", borderBottom:"1px solid rgba(255,255,255,0.06)", background:"rgba(255,255,255,0.025)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:3 }}>
                <div style={{ width:7, height:7, borderRadius:2, background:dotColor, flexShrink:0 }} />
                <span style={{ fontSize:11, fontWeight:600, color:"rgba(255,255,255,0.8)", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {stage.label}
                </span>
                <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", fontFamily:"'DM Mono',monospace" }}>
                  {stageDeals.length}
                </span>
                {/* Collapse arrow */}
                <button
                  onClick={() => toggleCollapse(stage.id)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: "2px 2px 2px 4px", color: "rgba(255,255,255,0.25)",
                    display: "flex", alignItems: "center", transition: "color 0.15s",
                    flexShrink: 0,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M7 1.5L3 5 7 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
              {stageValue > 0 && (
                <div style={{ fontSize:10, color:valColor, fontFamily:"'DM Mono',monospace", paddingLeft:14 }}>
                  {formatCurrency(stageValue)}
                </div>
              )}
            </div>

            {/* Cards */}
            <div style={{ padding:8, display:"flex", flexDirection:"column", gap:6, minHeight:80 }}>
              {stageDeals.map(deal => {
                const amount = parseFloat(deal.properties?.amount) || 0;
                const isDragging = draggingId === deal.id;
                const closeDate = deal.properties?.closedate
                  ? new Date(deal.properties.closedate).toLocaleDateString("en-US", { month:"short", year:"numeric" })
                  : null;
                return (
                  <div
                    key={deal.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, deal.id)}
                    onDragEnd={handleDragEnd}
                    style={{
                      background: isDragging ? "rgba(99,102,241,0.18)" : "rgba(255,255,255,0.045)",
                      border: `1px solid ${isDragging ? "rgba(99,102,241,0.45)" : "rgba(255,255,255,0.08)"}`,
                      borderRadius: 8, padding: "9px 11px",
                      cursor: "grab", opacity: isDragging ? 0.5 : 1,
                      transition: "opacity 0.1s, border 0.1s",
                    }}
                  >
                    <div style={{ fontSize:12, color:"rgba(255,255,255,0.78)", lineHeight:1.35, marginBottom: (amount > 0 || closeDate) ? 5 : 0 }}>
                      {deal.properties?.dealname || "Untitled deal"}
                    </div>
                    {amount > 0 && (
                      <div style={{ fontSize:11, fontWeight:600, color: isClosedWon ? "#6ee7b7" : "#a5f3fc", fontFamily:"'DM Mono',monospace" }}>
                        {formatCurrency(amount)}
                      </div>
                    )}
                    {closeDate && (
                      <div style={{ fontSize:9, color:"rgba(255,255,255,0.25)", fontFamily:"'DM Mono',monospace", marginTop:3 }}>
                        Close {closeDate}
                      </div>
                    )}
                  </div>
                );
              })}
              {stageDeals.length === 0 && (
                <div style={{ textAlign:"center", padding:"16px 0", fontSize:10, color: isOver ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.12)", fontFamily:"'DM Mono',monospace", transition:"color 0.12s" }}>
                  {isOver ? "Drop here" : "No deals"}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── HubSpot Page ─────────────────────────────────────────────────────────────
function HubSpotPage({ hs }) {
  const { deals, pipelines, syncing, error, lastSync, closedArr } = hs;
  const [activePipelineId, setActivePipelineId] = useState(null);
  const [expandedStageId, setExpandedStageId] = useState(null);
  const [boardView, setBoardView] = useState(false);

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
          {/* List / Board toggle */}
          {deals.length > 0 && (
            <div style={{ display:"flex", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, padding:2, gap:2 }}>
              {[{ label:"List", value:false }, { label:"Board", value:true }].map(opt => (
                <button
                  key={opt.label}
                  onClick={() => setBoardView(opt.value)}
                  style={{
                    padding:"5px 11px", borderRadius:6, fontSize:11, fontWeight:600,
                    fontFamily:"'DM Mono',monospace", cursor:"pointer", transition:"all 0.15s",
                    background: boardView === opt.value ? "rgba(255,255,255,0.1)" : "transparent",
                    border: "none",
                    color: boardView === opt.value ? "#f1f5f9" : "rgba(255,255,255,0.35)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
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

      {/* Pipeline tabs + stage view */}
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

          {/* Board view */}
          {pipeline && boardView && (
            <KanbanBoard
              deals={deals}
              pipeline={pipeline}
              onUpdateDealStage={hs.onUpdateDealStage}
            />
          )}

          {/* List view */}
          {pipeline && !boardView && (
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

// ─── Login Animation ─────────────────────────────────────────────────────────
function LoginAnimation({ onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "#09090e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif" }}>
      <style>{`
        @keyframes laOverlay { 0%{opacity:0} 8%{opacity:1} 80%{opacity:1} 100%{opacity:0} }
        @keyframes laBrain {
          0%   { transform: translateY(-90px) rotate(0deg) scale(1.1); opacity: 0; }
          6%   { opacity: 1; }
          50%  { transform: translateY(72px) rotate(660deg) scale(0.42); opacity: 1; }
          62%  { transform: translateY(118px) rotate(840deg) scale(0.06); opacity: 0.4; }
          66%, 100% { transform: translateY(125px) rotate(900deg) scale(0); opacity: 0; }
        }
        @keyframes laFunnelGlow { 0%,100%{opacity:0.5} 50%{opacity:0.9} }
        @keyframes laMoney1 {
          0%,58%{transform:translate(0,0) scale(0) rotate(0deg);opacity:0}
          63%{transform:translate(-10px,-8px) scale(1.3) rotate(-10deg);opacity:1}
          100%{transform:translate(-100px,90px) scale(0.9) rotate(-25deg);opacity:0}
        }
        @keyframes laMoney2 {
          0%,61%{transform:translate(0,0) scale(0) rotate(0deg);opacity:0}
          66%{transform:translate(8px,-6px) scale(1.3) rotate(12deg);opacity:1}
          100%{transform:translate(95px,80px) scale(0.9) rotate(28deg);opacity:0}
        }
        @keyframes laMoney3 {
          0%,64%{transform:translate(0,0) scale(0) rotate(0deg);opacity:0}
          69%{transform:translate(-3px,-10px) scale(1.5) rotate(-4deg);opacity:1}
          100%{transform:translate(-15px,120px) scale(1.05) rotate(6deg);opacity:0}
        }
        @keyframes laMoney4 {
          0%,62%{transform:translate(0,0) scale(0) rotate(0deg);opacity:0}
          67%{transform:translate(-18px,-5px) scale(1.2) rotate(-20deg);opacity:1}
          100%{transform:translate(-135px,65px) scale(0.85) rotate(-42deg);opacity:0}
        }
        @keyframes laMoney5 {
          0%,65%{transform:translate(0,0) scale(0) rotate(0deg);opacity:0}
          70%{transform:translate(14px,-4px) scale(1.2) rotate(18deg);opacity:1}
          100%{transform:translate(125px,60px) scale(0.85) rotate(38deg);opacity:0}
        }
        @keyframes laWelcome {
          0%,68%{opacity:0;transform:translateY(10px)}
          82%{opacity:1;transform:translateY(0)}
          90%{opacity:1}
          100%{opacity:0}
        }
      `}</style>

      {/* Full-screen fade overlay */}
      <div style={{ animation: "laOverlay 2.8s ease-in-out forwards", position: "absolute", inset: 0 }} />

      {/* Funnel + brain + money */}
      <div style={{ position: "relative", width: 200, height: 220, zIndex: 1 }}>
        {/* Funnel SVG */}
        <svg width="200" height="220" viewBox="0 0 200 220" style={{ position: "absolute", inset: 0, animation: "laFunnelGlow 1.1s ease-in-out infinite" }}>
          <defs>
            <linearGradient id="laFG" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#a855f7" stopOpacity="0.2" />
            </linearGradient>
            <filter id="laGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {/* Wide funnel */}
          <path d="M 15 20 L 185 20 L 130 105 L 70 105 Z" fill="url(#laFG)" stroke="#6366f1" strokeWidth="1.5" filter="url(#laGlow)" strokeLinejoin="round" />
          {/* Narrow spout */}
          <path d="M 70 105 L 78 202 L 122 202 L 130 105 Z" fill="rgba(168,85,247,0.15)" stroke="#a855f7" strokeWidth="1.5" filter="url(#laGlow)" strokeLinejoin="round" />
          {/* Spout exit glow */}
          <line x1="78" y1="202" x2="122" y2="202" stroke="#4ade80" strokeWidth="2.5" opacity="0.7" />
          {/* Top rim glow */}
          <line x1="15" y1="20" x2="185" y2="20" stroke="#6366f1" strokeWidth="1" opacity="0.4" />
        </svg>

        {/* Brain logo spinning into funnel */}
        <img
          src="/arr-flow-logo.png"
          alt=""
          style={{
            position: "absolute",
            top: 0,
            left: "50%",
            marginLeft: -24,
            width: 48,
            height: 48,
            objectFit: "contain",
            animation: "laBrain 2.8s cubic-bezier(0.4,0,0.8,1) forwards",
            zIndex: 10,
            filter: "drop-shadow(0 0 8px rgba(99,102,241,0.7))",
          }}
        />

        {/* Money burst from spout */}
        {[
          { anim: "laMoney1", content: "💵", size: 24 },
          { anim: "laMoney2", content: "💰", size: 22 },
          { anim: "laMoney3", content: "💵", size: 26 },
          { anim: "laMoney4", content: "$",  size: 20, color: "#4ade80", weight: 700 },
          { anim: "laMoney5", content: "💰", size: 21 },
        ].map(({ anim, content, size, color, weight }, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              bottom: 18,
              left: "50%",
              marginLeft: -12,
              fontSize: size,
              fontWeight: weight || 400,
              color: color || undefined,
              animation: `${anim} 2.8s ease-out forwards`,
              zIndex: 11,
              userSelect: "none",
              lineHeight: 1,
            }}
          >
            {content}
          </div>
        ))}
      </div>

      {/* Welcome text */}
      <div style={{
        position: "absolute",
        bottom: "28%",
        fontSize: 19,
        fontWeight: 600,
        color: "#a5f3fc",
        letterSpacing: "-0.3px",
        animation: "laWelcome 2.8s ease-out forwards",
        zIndex: 1,
      }}>
        Welcome to ARR Flow
      </div>
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
  const [view, setView]             = useState("home");
  const [nodeTypes, setNodeTypes] = useState({});
  const pageRef = useRef(null);

  // ─── Auth state ────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [userProfile, setUserProfile] = useState(null);
  const [showLoginAnim, setShowLoginAnim] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setCurrentUser(null);
        setUserProfile(null);
        setAuthLoading(false);
        return;
      }
      setCurrentUser(user);
      try {
        const profileRef = doc(db, "users", user.uid);
        const profileSnap = await getDoc(profileRef);
        if (profileSnap.exists()) {
          setUserProfile(profileSnap.data());
        } else if (user.email === ADMIN_EMAIL) {
          // Auto-create admin profile on first login
          const profile = { email: user.email, role: "admin", active: true, createdAt: serverTimestamp() };
          await setDoc(profileRef, profile);
          setUserProfile(profile);
        } else {
          // Auth account exists but no app profile — revoke access
          await signOut(auth);
          setCurrentUser(null);
          setUserProfile(null);
        }
      } catch {
        setUserProfile(null);
      }
      setAuthLoading(false);
    });
  }, []);

  const isAdmin = userProfile?.role === "admin";

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
    if (!currentUser) return;
    const q = query(collection(db, "scenarios"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, snap => {
      setScenarios(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setScenariosLoading(false);
    });
    return unsub;
  }, [currentUser]);

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

  const handleUpdateDealStage = useCallback(async (dealId, stageId) => {
    setHsDeals(prev => prev.map(d =>
      d.id === dealId ? { ...d, properties: { ...d.properties, dealstage: stageId } } : d
    ));
    try {
      await updateDealStage(hsToken.trim(), dealId, stageId);
    } catch (e) {
      setHsError(`Failed to update deal: ${e.message}`);
      // Re-sync to restore real state
      syncHubspot();
    }
  }, [hsToken, syncHubspot]);

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
    onUpdateDealStage: handleUpdateDealStage,
    onClosePage: () => setView("home"),
  };

  // ─── Auth guards ───────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "#09090e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ color: "#334155", fontSize: "13px" }}>Loading…</div>
      </div>
    );
  }

  if (!currentUser) return (
    <>
      {showLoginAnim && <LoginAnimation onDone={() => setShowLoginAnim(false)} />}
      <LoginPage onLoginSuccess={() => setShowLoginAnim(true)} />
    </>
  );

  if (userProfile && !userProfile.active) {
    return (
      <div style={{ minHeight: "100vh", background: "#09090e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif", padding: "20px" }}>
        <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "12px", padding: "36px", maxWidth: "380px", textAlign: "center" }}>
          <div style={{ fontSize: "20px", fontWeight: "600", color: "#f1f5f9", marginBottom: "8px" }}>Account Deactivated</div>
          <div style={{ color: "#94a3b8", fontSize: "13px", marginBottom: "24px", lineHeight: "1.6" }}>
            Your access has been revoked. Contact <strong style={{ color: "#a5b4fc" }}>admin@uniqlearn.co</strong> for help.
          </div>
          <button
            onClick={() => signOut(auth)}
            style={{ padding: "9px 20px", background: "transparent", border: "1px solid #334155", borderRadius: "8px", color: "#94a3b8", fontSize: "13px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily:"'DM Sans','Helvetica Neue',sans-serif", background:"#09090e", height:"100vh", overflow:"hidden", color:"#f0f0f5", display:"flex", flexDirection:"row" }}>
      {showLoginAnim && <LoginAnimation onDone={() => setShowLoginAnim(false)} />}
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
      <AppSidebar
        view={view}
        onNavigate={setView}
        scenarios={scenarios}
        loading={scenariosLoading}
        onLoad={handleLoadScenario}
        onDelete={handleDeleteScenario}
        onSave={handleSaveScenario}
        hs={hs}
        currentUser={currentUser}
        isAdmin={isAdmin}
      />

      {/* Scrollable content area */}
      <div style={{ flex: 1, overflowY: "auto", height: "100vh", minWidth: 0 }}>

      {/* Home page */}
      {view === "home" && <HomePage onNavigate={setView} />}

      {/* HubSpot page */}
      {view === "hubspot" && <HubSpotPage hs={hs} />}

      {/* Pipeline page */}
      {view === "pipeline" && <PipelinePage hsDeals={hsDeals} hsPipelines={hsPipelines} />}

      {/* Admin panel (admin only) */}
      {view === "admin" && isAdmin && <AdminPanel currentUser={currentUser} onNavigate={setView} />}

      {/* Input Metrics (main) content */}
      <div ref={pageRef} style={{ flex:1, padding:"32px 20px 80px", display: (view !== "main") ? "none" : "flex", flexDirection:"column", alignItems:"center", minWidth:0 }}>

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
      </div> {/* end scrollable content area */}
    </div>
  );
}
