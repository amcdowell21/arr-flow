import { useState, useCallback, useRef } from "react";
import html2canvas from "html2canvas";

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

// ─── Funnel column ────────────────────────────────────────────────────────────
function FunnelColumn({ nodes, computed, mode, outputColor, outputLabel, outputValue }) {
  return (
    <div style={{ flex:1, minWidth:180, maxWidth:280 }}>
      {nodes.map((m, i) => (
        <div key={m.id}>
          {i > 0 && (
            <div style={{ height:20, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
                <div style={{ width:2, height:11, background:"rgba(255,255,255,0.1)" }} />
                <svg width="8" height="5" viewBox="0 0 8 5"><path d="M0 0L4 5L8 0" fill="rgba(255,255,255,0.12)"/></svg>
              </div>
            </div>
          )}
          <div style={{ border:"1px solid rgba(255,255,255,0.08)", borderRadius:9, padding:"11px 13px", background:"rgba(255,255,255,0.025)", position:"relative", overflow:"hidden" }}>
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
          </div>
        </div>
      ))}

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

// ─── Main ────────────────────────────────────────────────────────────────────
export default function ARRFlow() {
  const [mode, setMode] = useState("explore");
  const [ob, setOb] = useState(defaultOutbound);
  const [ip, setIp] = useState(defaultInPerson);
  const [pd, setPd] = useState(defaultPodcast);
  const pageRef = useRef(null);

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

  const handleOb = useCallback((k,v)=>setOb(p=>({...p,[k]:v})),[]);
  const handleIp = useCallback((k,v)=>setIp(p=>({...p,[k]:v})),[]);
  const handlePd = useCallback((k,v)=>setPd(p=>({...p,[k]:v})),[]);

  const channels = [
    { arr: obArr, color:"#8b5cf6", label:"OUTBOUND",  pct: total>0?Math.round(obArr/total*100):0 },
    { arr: ipArr, color:"#f59e0b", label:"IN-PERSON", pct: total>0?Math.round(ipArr/total*100):0 },
    { arr: pdArr, color:"#10b981", label:"PODCAST",   pct: total>0?Math.round(pdArr/total*100):0 },
  ];

  return (
    <div ref={pageRef} style={{ fontFamily:"'DM Sans','Helvetica Neue',sans-serif", background:"#09090e", minHeight:"100vh", padding:"32px 20px 80px", color:"#f0f0f5", display:"flex", flexDirection:"column", alignItems:"center" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        .tab { padding:6px 16px; border-radius:8px; font-size:13px; font-weight:500; cursor:pointer; border:1px solid transparent; transition:all 0.15s; background:transparent; color:rgba(255,255,255,0.35); font-family:'DM Sans',sans-serif; }
        .tab.on { background:rgba(255,255,255,0.09); border-color:rgba(255,255,255,0.12); color:#fff; }
        .tab:hover:not(.on) { color:rgba(255,255,255,0.6); }
        input[type=range] { -webkit-appearance:none; width:100%; height:3px; border-radius:4px; background:rgba(255,255,255,0.1); outline:none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:13px; height:13px; border-radius:50%; background:#6366f1; cursor:pointer; box-shadow:0 0 7px rgba(99,102,241,0.5); }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        .fadein { animation:fadeUp 0.22s ease; }
      `}</style>

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

      {/* Three funnels */}
      <div style={{ display:"flex", gap:20, width:"100%", maxWidth:960, justifyContent:"center", flexWrap:"wrap" }}>
        <FunnelColumn nodes={outboundNodes} computed={cob} mode={mode} outputColor="#8b5cf6" outputLabel="Outbound ARR" outputValue={obArr} />
        <FunnelColumn nodes={inPersonNodes} computed={cip} mode={mode} outputColor="#f59e0b" outputLabel="In-Person ARR" outputValue={ipArr} />
        <FunnelColumn nodes={podcastNodes}  computed={cpd} mode={mode} outputColor="#10b981" outputLabel="Podcast ARR"   outputValue={pdArr} />
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
  );
}