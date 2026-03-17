import { useState, useRef, useEffect, useCallback } from "react";
import { db } from "./firebase";
import { collection, query, where, onSnapshot, deleteDoc, doc, addDoc, updateDoc, setDoc, getDoc, serverTimestamp, getDocs } from "firebase/firestore";

// ─── Lightweight markdown renderer ──────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split("\n");
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      elements.push(
        <pre key={elements.length} style={{
          background: "#0f172a", border: "1px solid #334155", borderRadius: 8,
          padding: "12px 16px", margin: "8px 0", overflow: "auto",
          fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#e2e8f0", lineHeight: 1.6,
        }}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Headers
    if (line.startsWith("### ")) {
      elements.push(<div key={elements.length} style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", margin: "12px 0 4px" }}>{renderInline(line.slice(4))}</div>);
      i++; continue;
    }
    if (line.startsWith("## ")) {
      elements.push(<div key={elements.length} style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", margin: "14px 0 4px" }}>{renderInline(line.slice(3))}</div>);
      i++; continue;
    }
    if (line.startsWith("# ")) {
      elements.push(<div key={elements.length} style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", margin: "16px 0 6px" }}>{renderInline(line.slice(2))}</div>);
      i++; continue;
    }

    // Bullet lists
    if (/^[-*] /.test(line)) {
      elements.push(
        <div key={elements.length} style={{ display: "flex", gap: 8, margin: "2px 0", paddingLeft: 4 }}>
          <span style={{ color: "#64748b", flexShrink: 0 }}>•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      );
      i++; continue;
    }

    // Numbered lists
    const numMatch = line.match(/^(\d+)\.\s/);
    if (numMatch) {
      elements.push(
        <div key={elements.length} style={{ display: "flex", gap: 8, margin: "2px 0", paddingLeft: 4 }}>
          <span style={{ color: "#64748b", flexShrink: 0, fontFamily: "'DM Mono',monospace", fontSize: 11 }}>{numMatch[1]}.</span>
          <span>{renderInline(line.slice(numMatch[0].length))}</span>
        </div>
      );
      i++; continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={elements.length} style={{ border: "none", borderTop: "1px solid #334155", margin: "12px 0" }} />);
      i++; continue;
    }

    // Empty line
    if (!line.trim()) {
      elements.push(<div key={elements.length} style={{ height: 8 }} />);
      i++; continue;
    }

    // Regular paragraph
    elements.push(<div key={elements.length} style={{ margin: "2px 0", lineHeight: 1.65 }}>{renderInline(line)}</div>);
    i++;
  }

  return elements;
}

function renderInline(text) {
  // Bold, italic, inline code
  const parts = [];
  const regex = /(\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*)/g;
  let last = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2]) parts.push(<strong key={parts.length} style={{ fontWeight: 600, color: "#f1f5f9" }}>{match[2]}</strong>);
    else if (match[3]) parts.push(<code key={parts.length} style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 4, padding: "1px 5px", fontFamily: "'DM Mono',monospace", fontSize: "0.9em", color: "#a5f3fc" }}>{match[3]}</code>);
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
      let event = "message";
      let data = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (data) {
        try { yield { event, data: JSON.parse(data) }; } catch {}
      }
    }
  }
}

// ─── Chat message component ────────────────────────────────────────────────
function ChatMessage({ message, isUser }) {
  return (
    <div style={{
      display: "flex", justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 12, animation: "fadeUp 0.2s ease",
    }}>
      {!isUser && (
        <div style={{
          width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
          background: "linear-gradient(135deg, #06b6d4 0%, #6366f1 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginRight: 10, marginTop: 2,
          fontSize: 12, fontWeight: 700, color: "#fff",
        }}>B</div>
      )}
      <div style={{
        maxWidth: "75%", padding: "10px 14px", borderRadius: 12,
        fontSize: 13, lineHeight: 1.65, fontFamily: "'DM Sans',sans-serif",
        color: "#e2e8f0",
        ...(isUser
          ? { background: "rgba(99,102,241,0.15)", borderBottomRightRadius: 4 }
          : { background: "var(--surface)", border: "1px solid var(--border)", borderBottomLeftRadius: 4 }
        ),
      }}>
        {isUser ? message.content : renderMarkdown(message.content)}
      </div>
    </div>
  );
}

// ─── Tool indicator ─────────────────────────────────────────────────────────
function ToolIndicator({ tool }) {
  const labels = {
    list_deals: "Searching deals...",
    update_deal: "Updating deal...",
    create_deal: "Creating deal...",
    delete_deal: "Deleting deal...",
    list_events: "Loading events...",
    create_event: "Creating event...",
    list_outbound: "Loading outbound data...",
    create_outbound: "Logging outbound...",
    read_notes: "Reading notes...",
    update_notes: "Updating notes...",
    add_follow_up: "Scheduling follow-up...",
    complete_follow_up: "Completing follow-up...",
    search_hubspot_deals: "Searching HubSpot...",
    get_deal_contacts: "Loading contacts...",
    get_deal_notes: "Loading deal notes...",
    sync_hubspot: "Syncing HubSpot...",
  };

  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)",
      borderRadius: 20, padding: "5px 14px", marginBottom: 8, marginLeft: 38,
      fontSize: 11, color: "#67e8f9", fontFamily: "'DM Mono',monospace",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#06b6d4", animation: "pulse 1.5s infinite" }} />
      {tool.status === "running" ? (labels[tool.name] || tool.name) : `Done`}
    </div>
  );
}

// ─── Main BobPage component ─────────────────────────────────────────────────
export default function BobPage({ currentUser, hsToken }) {
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeTools, setActiveTools] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [callPhase, setCallPhase] = useState("idle"); // idle | listening | processing | speaking
  const [callSeconds, setCallSeconds] = useState(0);
  const [callTranscript, setCallTranscript] = useState([]);
  const [callLiveText, setCallLiveText] = useState("");
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const streamingTextRef = useRef("");
  const activeConvIdRef = useRef(null);
  const recognitionRef = useRef(null);
  const audioRef = useRef(null);
  const callActiveRef = useRef(false);
  const callTimerRef = useRef(null);
  const callTranscriptRef = useRef([]);
  const callMessagesRef = useRef([]);  // full messages for API context
  const callTranscriptEndRef = useRef(null);
  const [micLevel, setMicLevel] = useState(0);

  // ─── Speech Recognition setup ───────────────────────────────────────────
  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognitionRef.current = recognition;

    let finalTranscript = "";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setInput(finalTranscript + interim);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognition.onerror = () => {
      setListening(false);
    };

    recognition.start();
    setListening(true);
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  // ─── TTS playback ──────────────────────────────────────────────────────
  const playTTS = useCallback(async (text) => {
    if (!voiceEnabled || !text.trim()) return;

    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    // Strip markdown for cleaner speech
    const cleanText = text
      .replace(/```[\s\S]*?```/g, " code block omitted ")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/^#{1,3}\s/gm, "")
      .replace(/^[-*]\s/gm, "")
      .replace(/^\d+\.\s/gm, "")
      .replace(/---+/g, "")
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, " ")
      .trim();

    if (!cleanText) return;

    // Truncate very long responses to keep TTS reasonable
    const truncated = cleanText.length > 1000 ? cleanText.slice(0, 1000) + "..." : cleanText;

    setSpeaking(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: truncated }),
      });

      if (!res.ok) {
        console.error("TTS error:", res.status);
        setSpeaking(false);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        setSpeaking(false);
        URL.revokeObjectURL(url);
        audioRef.current = null;
      };

      audio.onerror = () => {
        setSpeaking(false);
        URL.revokeObjectURL(url);
        audioRef.current = null;
      };

      await audio.play();
    } catch (e) {
      console.error("TTS playback error:", e);
      setSpeaking(false);
    }
  }, [voiceEnabled]);

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setSpeaking(false);
  }, []);

  // ─── Call mode: TTS that returns a promise ─────────────────────────────
  // ─── Call mode: ElevenLabs Conversational AI ─────────────────────────
  const elevenConvRef = useRef(null);
  const micLevelPollRef = useRef(null);

  const startCall = useCallback(async () => {
    // Get signed WebSocket URL from our API
    console.log("[Bob Call] Getting signed URL...");
    let signedUrl, voiceId;
    try {
      const res = await fetch("/api/eleven-signed-url");
      if (!res.ok) throw new Error(`Failed to get signed URL: ${res.status}`);
      const data = await res.json();
      signedUrl = data.signed_url;
      voiceId = data.voice_id;
      console.log("[Bob Call] Got signed URL, voice:", voiceId);
    } catch (e) {
      console.error("[Bob Call] Signed URL error:", e);
      return;
    }

    callActiveRef.current = true;
    callMessagesRef.current = [...messages];
    callTranscriptRef.current = messages.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp || Date.now() }));
    setCallTranscript([...callTranscriptRef.current]);
    setInCall(true);
    setCallSeconds(0);
    setCallPhase("listening");
    setCallLiveText("");

    // Start call timer
    callTimerRef.current = setInterval(() => {
      setCallSeconds(s => s + 1);
    }, 1000);

    try {
      const { Conversation } = await import("@11labs/client");

      // Request mic permission before starting ElevenLabs session
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        console.log("[Bob Call] Mic permission granted");
      } catch (micErr) {
        console.error("[Bob Call] Mic permission denied:", micErr);
        callActiveRef.current = false;
        setInCall(false);
        setCallPhase("idle");
        return;
      }

      const conversation = await Conversation.startSession({
        signedUrl,
        // Voice is configured in the ElevenLabs agent dashboard
        clientTools: {
          // These tools let the agent query real platform data from Firestore
          list_deals: async () => {
            console.log("[Bob Call] Tool: list_deals");
            try {
              const snap = await getDocs(collection(db, "pipelineDeals"));
              const deals = snap.docs.map(d => {
                const data = d.data();
                return { name: data.name, value: data.value, bucket: data.bucket, expectedCloseMonth: data.expectedCloseMonth, confidence: data.manualConfidence ?? data.confidence, closedWon: data.closedWon || false, notes: data.notes };
              });
              const active = deals.filter(d => d.bucket === "active" && !d.closedWon);
              const totalValue = active.reduce((s, d) => s + (d.value || 0), 0);
              return `${deals.length} total deals. ${active.length} active deals worth $${totalValue.toLocaleString()}. Deals: ${active.map(d => `${d.name} ($${(d.value || 0).toLocaleString()}, close ${d.expectedCloseMonth || "TBD"}, ${d.confidence || 0}% confidence)`).join("; ")}`;
            } catch (e) { return "Error loading deals: " + e.message; }
          },
          list_events: async () => {
            console.log("[Bob Call] Tool: list_events");
            try {
              const snap = await getDocs(collection(db, "pipelineEvents"));
              const events = snap.docs.map(d => d.data());
              return events.length > 0
                ? `${events.length} events: ${events.map(e => `${e.name} (${e.date}, ${e.peopleMet || 0} people met, ${e.convertedToMeeting || 0} meetings)`).join("; ")}`
                : "No events tracked yet.";
            } catch (e) { return "Error loading events: " + e.message; }
          },
          list_outbound: async () => {
            console.log("[Bob Call] Tool: list_outbound");
            try {
              const snap = await getDocs(collection(db, "outboundActuals"));
              const entries = snap.docs.map(d => d.data()).sort((a, b) => (b.weekOf || "").localeCompare(a.weekOf || ""));
              const recent = entries.slice(0, 4);
              return recent.length > 0
                ? `Recent outbound (last ${recent.length} weeks): ${recent.map(e => `Week of ${e.weekOf}: ${e.touches || 0} touches, ${e.bookings || 0} bookings, ${e.held || 0} held, ${e.deals || 0} deals`).join("; ")}`
                : "No outbound activity logged yet.";
            } catch (e) { return "Error loading outbound: " + e.message; }
          },
          read_notes: async () => {
            console.log("[Bob Call] Tool: read_notes");
            try {
              if (!currentUser) return "No user logged in.";
              const snap = await getDocs(query(collection(db, "userNotes"), where("__name__", "==", currentUser.uid)));
              if (snap.empty) return "No notes yet.";
              const data = snap.docs[0].data();
              const blocks = data.blocks || [];
              const textBlocks = blocks.filter(b => b.content).map(b => {
                const prefix = b.type === "todo" ? (b.checked ? "[x] " : "[ ] ") : "";
                return prefix + b.content;
              });
              return textBlocks.length > 0
                ? `Notes (${data.title || "Untitled"}): ${textBlocks.slice(0, 15).join("; ")}`
                : "Notes document exists but is empty.";
            } catch (e) { return "Error loading notes: " + e.message; }
          },
          get_pipeline_summary: async () => {
            console.log("[Bob Call] Tool: get_pipeline_summary");
            try {
              const snap = await getDocs(collection(db, "pipelineDeals"));
              const deals = snap.docs.map(d => d.data());
              const buckets = {};
              deals.forEach(d => {
                if (d.closedWon) return;
                const b = d.bucket || "untagged";
                if (!buckets[b]) buckets[b] = { count: 0, value: 0 };
                buckets[b].count++;
                buckets[b].value += d.value || 0;
              });
              const won = deals.filter(d => d.closedWon);
              const wonValue = won.reduce((s, d) => s + (d.value || 0), 0);
              let summary = `Pipeline summary: ${won.length} closed won ($${wonValue.toLocaleString()}).`;
              for (const [bucket, data] of Object.entries(buckets)) {
                summary += ` ${bucket}: ${data.count} deals worth $${data.value.toLocaleString()}.`;
              }
              return summary;
            } catch (e) { return "Error loading pipeline: " + e.message; }
          },
          update_notes: async ({ title, blocks }) => {
            console.log("[Bob Call] Tool: update_notes");
            try {
              if (!currentUser) return "No user logged in.";
              const updates = { updatedAt: Date.now() };
              if (title !== undefined) updates.title = title;
              if (blocks !== undefined) updates.blocks = blocks;
              await setDoc(doc(db, "userNotes", currentUser.uid), updates, { merge: true });
              return "Notes updated successfully.";
            } catch (e) { return "Error updating notes: " + e.message; }
          },
          add_follow_up: async ({ dealId, dealName, date, todoText }) => {
            console.log("[Bob Call] Tool: add_follow_up");
            try {
              if (!currentUser) return "No user logged in.";
              const ref = doc(db, "userNotes", currentUser.uid);
              const snap = await getDoc(ref);
              const followUps = snap.exists() ? (snap.data().followUps || {}) : {};
              const key = `${dealName.replace(/\s+/g, "_")}_${Date.now()}`;
              followUps[key] = { dealId: dealId || null, dealName, date, todoText, completed: false };
              await setDoc(ref, { followUps }, { merge: true });
              return `Follow-up scheduled for ${dealName} on ${date}: ${todoText}`;
            } catch (e) { return "Error adding follow-up: " + e.message; }
          },
          complete_follow_up: async ({ followUpKey }) => {
            console.log("[Bob Call] Tool: complete_follow_up");
            try {
              if (!currentUser) return "No user logged in.";
              const ref = doc(db, "userNotes", currentUser.uid);
              const snap = await getDoc(ref);
              if (!snap.exists()) return "No notes document found.";
              const followUps = snap.data().followUps || {};
              if (!followUps[followUpKey]) return "Follow-up not found.";
              followUps[followUpKey].completed = true;
              await setDoc(ref, { followUps }, { merge: true });
              return "Follow-up marked as completed.";
            } catch (e) { return "Error completing follow-up: " + e.message; }
          },
          update_deal: async ({ dealId, updates }) => {
            console.log("[Bob Call] Tool: update_deal");
            try {
              const ref = doc(db, "pipelineDeals", dealId);
              await updateDoc(ref, { ...updates, updatedAt: serverTimestamp() });
              return `Deal updated successfully.`;
            } catch (e) { return "Error updating deal: " + e.message; }
          },
          create_deal: async ({ name, value, bucket, expectedCloseMonth, notes, funnelType }) => {
            console.log("[Bob Call] Tool: create_deal");
            try {
              const ref = await addDoc(collection(db, "pipelineDeals"), {
                source: "bob", hubspotId: null, name, value: value || 0,
                bucket: bucket || "untagged", expectedCloseMonth: expectedCloseMonth || "",
                manualConfidence: 30, useAlgoConfidence: false, closedWon: false,
                funnelType: funnelType || "outbound", funnelEventId: null,
                meetingBooked: false, lastActivityDate: null, touchCount: 0,
                notes: notes || "", hubspotStage: null, hubspotPipeline: null,
                hubspotStageProbability: null,
                createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
              });
              return `Deal "${name}" created successfully.`;
            } catch (e) { return "Error creating deal: " + e.message; }
          },
          delete_deal: async ({ dealId }) => {
            console.log("[Bob Call] Tool: delete_deal");
            try {
              await deleteDoc(doc(db, "pipelineDeals", dealId));
              return "Deal deleted successfully.";
            } catch (e) { return "Error deleting deal: " + e.message; }
          },
          create_event: async ({ name, date, peopleMet, convertedToMeeting }) => {
            console.log("[Bob Call] Tool: create_event");
            try {
              await addDoc(collection(db, "pipelineEvents"), {
                name, date, peopleMet: peopleMet || 0, convertedToMeeting: convertedToMeeting || 0,
                dealsWon: 0, dealValue: 0, createdAt: serverTimestamp(),
              });
              return `Event "${name}" created successfully.`;
            } catch (e) { return "Error creating event: " + e.message; }
          },
          create_outbound: async ({ weekOf, touches, bookings, held, deals }) => {
            console.log("[Bob Call] Tool: create_outbound");
            try {
              await addDoc(collection(db, "outboundActuals"), {
                weekOf, touches: touches || 0, bookings: bookings || 0,
                held: held || 0, deals: deals || 0, createdAt: serverTimestamp(),
              });
              return `Outbound activity logged for week of ${weekOf}.`;
            } catch (e) { return "Error logging outbound: " + e.message; }
          },
        },
        onConnect: () => {
          console.log("[Bob Call] ElevenLabs connected");
          setCallPhase("listening");
        },
        onDisconnect: (details) => {
          console.log("[Bob Call] ElevenLabs disconnected, details:", JSON.stringify(details));
          if (callActiveRef.current) {
            callActiveRef.current = false;
            setInCall(false);
            setCallPhase("idle");
          }
        },
        onMessage: (msg) => {
          console.log("[Bob Call] Message:", JSON.stringify(msg));
          if (msg.source === "user" && msg.message) {
            callTranscriptRef.current = [...callTranscriptRef.current, { role: "user", content: msg.message, timestamp: Date.now() }];
            setCallTranscript([...callTranscriptRef.current]);
            callMessagesRef.current = [...callMessagesRef.current, { role: "user", content: msg.message }];
          } else if (msg.source === "ai" && msg.message) {
            callTranscriptRef.current = [...callTranscriptRef.current, { role: "assistant", content: msg.message, timestamp: Date.now() }];
            setCallTranscript([...callTranscriptRef.current]);
            callMessagesRef.current = [...callMessagesRef.current, { role: "assistant", content: msg.message }];
          }
        },
        onError: (err) => {
          console.error("[Bob Call] ElevenLabs error:", JSON.stringify(err));
        },
        onStatusChange: (status) => {
          console.log("[Bob Call] Status:", status);
        },
        onModeChange: (mode) => {
          console.log("[Bob Call] Mode:", mode.mode);
          if (mode.mode === "speaking") {
            setCallPhase("speaking");
            setSpeaking(true);
          } else {
            setCallPhase("listening");
            setSpeaking(false);
          }
        },
      });

      elevenConvRef.current = conversation;
      console.log("[Bob Call] Session started, conversation ID:", conversation.getId());

      // Poll mic level from the ElevenLabs SDK
      micLevelPollRef.current = setInterval(() => {
        if (elevenConvRef.current) {
          const vol = elevenConvRef.current.getInputVolume();
          setMicLevel(vol);
        }
      }, 100);

    } catch (e) {
      console.error("[Bob Call] Failed to start ElevenLabs session:", e);
      callActiveRef.current = false;
      setInCall(false);
      setCallPhase("idle");
    }
  }, [messages]);

  // ─── End call ─────────────────────────────────────────────────────────
  const endCall = useCallback(async () => {
    callActiveRef.current = false;

    if (micLevelPollRef.current) {
      clearInterval(micLevelPollRef.current);
      micLevelPollRef.current = null;
    }
    if (elevenConvRef.current) {
      try { await elevenConvRef.current.endSession(); } catch (_) { /* ignore */ }
      elevenConvRef.current = null;
    }
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setSpeaking(false);
    setInCall(false);
    setCallPhase("idle");
    setCallLiveText("");
    setCallSeconds(0);
    setMicLevel(0);

    // Sync call messages back to chat and save to Firestore
    if (callMessagesRef.current.length > 0) {
      setMessages([...callMessagesRef.current]);

      // Save conversation to Firestore
      try {
        const convId = activeConvIdRef.current;
        const msgData = callMessagesRef.current.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp || Date.now() }));
        if (convId) {
          await updateDoc(doc(db, "bobConversations", convId), { messages: msgData, updatedAt: serverTimestamp() });
        } else {
          const firstUserMsg = callMessagesRef.current.find(m => m.role === "user");
          const title = "Voice Call — " + (firstUserMsg?.content?.slice(0, 40) || "Untitled");
          const newDoc = await addDoc(collection(db, "bobConversations"), {
            userId: currentUser.uid, title, messages: msgData,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          });
          setActiveConvId(newDoc.id);
          activeConvIdRef.current = newDoc.id;
        }
      } catch (e) { console.error("Conv save error:", e); }
    }
  }, [currentUser]);

  // Auto-scroll call transcript
  useEffect(() => {
    if (inCall) {
      callTranscriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [callTranscript, callLiveText, inCall]);

  // Load conversations list
  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, "bobConversations"),
      where("userId", "==", currentUser.uid)
    );
    const unsub = onSnapshot(q, snap => {
      const convs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      convs.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
      setConversations(convs);
    }, err => {
      console.error("bobConversations onSnapshot error:", err);
      getDocs(q).then(snap => {
        const convs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        convs.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
        setConversations(convs);
      }).catch(e => console.error("bobConversations getDocs fallback error:", e));
    });
    return unsub;
  }, [currentUser]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, activeTools]);

  // Load conversation messages when switching
  const loadConversation = useCallback((conv) => {
    setActiveConvId(conv.id);
    activeConvIdRef.current = conv.id;
    setMessages(conv.messages || []);
    setStreamingText("");
    setActiveTools([]);
  }, []);

  // Start new chat
  const newChat = useCallback(() => {
    setActiveConvId(null);
    activeConvIdRef.current = null;
    setMessages([]);
    setStreamingText("");
    setActiveTools([]);
    setInput("");
    inputRef.current?.focus();
  }, []);

  // Delete conversation
  const deleteConversation = useCallback(async (convId, e) => {
    e.stopPropagation();
    await deleteDoc(doc(db, "bobConversations", convId));
    if (activeConvId === convId) newChat();
  }, [activeConvId, newChat]);

  // Rename conversation
  const [editingConvId, setEditingConvId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const renameInputRef = useRef(null);

  const startRename = useCallback((conv, e) => {
    e.stopPropagation();
    setEditingConvId(conv.id);
    setEditingTitle(conv.title || "");
  }, []);

  const commitRename = useCallback(async () => {
    if (!editingConvId) return;
    const trimmed = editingTitle.trim();
    if (trimmed) {
      setConversations(prev => prev.map(c => c.id === editingConvId ? { ...c, title: trimmed } : c));
      if (!editingConvId.startsWith("local_")) {
        try {
          await updateDoc(doc(db, "bobConversations", editingConvId), { title: trimmed });
        } catch (e) {
          console.error("Rename error:", e);
        }
      }
    }
    setEditingConvId(null);
    setEditingTitle("");
  }, [editingConvId, editingTitle]);

  const cancelRename = useCallback(() => {
    setEditingConvId(null);
    setEditingTitle("");
  }, []);

  useEffect(() => {
    if (editingConvId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingConvId]);

  // Send message
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text) return;

    // If streaming got stuck from a previous request, force-reset it
    if (streaming) {
      console.warn("[Bob] streaming was stuck, force-resetting");
      setStreaming(false);
      setStreamingText("");
      setActiveTools([]);
      streamingTextRef.current = "";
      // Let the reset take effect before proceeding
      return;
    }

    const userMsg = { role: "user", content: text, timestamp: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);
    setStreamingText("");
    setActiveTools([]);
    streamingTextRef.current = "";

    // Create or update conversation in Firestore from the client BEFORE calling the API
    let convId = activeConvIdRef.current;
    const msgData = newMessages.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp || Date.now() }));
    if (!convId) {
      const title = text.slice(0, 60);
      try {
        const newDoc = await addDoc(collection(db, "bobConversations"), {
          userId: currentUser.uid,
          title,
          messages: msgData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        convId = newDoc.id;
        setActiveConvId(convId);
        activeConvIdRef.current = convId;
        // Always add to local state so sidebar updates even if onSnapshot isn't active
        setConversations(prev => {
          if (prev.some(c => c.id === convId)) return prev;
          return [{
            id: convId,
            title,
            messages: msgData,
            userId: currentUser.uid,
            updatedAt: { seconds: Date.now() / 1000 },
            createdAt: { seconds: Date.now() / 1000 },
          }, ...prev];
        });
      } catch (e) {
        console.error("Conversation create error:", e);
        // Firestore write failed — add to local state directly as fallback
        const localId = "local_" + Date.now();
        convId = localId;
        setActiveConvId(localId);
        activeConvIdRef.current = localId;
        setConversations(prev => [{
          id: localId,
          title,
          messages: msgData,
          userId: currentUser.uid,
          updatedAt: { seconds: Date.now() / 1000 },
          createdAt: { seconds: Date.now() / 1000 },
        }, ...prev]);
      }
    } else {
      try {
        await updateDoc(doc(db, "bobConversations", convId), {
          messages: msgData,
          updatedAt: serverTimestamp(),
        });
      } catch (e) {
        console.error("Conversation update error:", e);
      }
    }

    // Use AbortController to prevent hanging requests (60s timeout)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      console.log("[Bob] Sending message to /api/bob...", { convId, messageCount: newMessages.length });
      const response = await fetch("/api/bob", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: convId,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          userId: currentUser.uid,
          hsToken: hsToken || localStorage.getItem("hs_token") || null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`Server error (${response.status}): ${errText.slice(0, 200)}`);
      }

      console.log("[Bob] Response OK, parsing SSE stream...");
      for await (const { event, data } of parseSSE(response)) {
        switch (event) {
          case "delta":
            streamingTextRef.current += data.text;
            setStreamingText(streamingTextRef.current);
            break;
          case "tool":
            setActiveTools(prev => {
              const existing = prev.findIndex(t => t.name === data.name);
              if (data.status === "done" || data.status === "error") {
                return prev.filter((_, i) => i !== existing);
              }
              if (existing >= 0) return prev;
              return [...prev, data];
            });
            break;
          case "conversation":
            // Backend may send this — update ref if different
            if (data.id && data.id !== activeConvIdRef.current) {
              setActiveConvId(data.id);
              activeConvIdRef.current = data.id;
            }
            break;
          case "error":
            streamingTextRef.current += `\n\n*Error: ${data.message}*`;
            setStreamingText(streamingTextRef.current);
            break;
          case "done":
            break;
        }
      }

      console.log("[Bob] Stream complete, finalizing...");

      // Finalize assistant message
      const assistantMsg = { role: "assistant", content: streamingTextRef.current || "(No response received)", timestamp: Date.now() };
      const finalMessages = [...newMessages, assistantMsg];
      setMessages(finalMessages);
      setStreamingText("");

      // Auto-play TTS if voice mode is on
      playTTS(streamingTextRef.current);

      // Save final messages (with assistant response) to Firestore + local state
      const finalConvId = activeConvIdRef.current;
      if (finalConvId) {
        const finalMsgData = finalMessages.map(m => ({ role: m.role, content: m.content, timestamp: m.timestamp || Date.now() }));
        // Always update local state so sidebar stays current
        setConversations(prev => prev.map(c =>
          c.id === finalConvId
            ? { ...c, messages: finalMsgData, updatedAt: { seconds: Date.now() / 1000 } }
            : c
        ));
        // Also persist to Firestore
        if (!finalConvId.startsWith("local_")) {
          try {
            await updateDoc(doc(db, "bobConversations", finalConvId), {
              messages: finalMsgData,
              updatedAt: serverTimestamp(),
            });
          } catch (e) {
            console.error("Conversation update error:", e);
          }
        }
      }
    } catch (e) {
      console.error("[Bob] sendMessage error:", e);
      const errMsg = e.name === "AbortError"
        ? "Request timed out — please try again."
        : `Sorry, something went wrong: ${e.message}`;
      setMessages(prev => [...prev, { role: "assistant", content: errMsg, timestamp: Date.now() }]);
      setStreamingText("");
    } finally {
      clearTimeout(timeout);
      setStreaming(false);
      setActiveTools([]);
    }
  }, [input, streaming, messages, activeConvId, currentUser, hsToken, playTTS]);

  // Handle Enter key
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes voiceBar { from{height:4px} to{height:14px} }
        @keyframes micPulse { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.4)} 50%{box-shadow:0 0 0 8px rgba(239,68,68,0)} }
        @keyframes callRing { 0%{transform:translate(-50%,-50%) scale(0.8);opacity:0.6} 100%{transform:translate(-50%,-50%) scale(1.3);opacity:0} }
        .conv-row:hover .conv-action-btn { opacity: 0.6 !important; }
        .conv-action-btn:hover { opacity: 1 !important; }
      `}</style>

      {/* Conversation sidebar */}
      {sidebarOpen && (
        <div style={{
          width: 240, flexShrink: 0, borderRight: "1px solid var(--border)",
          background: "var(--surface-deep)", display: "flex", flexDirection: "column",
          height: "100%",
        }}>
          <div style={{ padding: "16px 12px", borderBottom: "1px solid var(--border)" }}>
            <button
              onClick={newChat}
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 8,
                background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.25)",
                color: "#67e8f9", fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: "'DM Sans',sans-serif", transition: "all 0.15s",
                display: "flex", alignItems: "center", gap: 6, justifyContent: "center",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(6,182,212,0.18)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(6,182,212,0.1)"; }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              New Chat
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {conversations.map(conv => (
              <div
                key={conv.id}
                className="conv-row"
                onClick={() => { if (editingConvId !== conv.id) loadConversation(conv); }}
                style={{
                  padding: "10px 12px", cursor: "pointer",
                  background: activeConvId === conv.id ? "rgba(6,182,212,0.08)" : "transparent",
                  borderLeft: activeConvId === conv.id ? "2px solid #06b6d4" : "2px solid transparent",
                  transition: "all 0.12s",
                  display: "flex", alignItems: "center", gap: 8,
                }}
                onMouseEnter={e => { if (activeConvId !== conv.id) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                onMouseLeave={e => { if (activeConvId !== conv.id) e.currentTarget.style.background = "transparent"; }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M2 3a1 1 0 011-1h6a1 1 0 011 1v5a1 1 0 01-1 1H5l-2 1.5V9H3a1 1 0 01-1-1V3z" stroke="#64748b" strokeWidth="1.2"/>
                </svg>
                {editingConvId === conv.id ? (
                  <input
                    ref={renameInputRef}
                    value={editingTitle}
                    onChange={e => setEditingTitle(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") cancelRename();
                    }}
                    onClick={e => e.stopPropagation()}
                    style={{
                      flex: 1, fontSize: 12, color: "#e2e8f0",
                      fontFamily: "'DM Sans',sans-serif",
                      background: "#0f172a", border: "1px solid #06b6d4", borderRadius: 4,
                      padding: "2px 6px", outline: "none", minWidth: 0,
                    }}
                  />
                ) : (
                  <span
                    onDoubleClick={e => startRename(conv, e)}
                    style={{
                      flex: 1, fontSize: 12, color: activeConvId === conv.id ? "#e2e8f0" : "#94a3b8",
                      fontFamily: "'DM Sans',sans-serif", overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {conv.title || "New conversation"}
                  </span>
                )}
                {editingConvId !== conv.id && (
                  <>
                    {/* Rename button */}
                    <button
                      onClick={e => startRename(conv, e)}
                      className="conv-action-btn"
                      style={{
                        background: "none", border: "none", cursor: "pointer", padding: 2,
                        color: "#475569", opacity: 0, transition: "opacity 0.12s", flexShrink: 0,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = "#06b6d4"; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = 0; }}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M7.5 1.5l1 1-5.5 5.5H2V7L7.5 1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                    {/* Delete button */}
                    <button
                      onClick={e => deleteConversation(conv.id, e)}
                      className="conv-action-btn"
                      style={{
                        background: "none", border: "none", cursor: "pointer", padding: 2,
                        color: "#475569", opacity: 0, transition: "opacity 0.12s", flexShrink: 0,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = "#ef4444"; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = 0; }}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                      </svg>
                    </button>
                  </>
                )}
              </div>
            ))}
            {conversations.length === 0 && (
              <div style={{ padding: "20px 16px", fontSize: 11, color: "#475569", textAlign: "center", fontFamily: "'DM Sans',sans-serif" }}>
                No conversations yet
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Chat header */}
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 12,
          background: "var(--surface-deep)",
        }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: 4,
              color: "#64748b", display: "flex",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          <div style={{
            width: 24, height: 24, borderRadius: "50%",
            background: "linear-gradient(135deg, #06b6d4 0%, #6366f1 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 700, color: "#fff",
          }}>B</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", fontFamily: "'DM Sans',sans-serif" }}>Bob</div>
            <div style={{ fontSize: 10, color: "#64748b", fontFamily: "'DM Mono',monospace" }}>Revenue Operations Agent</div>
          </div>

          {/* Call button */}
          {typeof MediaRecorder !== "undefined" && (
            <button
              onClick={startCall}
              title="Start voice call with Bob"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 12px", borderRadius: 8,
                background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.3)",
                color: "#4ade80", fontSize: 11, fontFamily: "'DM Mono',monospace",
                cursor: "pointer", transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(74,222,128,0.18)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(74,222,128,0.1)"; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
              </svg>
              Call
            </button>
          )}

          {/* Voice mode toggle */}
          <button
            onClick={() => {
              if (voiceEnabled) { stopSpeaking(); setVoiceEnabled(false); }
              else setVoiceEnabled(true);
            }}
            title={voiceEnabled ? "Disable voice" : "Enable voice"}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 10px", borderRadius: 8,
              background: voiceEnabled ? "rgba(6,182,212,0.12)" : "transparent",
              border: `1px solid ${voiceEnabled ? "rgba(6,182,212,0.3)" : "#334155"}`,
              color: voiceEnabled ? "#67e8f9" : "#64748b",
              fontSize: 11, fontFamily: "'DM Mono',monospace",
              cursor: "pointer", transition: "all 0.15s",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {voiceEnabled ? (
                <>
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                  <path d="M15.54 8.46a5 5 0 010 7.07" />
                  <path d="M19.07 4.93a10 10 0 010 14.14" />
                </>
              ) : (
                <>
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </>
              )}
            </svg>
            {voiceEnabled ? "Voice On" : "Voice Off"}
          </button>

          {/* Speaking indicator */}
          {speaking && (
            <div style={{
              display: "flex", alignItems: "center", gap: 5,
              fontSize: 10, color: "#67e8f9", fontFamily: "'DM Mono',monospace",
            }}>
              <span style={{ display: "flex", gap: 2, alignItems: "center" }}>
                {[0, 1, 2, 3].map(i => (
                  <span key={i} style={{
                    width: 2, background: "#06b6d4", borderRadius: 1,
                    animation: `voiceBar 0.8s ease-in-out ${i * 0.15}s infinite alternate`,
                  }} />
                ))}
              </span>
              <button
                onClick={stopSpeaking}
                style={{
                  background: "none", border: "none", color: "#64748b",
                  cursor: "pointer", fontSize: 10, padding: "0 2px",
                  fontFamily: "'DM Mono',monospace",
                }}
              >
                Stop
              </button>
            </div>
          )}
        </div>

        {/* Messages area */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {messages.length === 0 && !streamingText && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              height: "100%", textAlign: "center", padding: "40px 20px",
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "linear-gradient(135deg, #06b6d4 0%, #6366f1 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 20,
              }}>B</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8, fontFamily: "'DM Sans',sans-serif" }}>
                Hey, I'm Bob
              </div>
              <div style={{ fontSize: 13, color: "#64748b", maxWidth: 360, lineHeight: 1.65, fontFamily: "'DM Sans',sans-serif" }}>
                Ask me anything about your pipeline, deals, notes, or follow-ups. I can search, update, create, and manage all your platform data.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 24, justifyContent: "center" }}>
                {["What deals are closing this month?", "Show my active pipeline", "Schedule a follow-up", "Sync from HubSpot"].map(s => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); inputRef.current?.focus(); }}
                    style={{
                      padding: "6px 12px", borderRadius: 8, fontSize: 11,
                      background: "var(--surface)", border: "1px solid var(--border)",
                      color: "#94a3b8", cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "#06b6d4"; e.currentTarget.style.color = "#67e8f9"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "#94a3b8"; }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatMessage key={i} message={msg} isUser={msg.role === "user"} />
          ))}

          {/* Active tool indicators */}
          {activeTools.map((tool, i) => (
            <ToolIndicator key={`${tool.name}-${i}`} tool={tool} />
          ))}

          {/* Streaming response */}
          {streamingText && (
            <div style={{
              display: "flex", justifyContent: "flex-start", marginBottom: 12,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                background: "linear-gradient(135deg, #06b6d4 0%, #6366f1 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                marginRight: 10, marginTop: 2,
                fontSize: 12, fontWeight: 700, color: "#fff",
              }}>B</div>
              <div style={{
                maxWidth: "75%", padding: "10px 14px", borderRadius: 12,
                borderBottomLeftRadius: 4,
                fontSize: 13, lineHeight: 1.65, fontFamily: "'DM Sans',sans-serif",
                color: "#e2e8f0", background: "var(--surface)", border: "1px solid var(--border)",
              }}>
                {renderMarkdown(streamingText)}
                <span style={{
                  display: "inline-block", width: 6, height: 14,
                  background: "#06b6d4", borderRadius: 1, marginLeft: 2,
                  animation: "pulse 0.8s infinite", verticalAlign: "middle",
                }} />
              </div>
            </div>
          )}

          {/* Typing indicator when waiting for first token */}
          {streaming && !streamingText && activeTools.length === 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, marginLeft: 38 }}>
              <div style={{ display: "flex", gap: 4 }}>
                {[0, 1, 2].map(i => (
                  <span key={i} style={{
                    width: 5, height: 5, borderRadius: "50%", background: "#06b6d4",
                    animation: `pulse 1.2s infinite ${i * 0.2}s`,
                  }} />
                ))}
              </div>
              <span style={{ fontSize: 11, color: "#475569", fontFamily: "'DM Mono',monospace" }}>Bob is thinking...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div style={{
          padding: "12px 24px 16px", borderTop: "1px solid var(--border)",
          background: "var(--surface-deep)",
        }}>
          <div style={{
            display: "flex", alignItems: "flex-end", gap: 10,
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 12, padding: "8px 12px",
            transition: "border-color 0.15s",
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Bob anything..."
              rows={1}
              style={{
                flex: 1, resize: "none", border: "none", outline: "none",
                background: "transparent", color: "#e2e8f0", fontSize: 13,
                fontFamily: "'DM Sans',sans-serif", lineHeight: 1.5,
                maxHeight: 120, minHeight: 20, padding: "2px 0",
              }}
              onInput={e => {
                e.target.style.height = "20px";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
            />
            {/* Mic button */}
            {(window.SpeechRecognition || window.webkitSpeechRecognition) && (
              <button
                onClick={() => {
                  if (listening) {
                    stopListening();
                  } else {
                    startListening();
                  }
                }}
                disabled={streaming}
                title={listening ? "Stop listening" : "Start voice input"}
                style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: listening ? "rgba(239,68,68,0.15)" : "transparent",
                  border: listening ? "1px solid rgba(239,68,68,0.4)" : "1px solid #334155",
                  color: listening ? "#ef4444" : "#64748b",
                  cursor: streaming ? "default" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                  animation: listening ? "micPulse 1.5s infinite" : "none",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="1" width="6" height="12" rx="3" fill={listening ? "currentColor" : "none"} />
                  <path d="M19 10v2a7 7 0 01-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
            )}

            {/* Send button */}
            <button
              onClick={sendMessage}
              disabled={!input.trim() || streaming}
              style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: input.trim() && !streaming ? "#06b6d4" : "#1e293b",
                border: "none", cursor: input.trim() && !streaming ? "pointer" : "default",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7l4.5-4.5M2 7l4.5 4.5M2 7h10" stroke={input.trim() && !streaming ? "#fff" : "#475569"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(180 7 7)"/>
              </svg>
            </button>
          </div>
          <div style={{ fontSize: 10, color: "#334155", textAlign: "center", marginTop: 6, fontFamily: "'DM Mono',monospace" }}>
            Bob can read and modify your platform data. Press Enter to send, Shift+Enter for new line.
          </div>
        </div>
      </div>

      {/* ─── Call Mode Overlay ──────────────────────────────────────────── */}
      {inCall && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "#09090e", display: "flex",
          fontFamily: "'DM Sans',sans-serif",
        }}>
          {/* Left panel — call visual */}
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            position: "relative",
          }}>
            {/* Call timer */}
            <div style={{
              position: "absolute", top: 24, left: "50%", transform: "translateX(-50%)",
              fontSize: 13, color: "#64748b", fontFamily: "'DM Mono',monospace",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", animation: "pulse 2s infinite" }} />
              {Math.floor(callSeconds / 60).toString().padStart(2, "0")}:{(callSeconds % 60).toString().padStart(2, "0")}
            </div>

            {/* Bob avatar with rings */}
            <div style={{ position: "relative", marginBottom: 32 }}>
              {callPhase === "speaking" && [80, 100, 120].map((size, i) => (
                <div key={i} style={{
                  position: "absolute",
                  width: size, height: size,
                  borderRadius: "50%",
                  border: "1px solid rgba(6,182,212,0.15)",
                  top: "50%", left: "50%",
                  transform: "translate(-50%, -50%)",
                  animation: `callRing 2s ease-out ${i * 0.4}s infinite`,
                }} />
              ))}
              {callPhase === "listening" && [80, 100, 120].map((size, i) => (
                <div key={i} style={{
                  position: "absolute",
                  width: size, height: size,
                  borderRadius: "50%",
                  border: "1px solid rgba(99,102,241,0.15)",
                  top: "50%", left: "50%",
                  transform: "translate(-50%, -50%)",
                  animation: `callRing 2.5s ease-out ${i * 0.5}s infinite`,
                }} />
              ))}
              <div style={{
                width: 64, height: 64, borderRadius: "50%",
                background: "linear-gradient(135deg, #06b6d4 0%, #6366f1 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 26, fontWeight: 700, color: "#fff",
                position: "relative", zIndex: 1,
              }}>B</div>
            </div>

            {/* Phase label */}
            <div style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9", marginBottom: 6 }}>Bob</div>
            <div style={{
              fontSize: 12, color:
                callPhase === "listening" ? "#a78bfa" :
                callPhase === "processing" ? "#67e8f9" :
                callPhase === "speaking" ? "#4ade80" : "#64748b",
              fontFamily: "'DM Mono',monospace",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              {callPhase === "listening" && (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="1" width="6" height="12" rx="3" fill="currentColor" />
                    <path d="M19 10v2a7 7 0 01-14 0v-2" />
                  </svg>
                  Listening...
                </>
              )}
              {callPhase === "processing" && (
                <>
                  <span style={{ display: "flex", gap: 3 }}>
                    {[0, 1, 2].map(i => (
                      <span key={i} style={{
                        width: 4, height: 4, borderRadius: "50%", background: "#06b6d4",
                        animation: `pulse 1.2s infinite ${i * 0.2}s`,
                      }} />
                    ))}
                  </span>
                  Thinking...
                </>
              )}
              {callPhase === "speaking" && (
                <>
                  <span style={{ display: "flex", gap: 2, alignItems: "center" }}>
                    {[0, 1, 2, 3, 4].map(i => (
                      <span key={i} style={{
                        width: 2, borderRadius: 1, background: "#4ade80",
                        animation: `voiceBar 0.6s ease-in-out ${i * 0.1}s infinite alternate`,
                      }} />
                    ))}
                  </span>
                  Speaking...
                </>
              )}
            </div>

            {/* Mic level visualizer */}
            {callPhase === "listening" && (
              <div style={{
                display: "flex", alignItems: "flex-end", gap: 3,
                height: 32, marginTop: 20, marginBottom: 4,
              }}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => {
                  const barCenter = 4; // center bar index
                  const dist = Math.abs(i - barCenter);
                  const scale = Math.max(0, micLevel - dist * 0.08);
                  const h = 4 + scale * 28;
                  return (
                    <div key={i} style={{
                      width: 3, borderRadius: 2,
                      height: h,
                      background: micLevel > 0.1 ? `rgba(167,139,250,${0.4 + scale * 0.6})` : "rgba(100,116,139,0.3)",
                      transition: "height 0.08s ease, background 0.08s ease",
                    }} />
                  );
                })}
              </div>
            )}

            {/* Live speech preview */}
            {callLiveText && callPhase === "listening" && (
              <div style={{
                marginTop: 12, padding: "10px 20px", borderRadius: 12,
                background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)",
                maxWidth: 400, fontSize: 13, color: "#c4b5fd", lineHeight: 1.6,
                textAlign: "center", fontStyle: "italic",
              }}>
                {callLiveText}
              </div>
            )}

            {/* Hang up button */}
            <button
              onClick={endCall}
              style={{
                position: "absolute", bottom: 40,
                width: 56, height: 56, borderRadius: "50%",
                background: "#ef4444", border: "none",
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.15s",
                boxShadow: "0 0 20px rgba(239,68,68,0.3)",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "#dc2626"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#ef4444"; }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" transform="rotate(135 12 12)"/>
              </svg>
            </button>
          </div>

          {/* Right panel — transcript */}
          <div style={{
            width: 360, borderLeft: "1px solid #1e293b",
            display: "flex", flexDirection: "column",
            background: "#0f172a",
          }}>
            <div style={{
              padding: "16px 20px", borderBottom: "1px solid #1e293b",
              fontSize: 12, fontWeight: 600, color: "#94a3b8",
              fontFamily: "'DM Mono',monospace",
            }}>
              Transcript
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
              {callTranscript.map((entry, i) => (
                <div key={i} style={{
                  marginBottom: 16, animation: "fadeUp 0.2s ease",
                }}>
                  <div style={{
                    fontSize: 10, fontWeight: 600, marginBottom: 4,
                    color: entry.role === "user" ? "#a78bfa" : "#67e8f9",
                    fontFamily: "'DM Mono',monospace",
                    textTransform: "uppercase",
                  }}>
                    {entry.role === "user" ? "You" : "Bob"}
                  </div>
                  <div style={{
                    fontSize: 12, color: "#e2e8f0", lineHeight: 1.65,
                    padding: "8px 12px", borderRadius: 8,
                    background: entry.role === "user" ? "rgba(99,102,241,0.08)" : "rgba(6,182,212,0.06)",
                    border: `1px solid ${entry.role === "user" ? "rgba(99,102,241,0.15)" : "rgba(6,182,212,0.12)"}`,
                  }}>
                    {entry.role === "assistant" ? renderMarkdown(entry.content) : entry.content}
                  </div>
                </div>
              ))}

              {/* Live listening preview in transcript */}
              {callLiveText && callPhase === "listening" && (
                <div style={{ marginBottom: 16, animation: "fadeUp 0.2s ease" }}>
                  <div style={{
                    fontSize: 10, fontWeight: 600, marginBottom: 4,
                    color: "#a78bfa", fontFamily: "'DM Mono',monospace",
                    textTransform: "uppercase",
                  }}>You</div>
                  <div style={{
                    fontSize: 12, color: "#c4b5fd", lineHeight: 1.65,
                    padding: "8px 12px", borderRadius: 8,
                    background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)",
                    fontStyle: "italic",
                  }}>
                    {callLiveText}
                    <span style={{
                      display: "inline-block", width: 4, height: 12,
                      background: "#a78bfa", borderRadius: 1, marginLeft: 2,
                      animation: "pulse 0.8s infinite", verticalAlign: "middle",
                    }} />
                  </div>
                </div>
              )}

              <div ref={callTranscriptEndRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
