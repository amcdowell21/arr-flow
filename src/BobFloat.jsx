import { useState, useRef, useEffect, useCallback } from "react";
import { db } from "./firebase";
import { collection, query, where, getDocs, addDoc, updateDoc, doc, serverTimestamp } from "firebase/firestore";

// ─── Lightweight markdown (minimal for float chat) ──────────────────────────
function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split("\n");
  const elements = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      i++;
      elements.push(<pre key={elements.length} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "8px 12px", margin: "6px 0", overflow: "auto", fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#e2e8f0", lineHeight: 1.5 }}><code>{codeLines.join("\n")}</code></pre>);
      continue;
    }
    if (line.startsWith("### ")) { elements.push(<div key={elements.length} style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9", margin: "8px 0 2px" }}>{renderInline(line.slice(4))}</div>); i++; continue; }
    if (line.startsWith("## ")) { elements.push(<div key={elements.length} style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", margin: "10px 0 3px" }}>{renderInline(line.slice(3))}</div>); i++; continue; }
    if (line.startsWith("# ")) { elements.push(<div key={elements.length} style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", margin: "12px 0 4px" }}>{renderInline(line.slice(2))}</div>); i++; continue; }
    if (/^[-*] /.test(line)) { elements.push(<div key={elements.length} style={{ display: "flex", gap: 6, margin: "1px 0", paddingLeft: 4 }}><span style={{ color: "#64748b", flexShrink: 0 }}>•</span><span>{renderInline(line.slice(2))}</span></div>); i++; continue; }
    if (!line.trim()) { elements.push(<div key={elements.length} style={{ height: 6 }} />); i++; continue; }
    elements.push(<div key={elements.length} style={{ margin: "1px 0", lineHeight: 1.55 }}>{renderInline(line)}</div>);
    i++;
  }
  return elements;
}
function renderInline(text) {
  const parts = [];
  const regex = /(\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*)/g;
  let last = 0, match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2]) parts.push(<strong key={parts.length} style={{ fontWeight: 600, color: "#f1f5f9" }}>{match[2]}</strong>);
    else if (match[3]) parts.push(<code key={parts.length} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 3, padding: "0px 4px", fontFamily: "'DM Mono',monospace", fontSize: "0.85em", color: "#a5f3fc" }}>{match[3]}</code>);
    else if (match[4]) parts.push(<em key={parts.length}>{match[4]}</em>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

// ─── SSE stream parser ──────────────────────────────────────────────────────
async function* parseSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      let event = "message", data = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (data) { try { yield { event, data: JSON.parse(data) }; } catch {} }
    }
  }
}

// ─── Tool labels ────────────────────────────────────────────────────────────
const TOOL_LABELS = {
  list_deals: "Searching deals...", update_deal: "Updating deal...", create_deal: "Creating deal...",
  delete_deal: "Deleting deal...", list_events: "Loading events...", create_event: "Creating event...",
  list_outbound: "Loading outbound...", create_outbound: "Logging outbound...", read_notes: "Reading notes...",
  update_notes: "Updating notes...", add_follow_up: "Scheduling follow-up...", complete_follow_up: "Completing follow-up...",
  search_hubspot_deals: "Searching HubSpot...", get_deal_contacts: "Loading contacts...",
  get_deal_notes: "Loading deal notes...", sync_hubspot: "Syncing HubSpot...",
};

export default function BobFloat({ currentUser, hsToken, currentView }) {
  // Don't render on the Bob page itself
  if (currentView === "bob") return null;

  const [expanded, setExpanded] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeTools, setActiveTools] = useState([]);
  const streamingTextRef = useRef("");
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const convIdRef = useRef(null);

  // ─── Call state ─────────────────────────────────────────────────────────
  const [inCall, setInCall] = useState(false);
  const [callPhase, setCallPhase] = useState("idle");
  const [callSeconds, setCallSeconds] = useState(0);
  const callActiveRef = useRef(false);
  const callTimerRef = useRef(null);
  const elevenConvRef = useRef(null);
  const micLevelPollRef = useRef(null);
  const [micLevel, setMicLevel] = useState(0);

  // ─── Drag state (bubble) ────────────────────────────────────────────────
  const [pos, setPos] = useState({ x: 24, y: null }); // y=null means bottom-anchored
  const [bottomOffset, setBottomOffset] = useState(24);
  const dragRef = useRef(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
  const hasMoved = useRef(false);

  // ─── Drag state (chat modal) ──────────────────────────────────────────
  const [chatPos, setChatPos] = useState(null); // null = auto-position, otherwise {x,y}
  const chatDragging = useRef(false);
  const chatDragStart = useRef({ x: 0, y: 0, startX: 0, startY: 0 });

  const onPointerDown = useCallback((e) => {
    if (chatOpen) return;
    isDragging.current = true;
    hasMoved.current = false;
    const rect = dragRef.current.getBoundingClientRect();
    dragStart.current = { x: e.clientX, y: e.clientY, startX: rect.left, startY: rect.top };
    e.preventDefault();
  }, [chatOpen]);

  const onChatPointerDown = useCallback((e) => {
    // Only drag from the header area
    chatDragging.current = true;
    const modal = e.currentTarget.closest("[data-bob-chat]");
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    chatDragStart.current = { x: e.clientX, y: e.clientY, startX: rect.left, startY: rect.top };
    e.preventDefault();
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (isDragging.current) {
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved.current = true;
        const newX = dragStart.current.startX + dx;
        const newY = dragStart.current.startY + dy;
        setPos({ x: Math.max(0, Math.min(newX, window.innerWidth - 56)), y: Math.max(0, Math.min(newY, window.innerHeight - 56)) });
        setBottomOffset(null);
      }
      if (chatDragging.current) {
        const dx = e.clientX - chatDragStart.current.x;
        const dy = e.clientY - chatDragStart.current.y;
        const newX = chatDragStart.current.startX + dx;
        const newY = chatDragStart.current.startY + dy;
        setChatPos({
          x: Math.max(0, Math.min(newX, window.innerWidth - 200)),
          y: Math.max(0, Math.min(newY, window.innerHeight - 200)),
        });
      }
    };
    const onUp = () => { isDragging.current = false; chatDragging.current = false; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, activeTools]);

  // Focus input when chat opens
  useEffect(() => {
    if (chatOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [chatOpen]);

  // ─── Send message ─────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg = { role: "user", content: text, timestamp: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);
    setStreamingText("");
    setActiveTools([]);
    streamingTextRef.current = "";

    // Save conversation
    let convId = convIdRef.current;
    const msgData = newMessages.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp || Date.now() }));
    if (!convId) {
      try {
        const newDoc = await addDoc(collection(db, "bobConversations"), {
          userId: currentUser.uid, title: text.slice(0, 60), messages: msgData,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        convId = newDoc.id;
        convIdRef.current = convId;
      } catch (e) { console.error("Conv create error:", e); }
    } else {
      try { await updateDoc(doc(db, "bobConversations", convId), { messages: msgData, updatedAt: serverTimestamp() }); } catch (e) { console.error("Conv update error:", e); }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch("/api/bob", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: convId,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          userId: currentUser.uid,
          hsToken: hsToken || localStorage.getItem("hs_token") || null,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`Server error (${response.status})`);

      for await (const { event, data } of parseSSE(response)) {
        switch (event) {
          case "delta":
            streamingTextRef.current += data.text;
            setStreamingText(streamingTextRef.current);
            break;
          case "tool":
            setActiveTools(prev => {
              const existing = prev.findIndex(t => t.name === data.name);
              if (existing >= 0) { const next = [...prev]; next[existing] = data; return next; }
              return [...prev, data];
            });
            break;
          case "conversation":
            if (data.id && !convIdRef.current) { convIdRef.current = data.id; }
            break;
          case "done": break;
          case "error":
            streamingTextRef.current += "\n\n*Error: " + (data.message || "Something went wrong") + "*";
            setStreamingText(streamingTextRef.current);
            break;
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        streamingTextRef.current += "\n\n*Error: " + e.message + "*";
        setStreamingText(streamingTextRef.current);
      }
    } finally {
      clearTimeout(timeout);
    }

    const finalText = streamingTextRef.current;
    if (finalText) {
      const assistantMsg = { role: "assistant", content: finalText, timestamp: Date.now() };
      setMessages(prev => [...prev, assistantMsg]);
      // Save final
      try {
        if (convIdRef.current) {
          const allMsgs = [...newMessages, assistantMsg].map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp || Date.now() }));
          await updateDoc(doc(db, "bobConversations", convIdRef.current), { messages: allMsgs, updatedAt: serverTimestamp() });
        }
      } catch (e) { console.error("Final save error:", e); }
    }
    setStreaming(false);
    setStreamingText("");
    setActiveTools([]);
    streamingTextRef.current = "";
  }, [input, messages, streaming, currentUser, hsToken]);

  // ─── Start call ─────────────────────────────────────────────────────
  const startCall = useCallback(async () => {
    let signedUrl;
    try {
      const res = await fetch("/api/eleven-signed-url");
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = await res.json();
      signedUrl = data.signed_url;
    } catch (e) {
      console.error("[BobFloat] Signed URL error:", e);
      return;
    }

    callActiveRef.current = true;
    setInCall(true);
    setCallSeconds(0);
    setCallPhase("listening");
    setExpanded(false);

    callTimerRef.current = setInterval(() => setCallSeconds(s => s + 1), 1000);

    try {
      const { Conversation } = await import("@11labs/client");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
      } catch (micErr) {
        console.error("[BobFloat] Mic denied:", micErr);
        callActiveRef.current = false;
        setInCall(false);
        setCallPhase("idle");
        return;
      }

      const conversation = await Conversation.startSession({
        signedUrl,
        overrides: {
          agent: {
            firstMessage: "Hey, how can I help you?",
          },
          turnDetection: {
            silenceDurationMs: 300,
            threshold: 0.1,
            allowInterruptions: true,
          },
        },
        clientTools: {
          list_deals: async () => {
            try {
              const snap = await getDocs(collection(db, "pipelineDeals"));
              const deals = snap.docs.map(d => { const data = d.data(); return { name: data.name, value: data.value, bucket: data.bucket, closedWon: data.closedWon }; });
              const active = deals.filter(d => d.bucket === "active" && !d.closedWon);
              const totalValue = active.reduce((s, d) => s + (d.value || 0), 0);
              return `${deals.length} total deals. ${active.length} active worth $${totalValue.toLocaleString()}.`;
            } catch (e) { return "Error: " + e.message; }
          },
          list_events: async () => {
            try {
              const snap = await getDocs(collection(db, "pipelineEvents"));
              const events = snap.docs.map(d => d.data());
              return events.length > 0 ? `${events.length} events: ${events.map(e => `${e.name} (${e.date})`).join("; ")}` : "No events.";
            } catch (e) { return "Error: " + e.message; }
          },
          list_outbound: async () => {
            try {
              const snap = await getDocs(collection(db, "outboundActuals"));
              const entries = snap.docs.map(d => d.data()).sort((a, b) => (b.weekOf || "").localeCompare(a.weekOf || ""));
              const recent = entries.slice(0, 4);
              return recent.length > 0 ? `Recent outbound: ${recent.map(e => `Wk ${e.weekOf}: ${e.touches || 0}t, ${e.bookings || 0}b`).join("; ")}` : "No outbound.";
            } catch (e) { return "Error: " + e.message; }
          },
          read_notes: async () => {
            try {
              if (!currentUser) return "No user.";
              const snap = await getDocs(query(collection(db, "userNotes"), where("__name__", "==", currentUser.uid)));
              if (snap.empty) return "No notes.";
              const data = snap.docs[0].data();
              const blocks = (data.blocks || []).filter(b => b.content).map(b => b.content);
              return blocks.length > 0 ? `Notes: ${blocks.slice(0, 10).join("; ")}` : "Notes empty.";
            } catch (e) { return "Error: " + e.message; }
          },
          get_pipeline_summary: async () => {
            try {
              const snap = await getDocs(collection(db, "pipelineDeals"));
              const deals = snap.docs.map(d => d.data());
              const active = deals.filter(d => !d.closedWon && d.bucket === "active");
              const won = deals.filter(d => d.closedWon);
              return `${active.length} active deals ($${active.reduce((s, d) => s + (d.value || 0), 0).toLocaleString()}), ${won.length} closed won ($${won.reduce((s, d) => s + (d.value || 0), 0).toLocaleString()}).`;
            } catch (e) { return "Error: " + e.message; }
          },
        },
        onConnect: () => setCallPhase("listening"),
        onDisconnect: () => {
          if (callActiveRef.current) {
            callActiveRef.current = false;
            setInCall(false);
            setCallPhase("idle");
          }
        },
        onModeChange: (mode) => {
          setCallPhase(mode.mode === "speaking" ? "speaking" : "listening");
        },
        onError: (err) => console.error("[BobFloat] Call error:", err),
      });

      elevenConvRef.current = conversation;
      micLevelPollRef.current = setInterval(() => {
        if (elevenConvRef.current) setMicLevel(elevenConvRef.current.getInputVolume());
      }, 100);
    } catch (e) {
      console.error("[BobFloat] Call start error:", e);
      callActiveRef.current = false;
      setInCall(false);
      setCallPhase("idle");
    }
  }, [currentUser]);

  const endCall = useCallback(async () => {
    callActiveRef.current = false;
    if (micLevelPollRef.current) { clearInterval(micLevelPollRef.current); micLevelPollRef.current = null; }
    if (elevenConvRef.current) { try { await elevenConvRef.current.endSession(); } catch (_) {} elevenConvRef.current = null; }
    if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
    setInCall(false);
    setCallPhase("idle");
    setCallSeconds(0);
    setMicLevel(0);
  }, []);

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const handleBubbleClick = () => {
    if (hasMoved.current) return;
    if (inCall) { endCall(); return; }
    if (chatOpen) return;
    setExpanded(e => !e);
  };

  const openChat = () => { setChatOpen(true); setExpanded(false); setChatPos(null); };
  const closeChat = () => { setChatOpen(false); setChatPos(null); };
  const handleStartCall = () => { setExpanded(false); startCall(); };

  // ─── Compute bubble position ────────────────────────────────────────
  const bubbleStyle = {
    position: "fixed",
    zIndex: 9999,
    left: pos.x,
    ...(pos.y !== null ? { top: pos.y } : { bottom: bottomOffset }),
  };

  // Call pulse ring scale
  const pulseScale = inCall ? 1 + micLevel * 0.5 : 1;

  return (
    <>
      {/* Main floating bubble */}
      <div ref={dragRef} style={bubbleStyle} onPointerDown={onPointerDown}>
        <div
          onClick={handleBubbleClick}
          style={{
            width: 48, height: 48, borderRadius: "50%", cursor: inCall ? "pointer" : (isDragging.current ? "grabbing" : "grab"),
            background: inCall
              ? (callPhase === "speaking" ? "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)" : "linear-gradient(135deg, #06b6d4 0%, #6366f1 100%)")
              : "linear-gradient(135deg, #06b6d4 0%, #6366f1 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: inCall ? `0 0 ${12 + micLevel * 20}px rgba(99,102,241,${0.4 + micLevel * 0.3})` : "0 4px 16px rgba(0,0,0,0.4)",
            transition: "box-shadow 0.15s, transform 0.15s",
            transform: `scale(${pulseScale})`,
            userSelect: "none", touchAction: "none",
          }}
        >
          {inCall ? (
            // Phone icon (end call)
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 4 .64 2 2 0 0 1 2 2v3.28a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 5.33 2h3.28a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .64 4 2 2 0 0 1-.45 2.11L9.53 11.1" />
              <line x1="1" y1="1" x2="23" y2="23" stroke="#f87171" strokeWidth="2.5" />
            </svg>
          ) : (
            <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", fontFamily: "'DM Sans',sans-serif" }}>B</span>
          )}
        </div>

        {/* Call timer badge */}
        {inCall && (
          <div style={{
            position: "absolute", top: -8, right: -8, background: "#dc2626", color: "#fff",
            fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 10,
            fontFamily: "'DM Mono',monospace", whiteSpace: "nowrap",
          }}>
            {fmtTime(callSeconds)}
          </div>
        )}

        {/* Call phase indicator */}
        {inCall && (
          <div style={{
            position: "absolute", bottom: -6, left: "50%", transform: "translateX(-50%)",
            background: callPhase === "speaking" ? "#a855f7" : "#06b6d4",
            color: "#fff", fontSize: 8, fontWeight: 600, padding: "1px 6px", borderRadius: 8,
            fontFamily: "'DM Mono',monospace", textTransform: "uppercase", whiteSpace: "nowrap",
          }}>
            {callPhase === "speaking" ? "Bob" : "Listening"}
          </div>
        )}

        {/* Expanded menu (chat / phone buttons) */}
        {expanded && !inCall && (
          <div style={{
            position: "absolute", bottom: 56, left: 0,
            display: "flex", flexDirection: "column", gap: 8,
            animation: "fadeUp 0.15s ease",
          }}>
            {/* Chat button */}
            <div
              onClick={openChat}
              style={{
                width: 40, height: 40, borderRadius: "50%", cursor: "pointer",
                background: "#1e293b", border: "1px solid #334155",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 2px 8px rgba(0,0,0,0.3)", transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#6366f1"; e.currentTarget.style.background = "#252f40"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.background = "#1e293b"; }}
              title="Chat with Bob"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            {/* Phone button */}
            <div
              onClick={handleStartCall}
              style={{
                width: 40, height: 40, borderRadius: "50%", cursor: "pointer",
                background: "#1e293b", border: "1px solid #334155",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 2px 8px rgba(0,0,0,0.3)", transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#22c55e"; e.currentTarget.style.background = "#252f40"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.background = "#1e293b"; }}
              title="Call Bob"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Click-away overlay for expanded menu */}
      {expanded && !inCall && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9998 }}
          onClick={() => setExpanded(false)}
        />
      )}

      {/* Chat modal — no backdrop, draggable */}
      {chatOpen && (
          <div data-bob-chat style={{
            position: "fixed", zIndex: 10001,
            ...(chatPos
              ? { left: chatPos.x, top: chatPos.y }
              : { bottom: 80, left: pos.x < window.innerWidth / 2 ? pos.x : "auto",
                  right: pos.x >= window.innerWidth / 2 ? (window.innerWidth - pos.x - 48) : "auto" }
            ),
            width: 400, maxWidth: "calc(100vw - 32px)", height: 520, maxHeight: "calc(100vh - 120px)",
            background: "#0f172a", border: "1px solid #334155", borderRadius: 16,
            display: "flex", flexDirection: "column", overflow: "hidden",
            boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
            animation: chatPos ? "none" : "fadeUp 0.2s ease",
          }}>
            {/* Header — drag handle */}
            <div
              onPointerDown={onChatPointerDown}
              style={{
                padding: "14px 16px", borderBottom: "1px solid #334155",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                cursor: "grab", userSelect: "none", touchAction: "none",
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: "linear-gradient(135deg, #06b6d4 0%, #6366f1 100%)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700, color: "#fff",
                }}>B</div>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9", fontFamily: "'DM Sans',sans-serif" }}>Bob</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setMessages([]); convIdRef.current = null; }} style={{
                  background: "transparent", border: "1px solid #334155", borderRadius: 6,
                  padding: "4px 10px", color: "#94a3b8", fontSize: 11, cursor: "pointer",
                  fontFamily: "'DM Sans',sans-serif",
                }} title="New chat">New</button>
                <button onClick={closeChat} style={{
                  background: "transparent", border: "none", color: "#64748b", fontSize: 18,
                  cursor: "pointer", padding: "0 4px", lineHeight: 1,
                }}>×</button>
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
              {messages.length === 0 && !streaming && (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "#64748b", fontSize: 13 }}>
                  Ask Bob anything about your pipeline, deals, or notes.
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                  marginBottom: 8,
                }}>
                  {msg.role !== "user" && (
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                      background: "linear-gradient(135deg, #06b6d4 0%, #6366f1 100%)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      marginRight: 8, marginTop: 2, fontSize: 9, fontWeight: 700, color: "#fff",
                    }}>B</div>
                  )}
                  <div style={{
                    maxWidth: "80%", padding: "8px 12px", borderRadius: 10,
                    fontSize: 12, lineHeight: 1.55, fontFamily: "'DM Sans',sans-serif", color: "#e2e8f0",
                    ...(msg.role === "user"
                      ? { background: "rgba(99,102,241,0.15)", borderBottomRightRadius: 3 }
                      : { background: "#1e293b", border: "1px solid #334155", borderBottomLeftRadius: 3 }
                    ),
                  }}>
                    {msg.role === "user" ? msg.content : renderMarkdown(msg.content)}
                  </div>
                </div>
              ))}
              {/* Active tools */}
              {activeTools.map((tool, i) => (
                <div key={i} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)",
                  borderRadius: 16, padding: "3px 10px", marginBottom: 6, marginLeft: 30,
                  fontSize: 10, color: "#67e8f9", fontFamily: "'DM Mono',monospace",
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#06b6d4", animation: tool.status === "running" ? "pulse 1.5s infinite" : "none" }} />
                  {tool.status === "running" ? (TOOL_LABELS[tool.name] || tool.name) : "Done"}
                </div>
              ))}
              {/* Streaming text */}
              {streaming && streamingText && (
                <div style={{ display: "flex", marginBottom: 8 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                    background: "linear-gradient(135deg, #06b6d4 0%, #6366f1 100%)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    marginRight: 8, marginTop: 2, fontSize: 9, fontWeight: 700, color: "#fff",
                  }}>B</div>
                  <div style={{
                    maxWidth: "80%", padding: "8px 12px", borderRadius: 10, borderBottomLeftRadius: 3,
                    fontSize: 12, lineHeight: 1.55, fontFamily: "'DM Sans',sans-serif", color: "#e2e8f0",
                    background: "#1e293b", border: "1px solid #334155",
                  }}>
                    {renderMarkdown(streamingText)}
                    <span style={{ display: "inline-block", width: 6, height: 14, background: "#6366f1", marginLeft: 2, animation: "pulse 1s infinite", borderRadius: 1 }} />
                  </div>
                </div>
              )}
              {streaming && !streamingText && activeTools.length === 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0 8px 30px", color: "#64748b", fontSize: 11 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#6366f1", animation: "pulse 1s infinite" }} />
                  Thinking...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={{
              padding: "10px 14px", borderTop: "1px solid #334155",
              display: "flex", gap: 8,
            }}>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Message Bob..."
                disabled={streaming}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: 8,
                  background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0",
                  fontSize: 12, fontFamily: "'DM Sans',sans-serif", outline: "none",
                }}
              />
              <button
                onClick={sendMessage}
                disabled={streaming || !input.trim()}
                style={{
                  padding: "8px 14px", borderRadius: 8, border: "none",
                  background: streaming || !input.trim() ? "#334155" : "#6366f1",
                  color: "#fff", fontSize: 12, fontWeight: 600, cursor: streaming || !input.trim() ? "default" : "pointer",
                  fontFamily: "'DM Sans',sans-serif",
                }}
              >
                Send
              </button>
            </div>
          </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
    </>
  );
}
