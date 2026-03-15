import { useState, useCallback, useRef, useEffect } from "react";
import { ThemeProvider, useTheme } from "./ThemeContext";
import html2canvas from "html2canvas";
import { db, auth } from "./firebase";
import {
  collection, addDoc, onSnapshot, deleteDoc, doc, serverTimestamp, query, orderBy,
  getDoc, setDoc, where, getDocs, updateDoc,
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { fetchAllDeals, fetchPipelines, closedArrForYear, updateDealStage, fetchDealContacts, fetchDealNotes, fetchDealStageHistory } from "./hubspot";
import PipelinePage from "./PipelinePage";
import LoginPage from "./LoginPage";
import AdminPanel from "./AdminPanel";
import TodosPage from "./TodosPage";

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
        <label style={{ fontSize:11, color:"var(--text-label)", fontFamily:"'DM Mono',monospace" }}>{config.label}</label>
        <span style={{ fontSize:12, color:"var(--text)", fontWeight:600, fontFamily:"'DM Mono',monospace" }}>
          {config.isCurrency ? formatCurrency(value) : `${value}${config.suffix}`}
        </span>
      </div>
      <input type="range" min={config.min} max={config.max} step={config.step} value={value}
        onChange={e=>onChange(config.key, Number(e.target.value))} style={{ width:"100%", cursor:"pointer" }} />
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", marginTop:1 }}>
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
                <div style={{ width:2, height:11, background:"var(--border)" }} />
                <svg width="8" height="5" viewBox="0 0 8 5"><path d="M0 0L4 5L8 0" fill="var(--border)"/></svg>
              </div>
            </div>
          )}
          <div style={{ border:`1px solid ${badge ? badge.border : "var(--border)"}`, borderRadius:9, padding:"11px 13px", background: badge ? badge.bg : "var(--surface)", position:"relative", overflow:"hidden", transition:"border-color 0.2s, background 0.2s" }}>
            <div style={{ position:"absolute", left:0, top:0, bottom:0, width:3, borderRadius:"3px 0 0 3px", background:m.color, opacity:0.65 }} />
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:600, color:"var(--text)", marginBottom:2, lineHeight:1.3 }}>{m.label}</div>
                <div style={{ fontSize:9, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", lineHeight:1.4 }}>{m.sublabel}</div>
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
                  border: `1px ${badge ? "solid" : "dashed"} ${badge ? badge.border : "var(--text-faint)"}`,
                  borderRadius:20, padding:"2px 8px", cursor:"pointer",
                  color: badge ? badge.color : "var(--text-faint)",
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
          <div style={{ width:2, height:11, background:"var(--border)" }} />
          <svg width="8" height="5" viewBox="0 0 8 5"><path d="M0 0L4 5L8 0" fill="var(--border)"/></svg>
        </div>
      </div>
      <div style={{ border:`1px solid ${outputColor}35`, borderRadius:9, padding:"12px 13px", background:`${outputColor}0c`, position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", left:0, top:0, bottom:0, width:4, borderRadius:"3px 0 0 3px", background:outputColor }} />
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:outputColor, marginBottom:2 }}>{outputLabel}</div>
            <div style={{ fontSize:9, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace" }}>Annual · 52 weeks</div>
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
      <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:13, padding:18 }}>
        {sections.map(s => (
          <div key={s.section} style={{ marginBottom:18 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:9 }}>
              <div style={{ width:5, height:5, borderRadius:"50%", background:s.color }} />
              <span style={{ fontSize:10, fontWeight:600, color:"var(--text-label)" }}>{s.section}</span>
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
  const { isDark, toggle } = useTheme();

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
          <rect x="1" y="8" width="3" height="5" rx="0.6" fill={active ? "#a5b4fc" : "var(--text-muted)"}/>
          <rect x="5.5" y="5" width="3" height="8" rx="0.6" fill={active ? "#a5b4fc" : "var(--text-muted)"}/>
          <rect x="10" y="1" width="3" height="12" rx="0.6" fill={active ? "#a5b4fc" : "var(--text-muted)"}/>
        </svg>
      ),
    },
    {
      id: "todos",
      label: "Notes & Todos",
      color: "#f59e0b",
      icon: (active) => (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke={active ? "#fcd34d" : "var(--text-muted)"} strokeWidth="1.3"/>
          <path d="M4 5h6M4 7.5h4M4 10h5" stroke={active ? "#fcd34d" : "var(--text-muted)"} strokeWidth="1.2" strokeLinecap="round"/>
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
          <path d="M2 4h10M2 7h7M2 10h4" stroke={active ? "#c4b5fd" : "var(--text-muted)"} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: "hubspot",
      label: "HubSpot View",
      color: "#10b981",
      icon: (active) => (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="5.5" stroke={active ? "#6ee7b7" : "var(--text-muted)"} strokeWidth="1.4"/>
          <circle cx="7" cy="7" r="2" fill={active ? "#6ee7b7" : "var(--text-muted)"}/>
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
        <circle cx="7" cy="5" r="2.3" stroke={active ? "#fcd34d" : "var(--text-muted)"} strokeWidth="1.4"/>
        <path d="M2.5 12c0-2.49 2.01-4.5 4.5-4.5s4.5 2.01 4.5 4.5" stroke={active ? "#fcd34d" : "var(--text-muted)"} strokeWidth="1.4" strokeLinecap="round"/>
      </svg>
    ),
  }] : navItems;

  return (
    <div style={{
      width: 220, flexShrink: 0, borderRight: "1px solid var(--border)",
      background: "var(--surface-deep)", display: "flex", flexDirection: "column",
      height: "100vh", position: "sticky", top: 0,
    }}>
      {/* App header / home link */}
      <button
        onClick={() => onNavigate("home")}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "18px 16px", borderBottom: "1px solid var(--border)",
          background: "transparent", border: "none", borderBottom: "1px solid var(--border)",
          cursor: "pointer", width: "100%", textAlign: "left",
        }}
      >
        <img src="/arr-flow-logo.png" alt="ARR Flow" style={{ width: 32, height: 32, objectFit: "contain", flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", lineHeight: 1.2 }}>ARR Flow</div>
          <div style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em" }}>Revenue Intelligence</div>
        </div>
      </button>

      {/* Nav items */}
      <div style={{ padding: "10px 8px", flex: 1, overflowY: "auto" }}>
        <div style={{ fontSize: 9, fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-faint)", padding: "6px 8px 8px" }}>
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
                onMouseEnter={e => { if (!active) { e.currentTarget.style.background = "var(--hover-bg)"; e.currentTarget.style.borderColor = "var(--border)"; }}}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}}
              >
                {item.icon(active)}
                <span style={{ fontSize: 12, fontWeight: 500, color: active ? "var(--text)" : "var(--text-label)", flex: 1, textAlign: "left" }}>
                  {item.label}
                </span>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, opacity: 0.4, transition: "transform 0.2s", transform: (item.hasDropdown && active && scenariosOpen) ? "rotate(90deg)" : "none" }}>
                  <path d="M3 1.5L7 5 3 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* Scenarios dropdown under Input Metrics */}
              {item.hasDropdown && active && scenariosOpen && (
                <div style={{ marginLeft: 8, marginBottom: 6, paddingLeft: 10, borderLeft: "1px solid var(--border)" }}>
                  {/* Save input */}
                  <div style={{ padding: "8px 4px 6px", display: "flex", gap: 5 }}>
                    <input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSave()}
                      placeholder="Save scenario…"
                      style={{
                        flex: 1, background: "var(--input-bg)", border: "1px solid var(--input-border)",
                        borderRadius: 6, padding: "5px 8px", fontSize: 10, color: "var(--text)", outline: "none",
                        fontFamily: "'DM Sans',sans-serif",
                      }}
                    />
                    <button
                      onClick={handleSave}
                      disabled={!name.trim() || saving}
                      style={{
                        background: name.trim() ? "rgba(99,102,241,0.2)" : "var(--input-bg)",
                        border: `1px solid ${name.trim() ? "rgba(99,102,241,0.45)" : "var(--border)"}`,
                        borderRadius: 6, padding: "5px 8px", cursor: name.trim() ? "pointer" : "default",
                        color: name.trim() ? "#a5b4fc" : "var(--text-faint)", fontSize: 10, fontWeight: 600,
                        fontFamily: "'DM Mono',monospace", transition: "all 0.15s", flexShrink: 0,
                      }}
                    >{saving ? "…" : "Save"}</button>
                  </div>

                  {/* Scenario list */}
                  {loading && (
                    <div style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "'DM Mono',monospace", padding: "6px 4px" }}>Loading…</div>
                  )}
                  {!loading && scenarios.length === 0 && (
                    <div style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "'DM Mono',monospace", padding: "6px 4px", lineHeight: 1.5 }}>No scenarios yet.</div>
                  )}
                  {scenarios.map(s => (
                    <div key={s.id} style={{ borderRadius: 7, padding: "7px 8px", marginBottom: 3, background: "var(--input-bg)", border: "1px solid var(--border)", position: "relative" }}>
                      <div onClick={() => onLoad(s)} style={{ cursor: "pointer", paddingRight: 18 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-body)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
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
                            style={{ flex: 1, background: "var(--input-bg)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 0", fontSize: 9, color: "var(--text-label)", cursor: "pointer", fontFamily: "'DM Mono',monospace" }}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); setConfirmDelete(s.id); }}
                          style={{ position: "absolute", top: 6, right: 6, background: "transparent", border: "none", padding: 2, cursor: "pointer", color: "var(--text-faint)", lineHeight: 1 }}
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
      <div style={{ borderTop: "1px solid var(--border)", padding: "12px" }}>
        {isConnected && !showHsInput ? (
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 2px" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#34d399", boxShadow: "0 0 5px rgba(52,211,153,0.6)", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#6ee7b7", fontFamily: "'DM Mono',monospace" }}>HubSpot Connected</div>
              <div style={{ fontSize: 9, color: "var(--text-faint)", fontFamily: "'DM Mono',monospace" }}>
                {hs.syncing ? "Syncing…" : `${hs.deals.length} deals`}
              </div>
            </div>
            <button onClick={() => setShowHsInput(true)} title="Change token"
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, lineHeight: 1 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1v1M6 10v1M1 6h1M10 6h1M2.5 2.5l.7.7M8.8 8.8l.7.7M2.5 9.5l.7-.7M8.8 3.2l.7-.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <circle cx="6" cy="6" r="2" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>HubSpot Token</span>
              {isConnected && (
                <button onClick={() => setShowHsInput(false)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, lineHeight: 1 }}>
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
                  flex: 1, background: "var(--input-bg)", border: "1px solid var(--input-border)",
                  borderRadius: 6, padding: "5px 8px", fontSize: 10, color: "var(--text)", outline: "none",
                  fontFamily: "'DM Mono',monospace",
                }}
              />
              <button
                onClick={hs.onSync}
                disabled={!hs.token.trim() || hs.syncing}
                style={{
                  background: hs.token.trim() ? "rgba(52,211,153,0.16)" : "var(--input-bg)",
                  border: `1px solid ${hs.token.trim() ? "rgba(52,211,153,0.38)" : "var(--border)"}`,
                  borderRadius: 6, padding: "5px 9px",
                  cursor: hs.token.trim() && !hs.syncing ? "pointer" : "default",
                  color: hs.token.trim() ? "#6ee7b7" : "var(--text-faint)",
                  fontSize: 10, fontWeight: 600, fontFamily: "'DM Mono',monospace", transition: "all 0.15s", flexShrink: 0,
                }}
              >{hs.syncing ? "…" : "Sync"}</button>
            </div>
            {hs.error && <div style={{ fontSize: 9, color: "#f87171", fontFamily: "'DM Mono',monospace", marginTop: 4, lineHeight: 1.4 }}>{hs.error}</div>}
          </>
        )}
      </div>

      {/* Theme toggle */}
      <div style={{ borderTop: "1px solid var(--border)", padding: "8px 12px" }}>
        <button
          onClick={toggle}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8,
            background: "transparent", border: "1px solid var(--border)",
            borderRadius: 8, padding: "7px 10px", cursor: "pointer", transition: "all 0.15s",
          }}
          onMouseEnter={e => e.currentTarget.style.background = "var(--hover-bg)"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          {isDark ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="2.8" stroke="var(--text-muted)" strokeWidth="1.3"/>
              <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.9 2.9l1.1 1.1M10 10l1.1 1.1M2.9 11.1l1.1-1.1M10 4l1.1-1.1" stroke="var(--text-muted)" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 2a6 6 0 1 0 3 3 4.5 4.5 0 0 1-3-3z" stroke="var(--text-muted)" strokeWidth="1.3" strokeLinejoin="round"/>
            </svg>
          )}
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'DM Mono',monospace" }}>
            {isDark ? "Light mode" : "Dark mode"}
          </span>
        </button>
      </div>

      {/* User info + sign out */}
      {currentUser && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 12px", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "var(--text-label)", fontFamily: "'DM Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {currentUser.email}
            </div>
          </div>
          <button
            onClick={() => signOut(auth)}
            title="Sign out"
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, lineHeight: 1, flexShrink: 0, borderRadius: 4, transition: "color 0.15s" }}
            onMouseEnter={e => e.currentTarget.style.color = "var(--text)"}
            onMouseLeave={e => e.currentTarget.style.color = "var(--text-muted)"}
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
function HomePage({ onNavigate, currentUser }) {
  const [followUps, setFollowUps] = useState({});

  useEffect(() => {
    if (!currentUser) return;
    const ref = doc(db, "userNotes", currentUser.uid);
    const unsub = onSnapshot(ref, snap => {
      if (snap.exists()) setFollowUps(snap.data().followUps || {});
    });
    return unsub;
  }, [currentUser]);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const dueToday = Object.entries(followUps)
    .filter(([, fu]) => fu.date === todayStr && !fu.completed)
    .map(([key, fu]) => ({ key, ...fu }));

  function toggleFollowUpComplete(key) {
    if (!currentUser) return;
    const fu = followUps[key];
    if (!fu) return;
    const next = { ...followUps, [key]: { ...fu, completed: !fu.completed } };
    setFollowUps(next);
    setDoc(doc(db, "userNotes", currentUser.uid), { followUps: next }, { merge: true }).catch(() => {});
  }

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
    {
      id: "todos",
      title: "Notes & Todos",
      desc: "Private notes, meeting action items from Fireflies, and todos linked to deals.",
      color: "#f59e0b",
      icon: (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <rect x="5" y="4" width="22" height="24" rx="3" stroke="#f59e0b" strokeWidth="2.2"/>
          <path d="M10 11h12M10 16h12M10 21h7" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      ),
    },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 32px", minWidth: 0 }}>
      <div style={{ textAlign: "center", marginBottom: 52 }}>
        <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: "0.15em", color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 12 }}>
          Working Backwards · New Logo ARR
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.5px", color: "var(--text)", marginBottom: 10 }}>Revenue Intelligence</h1>
        <p style={{ fontSize: 13, color: "var(--text-faint)", maxWidth: 380, lineHeight: 1.65, margin: "0 auto" }}>
          Choose a workspace to get started.
        </p>
      </div>

      {/* Follow Ups Due Today — above tiles */}
      {dueToday.length > 0 && (
        <div style={{ width: "100%", maxWidth: 520, marginBottom: 32 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase",
            letterSpacing: "0.1em", fontFamily: "'DM Sans',sans-serif", marginBottom: 12,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
            Follow Ups Due Today
            <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: "#f59e0b", fontWeight: 600 }}>
              {dueToday.length}
            </span>
          </div>
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 12, overflow: "hidden",
          }}>
            {dueToday.map((fu, i) => (
              <div
                key={fu.key}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "12px 16px", background: "transparent",
                  borderTop: i > 0 ? "1px solid var(--border)" : "none",
                  transition: "background 0.12s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(99,102,241,0.06)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <button
                  onClick={e => { e.stopPropagation(); toggleFollowUpComplete(fu.key); }}
                  style={{
                    width: 17, height: 17, borderRadius: 4, flexShrink: 0,
                    background: "transparent", border: "1.5px solid #334155",
                    cursor: "pointer", display: "flex", alignItems: "center",
                    justifyContent: "center", transition: "all 0.15s", padding: 0,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#4ade80"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#334155"; }}
                />
                <button
                  onClick={() => onNavigate("todos", { tab: "meetings", dealKey: fu.dealName || fu.dealId })}
                  style={{
                    flex: 1, display: "flex", alignItems: "center", gap: 10,
                    background: "transparent", border: "none",
                    cursor: "pointer", textAlign: "left", padding: 0,
                  }}
                >
                  <span style={{
                    fontSize: 13, color: "#e2e8f0", fontFamily: "'DM Sans',sans-serif",
                    flex: 1, lineHeight: 1.5,
                  }}>
                    {fu.todoText}
                  </span>
                  {fu.dealName && (
                    <span style={{
                      flexShrink: 0, fontSize: 10, fontWeight: 600,
                      background: "rgba(99,102,241,0.15)", color: "#a5b4fc",
                      borderRadius: 4, padding: "3px 8px", fontFamily: "'DM Sans',sans-serif",
                      whiteSpace: "nowrap",
                    }}>
                      {fu.dealName}
                    </span>
                  )}
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
                    <path d="M2 5h6M5.5 2L9 5l-3.5 3" stroke="#475569" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 250px)", gap: 20, justifyContent: "center" }}>
        {tiles.map(tile => (
          <button
            key={tile.id}
            onClick={() => onNavigate(tile.id)}
            style={{
              width: 250, textAlign: "left", background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 16, padding: "28px 24px", cursor: "pointer", transition: "all 0.18s",
              position: "relative", overflow: "hidden",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = `${tile.color}12`;
              e.currentTarget.style.borderColor = `${tile.color}40`;
              e.currentTarget.style.transform = "translateY(-3px)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "var(--surface)";
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, borderRadius: "16px 16px 0 0", background: tile.color, opacity: 0.55 }} />
            <div style={{ marginBottom: 18 }}>{tile.icon}</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>{tile.title}</div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", lineHeight: 1.65 }}>{tile.desc}</div>
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
// ─── Deal Detail Modal ────────────────────────────────────────────────────────
function DealDetailModal({ deal, pipelines, token, onClose }) {
  const [contacts, setContacts] = useState([]);
  const [notes, setNotes]       = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!deal?.id || !token) { setLoading(false); return; }
    setLoading(true);
    setContacts([]);
    setNotes([]);
    Promise.all([
      fetchDealContacts(token, deal.id).catch(() => []),
      fetchDealNotes(token, deal.id).catch(() => []),
    ]).then(([c, n]) => {
      setContacts(c);
      setNotes(n);
      setLoading(false);
    });
  }, [deal?.id, token]);

  if (!deal) return null;
  const p = deal.properties || {};

  const pipeline = pipelines.find(pl => pl.id === p.pipeline);
  const stage    = pipeline?.stages?.find(s => s.id === p.dealstage);
  const prob     = stage?.metadata?.probability != null ? parseFloat(stage.metadata.probability) : null;
  const isWon    = prob === 1.0 || p.dealstage === "closedwon";
  const isLost   = prob === 0.0 || p.dealstage === "closedlost";
  const amount   = parseFloat(p.amount) || 0;

  function fmtDate(d) {
    if (!d) return null;
    return new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  function fmtDateTime(d) {
    if (!d) return null;
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  const rows = [
    { label: "Pipeline",        value: pipeline?.label },
    { label: "Stage",           value: stage?.label },
    { label: "Win Probability", value: prob != null ? `${Math.round(prob * 100)}%` : null },
    { label: "Deal Type",       value: p.dealtype },
    { label: "Close Date",      value: fmtDate(p.closedate) },
    { label: "Created",         value: fmtDate(p.createdate) },
    { label: "Last Modified",   value: fmtDate(p.hs_lastmodifieddate) },
    { label: "Owner ID",        value: p.hubspot_owner_id },
    { label: "Description",     value: p.description, full: true },
  ].filter(r => r.value);

  const dotColor = isWon ? "#34d399" : isLost ? "#f87171" : "#818cf8";
  const amtColor = isWon ? "#6ee7b7" : "#a5f3fc";

  return (
    <div
      style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.72)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={onClose}
    >
      <div
        style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:16, width:580, maxWidth:"100%", maxHeight:"90vh", overflowY:"auto", display:"flex", flexDirection:"column" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding:"22px 24px 18px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"flex-start", gap:14 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:17, fontWeight:700, color:"var(--text)", lineHeight:1.3, marginBottom:6 }}>
              {p.dealname || "Untitled Deal"}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:6, height:6, borderRadius:2, background:dotColor, flexShrink:0 }} />
              <span style={{ fontSize:11, color:"var(--text-label)", fontFamily:"'DM Mono',monospace" }}>
                {stage?.label ?? p.dealstage ?? "—"}
                {pipeline && <span style={{ color:"var(--text-faint)" }}> · {pipeline.label}</span>}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background:"var(--border)", border:"1px solid var(--border)", borderRadius:8, color:"var(--text-label)", cursor:"pointer", fontSize:16, lineHeight:1, padding:"6px 10px", flexShrink:0 }}
          >
            ✕
          </button>
        </div>

        {/* Amount hero */}
        {amount > 0 && (
          <div style={{ margin:"18px 24px 0", background: isWon ? "rgba(52,211,153,0.07)" : "rgba(165,243,252,0.06)", border:`1px solid ${isWon ? "rgba(52,211,153,0.2)" : "rgba(165,243,252,0.14)"}`, borderRadius:10, padding:"14px 18px" }}>
            <div style={{ fontSize:9, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:6 }}>Contract Value</div>
            <div style={{ fontSize:26, fontWeight:700, color:amtColor, fontFamily:"'DM Mono',monospace", letterSpacing:"-0.5px" }}>
              {formatCurrency(amount)}
            </div>
          </div>
        )}

        {/* Property grid */}
        <div style={{ padding:"18px 24px 6px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:"14px 20px" }}>
          {rows.map(r => (
            <div key={r.label} style={r.full ? { gridColumn:"1 / -1" } : {}}>
              <div style={{ fontSize:9, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:4 }}>
                {r.label}
              </div>
              <div style={{ fontSize:12, color:"var(--text-body)", lineHeight:1.55, wordBreak:"break-word" }}>
                {r.value}
              </div>
            </div>
          ))}
        </div>

        {/* Contacts section */}
        <div style={{ margin:"20px 24px 0", borderTop:"1px solid var(--border)", paddingTop:16 }}>
          <div style={{ fontSize:9, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:10 }}>
            Contacts {!loading && contacts.length > 0 && `(${contacts.length})`}
          </div>
          {loading ? (
            <div style={{ fontSize:11, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace" }}>Loading…</div>
          ) : contacts.length === 0 ? (
            <div style={{ fontSize:11, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace" }}>No contacts associated</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {contacts.map(c => {
                const cp = c.properties || {};
                const name = [cp.firstname, cp.lastname].filter(Boolean).join(" ") || "Unknown";
                return (
                  <div key={c.id} style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 13px", display:"flex", flexDirection:"column", gap:3 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:"var(--text-body)" }}>{name}</div>
                    {cp.jobtitle && <div style={{ fontSize:11, color:"var(--text-label)" }}>{cp.jobtitle}</div>}
                    <div style={{ display:"flex", gap:14, flexWrap:"wrap", marginTop:2 }}>
                      {cp.email && <a href={`mailto:${cp.email}`} style={{ fontSize:11, color:"#818cf8", textDecoration:"none", fontFamily:"'DM Mono',monospace" }}>{cp.email}</a>}
                      {cp.phone && <span style={{ fontSize:11, color:"var(--text-label)", fontFamily:"'DM Mono',monospace" }}>{cp.phone}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Notes section */}
        <div style={{ margin:"20px 24px 0", borderTop:"1px solid var(--border)", paddingTop:16 }}>
          <div style={{ fontSize:9, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:10 }}>
            Notes {!loading && notes.length > 0 && `(${notes.length})`}
          </div>
          {loading ? (
            <div style={{ fontSize:11, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace" }}>Loading…</div>
          ) : notes.length === 0 ? (
            <div style={{ fontSize:11, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace" }}>No notes found</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {notes.map(n => {
                const np = n.properties || {};
                const body = np.hs_note_body?.replace(/<[^>]*>/g, "") || "";
                return (
                  <div key={n.id} style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8, padding:"10px 13px" }}>
                    <div style={{ fontSize:9, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", marginBottom:6 }}>
                      {fmtDateTime(np.hs_timestamp)}
                    </div>
                    <div style={{ fontSize:12, color:"var(--text-body)", lineHeight:1.6, whiteSpace:"pre-wrap", wordBreak:"break-word" }}>
                      {body || <span style={{ color:"var(--text-faint)" }}>(empty note)</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:"14px 24px 20px", borderTop:"1px solid var(--border)", marginTop:16 }}>
          <div style={{ fontSize:10, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace" }}>
            HubSpot Deal ID: {deal.id}
          </div>
        </div>
      </div>
    </div>
  );
}

function KanbanBoard({ deals, pipeline, onUpdateDealStage, onSelectDeal }) {
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
                background: isOver ? "rgba(99,102,241,0.07)" : "var(--surface)",
                border: `1px solid ${isOver ? "rgba(99,102,241,0.4)" : "var(--border)"}`,
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
                  padding: "10px 0 6px", color: "var(--text-muted)",
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
                fontSize: 10, fontWeight: 600, color: "var(--text-label)",
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
                  fontSize: 9, fontWeight: 700, color: "var(--bg)", fontFamily: "'DM Mono',monospace",
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
              background: isOver ? "rgba(99,102,241,0.07)" : "var(--surface)",
              border: `1px solid ${isOver ? "rgba(99,102,241,0.4)" : "var(--border)"}`,
              borderRadius: 12, overflow: "hidden",
              transition: "border 0.12s, background 0.12s",
            }}
          >
            {/* Column header */}
            <div style={{ padding:"11px 13px 9px", borderBottom:"1px solid var(--border)", background:"var(--surface)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:3 }}>
                <div style={{ width:7, height:7, borderRadius:2, background:dotColor, flexShrink:0 }} />
                <span style={{ fontSize:11, fontWeight:600, color:"var(--text-body)", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {stage.label}
                </span>
                <span style={{ fontSize:10, color:"var(--text-muted)", fontFamily:"'DM Mono',monospace" }}>
                  {stageDeals.length}
                </span>
                {/* Collapse arrow */}
                <button
                  onClick={() => toggleCollapse(stage.id)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    padding: "2px 2px 2px 4px", color: "var(--text-faint)",
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
                    onClick={() => onSelectDeal(deal)}
                    style={{
                      background: isDragging ? "rgba(99,102,241,0.18)" : "var(--surface)",
                      border: `1px solid ${isDragging ? "rgba(99,102,241,0.45)" : "var(--border)"}`,
                      borderRadius: 8, padding: "9px 11px",
                      cursor: "pointer", opacity: isDragging ? 0.5 : 1,
                      transition: "opacity 0.1s, border 0.1s, background 0.1s",
                    }}
                    onMouseEnter={e => { if (!isDragging) e.currentTarget.style.background = "var(--hover-bg)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = isDragging ? "rgba(99,102,241,0.18)" : "var(--surface)"; }}
                  >
                    <div style={{ fontSize:12, color:"var(--text-body)", lineHeight:1.35, marginBottom: (amount > 0 || closeDate) ? 5 : 0 }}>
                      {deal.properties?.dealname || "Untitled deal"}
                    </div>
                    {amount > 0 && (
                      <div style={{ fontSize:11, fontWeight:600, color: isClosedWon ? "#6ee7b7" : "#a5f3fc", fontFamily:"'DM Mono',monospace" }}>
                        {formatCurrency(amount)}
                      </div>
                    )}
                    {closeDate && (
                      <div style={{ fontSize:9, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", marginTop:3 }}>
                        Close {closeDate}
                      </div>
                    )}
                  </div>
                );
              })}
              {stageDeals.length === 0 && (
                <div style={{ textAlign:"center", padding:"16px 0", fontSize:10, color: isOver ? "rgba(99,102,241,0.6)" : "var(--border)", fontFamily:"'DM Mono',monospace", transition:"color 0.12s" }}>
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
  const { deals, pipelines, syncing, error, lastSync, closedArr, demoStageId, demoHistory } = hs;
  const [activePipelineId, setActivePipelineId] = useState(null);
  const [expandedStageId, setExpandedStageId] = useState(null);
  const [boardView, setBoardView] = useState(true);
  const [selectedDeal, setSelectedDeal] = useState(null);
  const [hoveredDemoMonth, setHoveredDemoMonth] = useState(null);

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
            background:"var(--hover-bg)", border:"1px solid var(--border)",
            borderRadius:8, padding:"7px 13px", cursor:"pointer", color:"var(--text-muted)",
            fontSize:12, fontFamily:"'DM Mono',monospace", transition:"all 0.15s",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M7 1.5L3 5 7 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>

        <div style={{ flex:1 }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--text-faint)", marginBottom:4 }}>
            CRM Integration
          </div>
          <h1 style={{ fontSize:20, fontWeight:600, color:"var(--text)", letterSpacing:"-0.3px" }}>HubSpot Deals</h1>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {/* List / Board toggle */}
          {deals.length > 0 && (
            <div style={{ display:"flex", background:"var(--input-bg)", border:"1px solid var(--border)", borderRadius:8, padding:2, gap:2 }}>
              {[{ label:"Board", value:true }, { label:"List", value:false }].map(opt => (
                <button
                  key={opt.label}
                  onClick={() => setBoardView(opt.value)}
                  style={{
                    padding:"5px 11px", borderRadius:6, fontSize:11, fontWeight:600,
                    fontFamily:"'DM Mono',monospace", cursor:"pointer", transition:"all 0.15s",
                    background: boardView === opt.value ? "var(--border)" : "transparent",
                    border: "none",
                    color: boardView === opt.value ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          {lastSync && !syncing && (
            <span style={{ fontSize:9, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace" }}>
              Synced {lastSync.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={hs.onSync}
            disabled={!hs.token.trim() || syncing}
            style={{
              display:"flex", alignItems:"center", gap:6,
              background: syncing ? "var(--input-bg)" : "rgba(52,211,153,0.12)",
              border:`1px solid ${syncing ? "var(--border)" : "rgba(52,211,153,0.3)"}`,
              borderRadius:8, padding:"7px 13px", cursor: syncing ? "default" : "pointer",
              color: syncing ? "var(--text-faint)" : "#6ee7b7",
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
        <div style={{ textAlign:"center", padding:"80px 0", color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", fontSize:13 }}>
          Fetching deals…
        </div>
      )}

      {/* Summary cards */}
      {deals.length > 0 && (
        <div style={{ display:"flex", gap:14, marginBottom:32, flexWrap:"wrap" }}>
          {[
            { label:"Total Deals",      value: deals.length,       display: `${deals.length}`,                color:"var(--text)" },
            { label:"Closed Won YTD",   value: closedArr,          display: formatCurrency(closedArr),        color:"#6ee7b7" },
            { label:"Open Pipeline",    value: openPipelineValue,  display: formatCurrency(openPipelineValue),color:"#c4b5fd" },
            { label:"Pipelines",        value: pipelines.length,   display: `${pipelines.length}`,            color:"#fcd34d" },
          ].map(card => (
            <div key={card.label} style={{
              flex:1, minWidth:130,
              background:"var(--surface)", border:"1px solid var(--border)",
              borderRadius:12, padding:"16px 18px",
            }}>
              <div style={{ fontSize:9, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:8 }}>
                {card.label}
              </div>
              <div style={{ fontSize:22, fontWeight:700, color:card.color, fontFamily:"'DM Mono',monospace", letterSpacing:"-0.5px" }}>
                {card.display}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Demo Scheduled entries per month chart */}
      {deals.length > 0 && demoStageId && (() => {
        const now = new Date();
        const year = now.getFullYear();
        const months = {};
        for (let m = 0; m <= now.getMonth(); m++) {
          const key = `${year}-${String(m + 1).padStart(2, "0")}`;
          months[key] = [];
        }
        deals.forEach(d => {
          const history = demoHistory[d.id] ?? [];
          // Find the first time this deal's stage was set to demoStageId
          const entry = history.find(h => h.value === demoStageId);
          if (!entry) return;
          const dt = new Date(entry.timestamp);
          if (dt.getFullYear() !== year) return;
          const key = `${year}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
          if (key in months) months[key].push(d.properties?.dealname || "Unnamed");
        });
        const sortedMonths = Object.keys(months).sort();
        const maxCount = Math.max(...sortedMonths.map(k => months[k].length), 1);
        const totalYtd = sortedMonths.reduce((s, k) => s + months[k].length, 0);
        const thisMonthKey = `${year}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        return (
          <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:12, padding:"16px 20px", marginBottom:28 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
              <div style={{ fontSize:9, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", letterSpacing:"0.1em", textTransform:"uppercase" }}>
                Deals Entered Demo Scheduled — {year}
              </div>
              <span style={{ fontSize:11, color:"#22d3ee", fontFamily:"'DM Mono',monospace" }}>{totalYtd} YTD</span>
            </div>
            <div style={{ display:"flex", alignItems:"flex-end", gap:6, height:72 }}>
              {sortedMonths.map(key => {
                const monthDeals = months[key];
                const count = monthDeals.length;
                const barH = count > 0 ? Math.max(Math.round((count / maxCount) * 56), 6) : 0;
                const label = new Date(key + "-02").toLocaleDateString("en-US", { month:"short" });
                const isCurrent = key === thisMonthKey;
                const isHovered = hoveredDemoMonth === key;
                return (
                  <div
                    key={key}
                    style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2, position:"relative" }}
                    onMouseEnter={() => setHoveredDemoMonth(key)}
                    onMouseLeave={() => setHoveredDemoMonth(null)}
                  >
                    {count > 0 && (
                      <span style={{ fontSize:9, color: isCurrent ? "#67e8f9" : "var(--text-muted)", fontFamily:"'DM Mono',monospace" }}>{count}</span>
                    )}
                    <div style={{ width:"100%", flex:1, display:"flex", flexDirection:"column", justifyContent:"flex-end" }}>
                      {barH > 0 && (
                        <div style={{ width:"100%", height:barH, borderRadius:"3px 3px 0 0", background: isCurrent ? "linear-gradient(180deg,#22d3ee,#0891b2)" : "#1e3a4a" }} />
                      )}
                    </div>
                    <span style={{ fontSize:8, color: isCurrent ? "#22d3ee" : "var(--text-faint)", fontFamily:"'DM Mono',monospace" }}>{label}</span>
                    {isHovered && count > 0 && (
                      <div style={{
                        position:"absolute", bottom:"100%", left:"50%", transform:"translateX(-50%)",
                        background:"#0f172a", border:"1px solid #334155", borderRadius:8,
                        padding:"8px 10px", zIndex:10, minWidth:160, marginBottom:6,
                        boxShadow:"0 4px 16px rgba(0,0,0,0.4)",
                      }}>
                        <div style={{ fontSize:9, color:"#22d3ee", fontFamily:"'DM Mono',monospace", marginBottom:5, letterSpacing:"0.05em" }}>
                          {new Date(key + "-02").toLocaleDateString("en-US", { month:"long" })} · {count} deal{count !== 1 ? "s" : ""}
                        </div>
                        {monthDeals.map((name, i) => (
                          <div key={i} style={{ fontSize:11, color:"var(--text-body)", fontFamily:"'DM Sans',sans-serif", padding:"2px 0", borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                            {name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

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
                    background: activePipelineId === p.id ? "var(--border)" : "transparent",
                    border:`1px solid ${activePipelineId === p.id ? "var(--border)" : "var(--border)"}`,
                    color: activePipelineId === p.id ? "var(--text)" : "var(--text-label)",
                    fontFamily:"'DM Sans',sans-serif", transition:"all 0.15s",
                  }}
                >
                  {p.label}
                  <span style={{ fontSize:10, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace" }}>
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
              onSelectDeal={setSelectedDeal}
            />
          )}

          {/* List view */}
          {pipeline && !boardView && (
            <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:12, overflow:"hidden" }}>
              {/* Column headers */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 70px 130px 28px", padding:"10px 16px", borderBottom:"1px solid var(--border)", background:"var(--surface)" }}>
                {["Stage", "Deals", "Value", ""].map((h, i) => (
                  <span key={h+i} style={{ fontSize:9, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", letterSpacing:"0.1em", textTransform:"uppercase", textAlign: i > 0 ? "right" : "left" }}>
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
                        padding:"12px 16px", borderBottom:"1px solid var(--border)",
                        cursor: stageDeals.length > 0 ? "pointer" : "default",
                        background: isExpanded ? "var(--hover-bg)" : "transparent",
                        transition:"background 0.15s",
                      }}
                    >
                      <div style={{ display:"flex", alignItems:"center", gap:9 }}>
                        <div style={{ width:7, height:7, borderRadius:2, background:dotColor, flexShrink:0 }} />
                        <span style={{ fontSize:12, color:"var(--text-body)" }}>{stage.label}</span>
                      </div>
                      <span style={{ fontSize:12, color:"var(--text-muted)", fontFamily:"'DM Mono',monospace", textAlign:"right" }}>
                        {stageDeals.length || "—"}
                      </span>
                      <span style={{ fontSize:12, fontWeight:600, color: stageValue > 0 ? valueColor : "var(--text-faint)", fontFamily:"'DM Mono',monospace", textAlign:"right" }}>
                        {stageValue > 0 ? formatCurrency(stageValue) : "—"}
                      </span>
                      <span style={{ textAlign:"right", fontSize:9, color:"var(--text-faint)", paddingRight:2 }}>
                        {stageDeals.length > 0 ? (isExpanded ? "▲" : "▼") : ""}
                      </span>
                    </div>

                    {/* Expanded deals */}
                    {isExpanded && stageDeals.map(deal => (
                      <div
                        key={deal.id}
                        onClick={() => setSelectedDeal(deal)}
                        style={{
                          display:"grid", gridTemplateColumns:"1fr 70px 130px 28px",
                          padding:"8px 16px 8px 42px",
                          borderBottom:"1px solid var(--border)",
                          background:"var(--surface)",
                          cursor:"pointer", transition:"background 0.12s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "var(--hover-bg)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "var(--surface)"; }}
                      >
                        <span style={{ fontSize:11, color:"var(--text-body)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {deal.properties?.dealname || "Untitled deal"}
                        </span>
                        <span />
                        <span style={{ fontSize:11, color:"var(--text-label)", fontFamily:"'DM Mono',monospace", textAlign:"right" }}>
                          {parseFloat(deal.properties?.amount) > 0 ? formatCurrency(parseFloat(deal.properties.amount)) : "—"}
                        </span>
                        <span style={{ textAlign:"right", fontSize:9, color:"var(--text-faint)" }}>›</span>
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
        <div style={{ textAlign:"center", padding:"80px 0", color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", fontSize:12, lineHeight:2 }}>
          No deals found.<br/>Click Refresh to sync from HubSpot.
        </div>
      )}

      {!hs.token && (
        <div style={{ textAlign:"center", padding:"80px 0", color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", fontSize:12, lineHeight:2 }}>
          Add your HubSpot token in the sidebar to get started.
        </div>
      )}

      {selectedDeal && (
        <DealDetailModal
          deal={selectedDeal}
          pipelines={pipelines}
          token={hs.token}
          onClose={() => setSelectedDeal(null)}
        />
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
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif" }}>
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
  const [hsDemoStageId, setHsDemoStageId] = useState(null);
  const [hsDemoHistory, setHsDemoHistory] = useState({});
  const [hsSyncing, setHsSyncing]   = useState(false);
  const [hsError, setHsError]       = useState(null);
  const [hsLastSync, setHsLastSync] = useState(null);
  const [view, setView]             = useState("home");
  const [todosNav, setTodosNav]     = useState(null); // { tab, dealKey } for deep-linking into TodosPage
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
      const [pipelines, deals] = await Promise.all([
        fetchPipelines(hsToken.trim()),
        fetchAllDeals(hsToken.trim()),
      ]);
      let demoStageId = null;
      for (const pl of pipelines) {
        const stage = (pl.stages ?? []).find(s => s.label?.toLowerCase().includes("demo"));
        if (stage) { demoStageId = stage.id; break; }
      }
      const history = demoStageId
        ? await fetchDealStageHistory(hsToken.trim(), deals.map(d => d.id))
        : {};
      setHsDeals(deals);
      setHsPipelines(pipelines);
      setHsDemoStageId(demoStageId);
      setHsDemoHistory(history);
      setHsLastSync(new Date());
    } catch (e) {
      setHsError(e.message);
    } finally {
      setHsSyncing(false);
    }
  }, [hsToken]);

  const handleHsDealClosed = useCallback((hubspotId) => {
    setHsDeals(prev => prev.map(d =>
      d.id === hubspotId ? { ...d, properties: { ...d.properties, dealstage: "closedwon" } } : d
    ));
  }, []);

  const handleUpdateDealStage = useCallback(async (dealId, stageId) => {
    setHsDeals(prev => prev.map(d =>
      d.id === dealId ? { ...d, properties: { ...d.properties, dealstage: stageId } } : d
    ));
    try {
      await updateDealStage(hsToken.trim(), dealId, stageId);
      // Sync stage changes to Pipeline Tracker regardless of which page is mounted
      if (stageId === "closedwon" || stageId === "closedlost") {
        const snap = await getDocs(
          query(collection(db, "pipelineDeals"), where("hubspotId", "==", dealId))
        );
        snap.forEach(docSnap => {
          if (stageId === "closedwon" && !docSnap.data().closedWon) {
            updateDoc(doc(db, "pipelineDeals", docSnap.id), {
              closedWon: true,
              updatedAt: serverTimestamp(),
            });
          } else if (stageId === "closedlost") {
            deleteDoc(doc(db, "pipelineDeals", docSnap.id));
          }
        });
      }
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
    const canvas = await html2canvas(pageRef.current, { backgroundColor: "var(--bg)", scale: 2, useCORS: true });
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
    deals: hsDeals, pipelines: hsPipelines, closedArr, demoStageId: hsDemoStageId, demoHistory: hsDemoHistory,
    onSync: syncHubspot,
    onUpdateDealStage: handleUpdateDealStage,
    onClosePage: () => setView("home"),
  };

  // ─── Auth guards ───────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif" }}>
        <div style={{ color: "var(--border-strong)", fontSize: "13px" }}>Loading…</div>
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
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans',sans-serif", padding: "20px" }}>
        <div style={{ background: "var(--surface)", border: "1px solid #334155", borderRadius: "12px", padding: "36px", maxWidth: "380px", textAlign: "center" }}>
          <div style={{ fontSize: "20px", fontWeight: "600", color: "var(--text)", marginBottom: "8px" }}>Account Deactivated</div>
          <div style={{ color: "var(--text-label)", fontSize: "13px", marginBottom: "24px", lineHeight: "1.6" }}>
            Your access has been revoked. Contact <strong style={{ color: "#a5b4fc" }}>admin@uniqlearn.co</strong> for help.
          </div>
          <button
            onClick={() => signOut(auth)}
            style={{ padding: "9px 20px", background: "transparent", border: "1px solid #334155", borderRadius: "8px", color: "var(--text-label)", fontSize: "13px", cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <ThemeProvider>
    <div style={{ fontFamily:"'DM Sans','Helvetica Neue',sans-serif", background:"var(--bg)", height:"100vh", overflow:"hidden", color:"var(--text)", display:"flex", flexDirection:"row" }}>
      {showLoginAnim && <LoginAnimation onDone={() => setShowLoginAnim(false)} />}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        .tab { padding:6px 16px; border-radius:8px; font-size:13px; font-weight:500; cursor:pointer; border:1px solid transparent; transition:all 0.15s; background:transparent; color:var(--text-muted); font-family:'DM Sans',sans-serif; }
        .tab.on { background:var(--hover-bg); border-color:var(--border); color:var(--text); }
        .tab:hover:not(.on) { color:var(--text-label); }
        input[type=range] { -webkit-appearance:none; width:100%; height:3px; border-radius:4px; background:var(--border-strong); outline:none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:13px; height:13px; border-radius:50%; background:#6366f1; cursor:pointer; box-shadow:0 0 7px rgba(99,102,241,0.5); }
        input[type=text]:focus { border-color:rgba(99,102,241,0.5) !important; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .fadein { animation:fadeUp 0.22s ease; }
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
      {view === "home" && <HomePage onNavigate={(v, nav) => { if (nav) setTodosNav(nav); setView(v); }} currentUser={currentUser} />}

      {/* HubSpot page */}
      {view === "hubspot" && <HubSpotPage hs={hs} />}

      {/* Pipeline page */}
      {view === "pipeline" && <PipelinePage hsDeals={hsDeals} hsPipelines={hsPipelines} hsToken={hsToken} onHsDealClosed={handleHsDealClosed} />}

      {/* Notes & Todos page (user-specific) */}
      {view === "todos" && <TodosPage currentUser={currentUser} initialNav={todosNav} onNavConsumed={() => setTodosNav(null)} />}

      {/* Admin panel (admin only) */}
      {view === "admin" && isAdmin && <AdminPanel currentUser={currentUser} onNavigate={setView} />}

      {/* Input Metrics (main) content */}
      <div ref={pageRef} style={{ flex:1, padding:"32px 20px 80px", display: (view !== "main") ? "none" : "flex", flexDirection:"column", alignItems:"center", minWidth:0 }}>

        {/* Header */}
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:"0.15em", color:"var(--text-faint)", textTransform:"uppercase", marginBottom:8 }}>Working Backwards · New Logo ARR</div>
          <h1 style={{ fontSize:22, fontWeight:600, letterSpacing:"-0.5px", color:"var(--text)", marginBottom:14 }}>Revenue Input Flow</h1>
          <div style={{ display:"inline-flex", gap:3, background:"var(--hover-bg)", border:"1px solid var(--border)", borderRadius:10, padding:3 }}>
            <button className={`tab ${mode==="explore"?"on":""}`} onClick={()=>setMode("explore")}>Explore</button>
            <button className={`tab ${mode==="calculator"?"on":""}`} onClick={()=>setMode("calculator")}>Calculator</button>
          </div>
          <button onClick={handleDownload} style={{ marginTop:12, display:"inline-flex", alignItems:"center", gap:6, background:"var(--border)", border:"1px solid var(--border)", borderRadius:8, padding:"6px 14px", color:"var(--text-muted)", fontSize:12, fontFamily:"'DM Mono',monospace", cursor:"pointer", transition:"all 0.15s" }}
            onMouseEnter={e=>{e.currentTarget.style.background="var(--border)";e.currentTarget.style.color="var(--text)";}}
            onMouseLeave={e=>{e.currentTarget.style.background="var(--border)";e.currentTarget.style.color="var(--text-muted)";}}>
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
          <span style={{ fontSize:9, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", letterSpacing:"0.08em", textTransform:"uppercase", marginRight:2 }}>Click a node to label it:</span>
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
              <path d="M100 0 Q100 36 300 36" stroke="var(--border)" strokeWidth="1.5" fill="none"/>
              <path d="M300 0 Q300 36 300 36" stroke="var(--border)" strokeWidth="1.5" fill="none"/>
              <path d="M500 0 Q500 36 300 36" stroke="var(--border)" strokeWidth="1.5" fill="none"/>
            </svg>
          </div>

          {/* Combined box */}
          <div className="fadein" style={{ width:"100%", maxWidth:560, borderRadius:18, background:"linear-gradient(135deg,rgba(139,92,246,0.08),rgba(16,185,129,0.06))", border:"1px solid var(--border)", padding:"24px 28px", textAlign:"center", position:"relative", overflow:"hidden" }}>
            <div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse at 20% 50%,rgba(139,92,246,0.07) 0%,transparent 55%), radial-gradient(ellipse at 80% 50%,rgba(16,185,129,0.07) 0%,transparent 55%)", pointerEvents:"none" }} />

            <div style={{ fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:"0.14em", textTransform:"uppercase", color:"var(--text-faint)", marginBottom:8 }}>
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
                    {i>0 && <div style={{ width:1, background:"var(--border)", margin:"0 16px" }} />}
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:10, color:`${ch.color}99`, fontFamily:"'DM Mono',monospace", marginBottom:3, letterSpacing:"0.07em" }}>{ch.label}</div>
                      <div style={{ fontSize:14, fontWeight:700, color:ch.color, fontFamily:"'DM Mono',monospace" }}>{formatCurrency(ch.arr)}</div>
                      <div style={{ fontSize:10, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", marginTop:2 }}>{ch.pct}%</div>
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
              <div style={{ marginTop:18, paddingTop:14, borderTop:"1px solid var(--border)", display:"flex", justifyContent:"center", gap:0 }}>
                {[
                  { label:"PROJECTED",  value:total,                          color:"#c4b5fd" },
                  { label:"CLOSED YTD", value:closedArr,                      color:"#6ee7b7" },
                  { label:"REMAINING",  value:Math.max(0, total - closedArr), color:"var(--text-muted)" },
                ].map((item, i) => (
                  <div key={item.label} style={{ display:"flex", alignItems:"stretch" }}>
                    {i > 0 && <div style={{ width:1, background:"var(--border)", margin:"0 14px" }} />}
                    <div style={{ textAlign:"center" }}>
                      <div style={{ fontSize:9, color:"var(--text-faint)", fontFamily:"'DM Mono',monospace", marginBottom:3, letterSpacing:"0.07em" }}>{item.label}</div>
                      <div style={{ fontSize:13, fontWeight:700, color:item.color, fontFamily:"'DM Mono',monospace" }}>{formatCurrency(item.value)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {mode === "explore" && (
              <p style={{ fontSize:13, color:"var(--text-faint)", lineHeight:1.65 }}>
                Three channels converge into one output. Switch to <span style={{ color:"var(--text-muted)" }}>Calculator mode</span> to see your total ARR and channel mix.
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
            <p style={{ fontSize:13, color:"var(--text-faint)", lineHeight:1.8 }}>
              <span style={{ color:"rgba(139,92,246,0.8)" }}>Outbound</span> scales with headcount and is your highest-volume channel.{" "}
              <span style={{ color:"rgba(245,158,11,0.8)" }}>In-person</span> tends to close at higher ACV but top-of-funnel is constrained by time.{" "}
              <span style={{ color:"rgba(16,185,129,0.8)" }}>Podcast</span> is a slow-burn channel — guests convert at high rates but volume is limited by recording cadence. Together they give you a resilient, diversified revenue model.
            </p>
          </div>
        )}
      </div>
      </div> {/* end scrollable content area */}
    </div>
    </ThemeProvider>
  );
}
