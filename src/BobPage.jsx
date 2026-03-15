import { useState, useRef, useEffect, useCallback } from "react";
import { db } from "./firebase";
import { collection, query, where, onSnapshot, deleteDoc, doc } from "firebase/firestore";

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
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const streamingTextRef = useRef("");

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
    setMessages(conv.messages || []);
    setStreamingText("");
    setActiveTools([]);
  }, []);

  // Start new chat
  const newChat = useCallback(() => {
    setActiveConvId(null);
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

  // Send message
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

    try {
      const response = await fetch("/api/bob", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConvId,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          userId: currentUser.uid,
          hsToken: hsToken || localStorage.getItem("hs_token") || null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server error (${response.status})`);
      }

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
            setActiveConvId(data.id);
            break;
          case "error":
            streamingTextRef.current += `\n\n*Error: ${data.message}*`;
            setStreamingText(streamingTextRef.current);
            break;
          case "done":
            break;
        }
      }

      // Finalize assistant message
      const assistantMsg = { role: "assistant", content: streamingTextRef.current, timestamp: Date.now() };
      setMessages(prev => [...prev, assistantMsg]);
      setStreamingText("");
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: `Sorry, something went wrong: ${e.message}`, timestamp: Date.now() }]);
      setStreamingText("");
    } finally {
      setStreaming(false);
      setActiveTools([]);
    }
  }, [input, streaming, messages, activeConvId, currentUser, hsToken]);

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
                onClick={() => loadConversation(conv)}
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
                <span style={{
                  flex: 1, fontSize: 12, color: activeConvId === conv.id ? "#e2e8f0" : "#94a3b8",
                  fontFamily: "'DM Sans',sans-serif", overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {conv.title || "New conversation"}
                </span>
                <button
                  onClick={(e) => deleteConversation(conv.id, e)}
                  style={{
                    background: "none", border: "none", cursor: "pointer", padding: 2,
                    color: "#475569", opacity: 0, transition: "opacity 0.12s",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = "#ef4444"; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = 0; }}
                  ref={el => {
                    if (!el) return;
                    const parent = el.parentElement;
                    parent.addEventListener("mouseenter", () => el.style.opacity = "0.6");
                    parent.addEventListener("mouseleave", () => el.style.opacity = "0");
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  </svg>
                </button>
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
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", fontFamily: "'DM Sans',sans-serif" }}>Bob</div>
            <div style={{ fontSize: 10, color: "#64748b", fontFamily: "'DM Mono',monospace" }}>Revenue Operations Agent</div>
          </div>
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
    </div>
  );
}
