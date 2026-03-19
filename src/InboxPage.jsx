import { useState, useEffect, useCallback, useRef } from "react";
import { db } from "./firebase";
import { collection, addDoc, getDocs, deleteDoc, doc, query, where, serverTimestamp } from "firebase/firestore";
import { listMessages, getMessage, getMessageMetadata, sendMessage, createDraft, getProfile } from "./gmail";

// ─── Google Connection Banner ───────────────────────────────────────────────
function ConnectBanner({ uid }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100%", gap: 20, padding: 40,
    }}>
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect x="4" y="10" width="40" height="28" rx="4" stroke="#6366f1" strokeWidth="2.5" fill="none" />
        <path d="M4 14l20 14 20-14" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", margin: 0 }}>Connect Google Account</h2>
      <p style={{ fontSize: 13, color: "var(--text-faint)", textAlign: "center", maxWidth: 340, lineHeight: 1.6 }}>
        Connect your Google account to access Gmail and Calendar directly from ARR Flow.
      </p>
      <button
        onClick={() => { window.location.href = `/api/google-auth?uid=${uid}`; }}
        style={{
          background: "#6366f1", color: "#fff", border: "none", borderRadius: 10,
          padding: "12px 28px", fontSize: 14, fontWeight: 600, cursor: "pointer",
          fontFamily: "'DM Sans',sans-serif", transition: "all 0.15s",
        }}
        onMouseEnter={e => e.currentTarget.style.background = "#4f46e5"}
        onMouseLeave={e => e.currentTarget.style.background = "#6366f1"}
      >
        Connect Google
      </button>
    </div>
  );
}

// ─── Compose Modal ──────────────────────────────────────────────────────────
function ComposeModal({ uid, onClose, onSent, replyTo }) {
  const [to, setTo] = useState(replyTo?.replyTo || "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(replyTo ? `Re: ${replyTo.subject}` : "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [showCc, setShowCc] = useState(false);

  async function handleSend() {
    if (!to.trim() || !subject.trim()) return;
    setSending(true);
    try {
      await sendMessage(uid, {
        to, subject, body: body.replace(/\n/g, "<br>"),
        cc: cc || undefined,
        inReplyTo: replyTo?.messageId,
        references: replyTo?.messageId,
      });
      onSent?.();
      onClose();
    } catch (e) {
      alert("Failed to send: " + e.message);
    }
    setSending(false);
  }

  async function handleSaveDraft() {
    if (!to.trim() && !subject.trim() && !body.trim()) return;
    try {
      await createDraft(uid, { to, subject, body: body.replace(/\n/g, "<br>"), cc: cc || undefined });
      onClose();
    } catch (e) {
      alert("Failed to save draft: " + e.message);
    }
  }

  const inputStyle = {
    width: "100%", background: "var(--input-bg)", border: "1px solid var(--border)",
    borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "var(--text)",
    fontFamily: "'DM Sans',sans-serif", outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16,
        width: 560, maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden",
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: "1px solid var(--border)",
        }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
            {replyTo ? "Reply" : "New Email"}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 18 }}>
            &times;
          </button>
        </div>

        {/* Form */}
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10, flex: 1, overflow: "auto" }}>
          <input
            placeholder="To"
            value={to} onChange={e => setTo(e.target.value)}
            style={inputStyle}
          />
          {showCc ? (
            <input placeholder="Cc" value={cc} onChange={e => setCc(e.target.value)} style={inputStyle} />
          ) : (
            <button onClick={() => setShowCc(true)} style={{ background: "none", border: "none", color: "#6366f1", cursor: "pointer", fontSize: 12, textAlign: "left", padding: 0 }}>
              + Add Cc
            </button>
          )}
          <input
            placeholder="Subject"
            value={subject} onChange={e => setSubject(e.target.value)}
            style={inputStyle}
          />
          <textarea
            placeholder="Write your message..."
            value={body} onChange={e => setBody(e.target.value)}
            rows={12}
            style={{ ...inputStyle, resize: "vertical", minHeight: 200, lineHeight: 1.6 }}
          />
        </div>

        {/* Actions */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "12px 20px",
          borderTop: "1px solid var(--border)",
        }}>
          <button
            onClick={handleSend}
            disabled={sending || !to.trim()}
            style={{
              background: sending ? "#4b5563" : "#6366f1", color: "#fff", border: "none",
              borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600,
              cursor: sending ? "default" : "pointer", fontFamily: "'DM Sans',sans-serif",
            }}
          >
            {sending ? "Sending..." : "Send"}
          </button>
          <button onClick={handleSaveDraft} style={{
            background: "transparent", color: "var(--text-faint)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "9px 16px", fontSize: 13, cursor: "pointer",
            fontFamily: "'DM Sans',sans-serif",
          }}>
            Save Draft
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            background: "none", border: "none", color: "var(--text-faint)",
            fontSize: 12, cursor: "pointer",
          }}>
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Deal Tag Picker ────────────────────────────────────────────────────────
function DealTagPicker({ onSelect, onClose }) {
  const [deals, setDeals] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDocs(collection(db, "pipelineDeals")).then(snap => {
      setDeals(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
  }, []);

  const filtered = deals.filter(d =>
    d.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{
      position: "absolute", top: "100%", right: 0, zIndex: 100, marginTop: 4,
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
      width: 280, maxHeight: 300, display: "flex", flexDirection: "column", overflow: "hidden",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    }}>
      <input
        autoFocus
        placeholder="Search deals..."
        value={search} onChange={e => setSearch(e.target.value)}
        style={{
          background: "var(--input-bg)", border: "none", borderBottom: "1px solid var(--border)",
          padding: "10px 12px", fontSize: 12, color: "var(--text)", outline: "none",
          fontFamily: "'DM Sans',sans-serif",
        }}
      />
      <div style={{ overflow: "auto", flex: 1 }}>
        {loading && <div style={{ padding: 12, fontSize: 12, color: "var(--text-faint)" }}>Loading deals...</div>}
        {!loading && filtered.length === 0 && <div style={{ padding: 12, fontSize: 12, color: "var(--text-faint)" }}>No deals found</div>}
        {filtered.map(deal => (
          <button
            key={deal.id}
            onClick={() => { onSelect(deal); onClose(); }}
            style={{
              width: "100%", textAlign: "left", background: "transparent", border: "none",
              padding: "8px 12px", cursor: "pointer", display: "flex", flexDirection: "column",
              borderBottom: "1px solid var(--border)",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(99,102,241,0.08)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>{deal.name}</span>
            <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "'DM Mono',monospace" }}>
              ${(deal.value || 0).toLocaleString()} &middot; {deal.bucket}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main InboxPage ─────────────────────────────────────────────────────────
export default function InboxPage({ currentUser }) {
  const [connected, setConnected] = useState(null); // null = loading
  const [googleEmail, setGoogleEmail] = useState("");
  const [messages, setMessages] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedMsg, setSelectedMsg] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [tab, setTab] = useState("inbox"); // inbox, sent, drafts
  const [searchQuery, setSearchQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [dealTags, setDealTags] = useState({}); // { messageId: { dealId, dealName } }
  const [showDealPicker, setShowDealPicker] = useState(false);

  const uid = currentUser?.uid;

  // Check Google connection
  useEffect(() => {
    if (!uid) return;
    fetch(`/api/google-token?uid=${uid}`)
      .then(r => r.json())
      .then(data => {
        setConnected(data.connected);
        if (data.email) setGoogleEmail(data.email);
      })
      .catch(() => setConnected(false));
  }, [uid]);

  // Load deal tags
  useEffect(() => {
    if (!uid) return;
    getDocs(collection(db, "dealEmails")).then(snap => {
      const tags = {};
      snap.docs.forEach(d => {
        const data = d.data();
        tags[data.gmailMessageId] = { dealId: data.dealId, dealName: data.dealName, docId: d.id };
      });
      setDealTags(tags);
    });
  }, [uid]);

  // Fetch messages
  const fetchMessages = useCallback(async (pageToken) => {
    if (!uid || !connected) return;
    setLoadingList(true);
    try {
      let q = searchQuery;
      if (tab === "sent") q = "in:sent " + q;
      else if (tab === "drafts") q = "in:drafts " + q;
      else if (!q) q = "in:inbox";

      const data = await listMessages(uid, q.trim(), 25, pageToken || "");
      const ids = (data.messages || []).map(m => m.id);

      // Fetch metadata for each message
      const metas = await Promise.all(ids.map(id => getMessageMetadata(uid, id)));
      if (pageToken) {
        setMessages(prev => [...prev, ...metas]);
      } else {
        setMessages(metas);
      }
      setNextPageToken(data.nextPageToken || null);
    } catch (e) {
      console.error("Failed to fetch messages:", e);
    }
    setLoadingList(false);
  }, [uid, connected, tab, searchQuery]);

  useEffect(() => {
    if (connected) fetchMessages();
  }, [connected, tab]);

  // Fetch full message when selected
  useEffect(() => {
    if (!selectedId || !uid) { setSelectedMsg(null); return; }
    setLoadingMsg(true);
    getMessage(uid, selectedId).then(msg => {
      setSelectedMsg(msg);
      setLoadingMsg(false);
    }).catch(() => setLoadingMsg(false));
  }, [selectedId, uid]);

  async function handleSearch(e) {
    e.preventDefault();
    fetchMessages();
  }

  async function handleTagDeal(deal) {
    if (!selectedMsg) return;
    try {
      await addDoc(collection(db, "dealEmails"), {
        dealId: deal.id,
        dealName: deal.name,
        gmailMessageId: selectedMsg.id,
        threadId: selectedMsg.threadId,
        subject: selectedMsg.subject,
        from: selectedMsg.from,
        date: selectedMsg.date,
        taggedBy: uid,
        taggedAt: serverTimestamp(),
      });
      setDealTags(prev => ({ ...prev, [selectedMsg.id]: { dealId: deal.id, dealName: deal.name } }));
    } catch (e) {
      alert("Failed to tag deal: " + e.message);
    }
  }

  async function handleUntagDeal(messageId) {
    const tag = dealTags[messageId];
    if (!tag?.docId) return;
    await deleteDoc(doc(db, "dealEmails", tag.docId));
    setDealTags(prev => { const n = { ...prev }; delete n[messageId]; return n; });
  }

  if (connected === null) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-faint)", fontSize: 13 }}>Loading...</div>;
  }

  if (!connected) {
    return <ConnectBanner uid={uid} />;
  }

  // ─── Parse sender name ──────────────────────────────────────────────────
  function parseSender(from) {
    const match = from?.match(/^"?([^"<]+)"?\s*<?/);
    return match ? match[1].trim() : from?.split("@")[0] || "Unknown";
  }

  function formatDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const isThisYear = d.getFullYear() === now.getFullYear();
    if (isThisYear) return d.toLocaleDateString([], { month: "short", day: "numeric" });
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "2-digit" });
  }

  const tabs = [
    { id: "inbox", label: "Inbox" },
    { id: "sent", label: "Sent" },
    { id: "drafts", label: "Drafts" },
  ];

  return (
    <div style={{ display: "flex", height: "100%", background: "var(--bg)" }}>
      {/* Left panel — message list */}
      <div style={{
        width: 380, flexShrink: 0, borderRight: "1px solid var(--border)",
        display: "flex", flexDirection: "column", height: "100%",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", margin: 0 }}>Inbox</h2>
              {googleEmail && (
                <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "'DM Mono',monospace" }}>{googleEmail}</span>
              )}
            </div>
            <button
              onClick={() => { setReplyTo(null); setComposeOpen(true); }}
              style={{
                background: "#6366f1", color: "#fff", border: "none", borderRadius: 8,
                padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: "'DM Sans',sans-serif",
              }}
            >
              Compose
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2, marginBottom: 10 }}>
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setSelectedId(null); setMessages([]); }}
                style={{
                  flex: 1, padding: "6px 0", fontSize: 12, fontWeight: 600, border: "none",
                  borderRadius: 6, cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
                  background: tab === t.id ? "rgba(99,102,241,0.15)" : "transparent",
                  color: tab === t.id ? "#a5b4fc" : "var(--text-faint)",
                  transition: "all 0.12s",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <form onSubmit={handleSearch} style={{ display: "flex", gap: 6 }}>
            <input
              placeholder="Search emails..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                flex: 1, background: "var(--input-bg)", border: "1px solid var(--border)",
                borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--text)",
                fontFamily: "'DM Sans',sans-serif", outline: "none",
              }}
            />
            <button type="submit" style={{
              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
              padding: "8px 12px", cursor: "pointer", color: "var(--text-faint)", fontSize: 12,
            }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
          </form>
        </div>

        {/* Message list */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {loadingList && messages.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 12 }}>Loading messages...</div>
          )}
          {!loadingList && messages.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 12 }}>No messages found</div>
          )}
          {messages.map(msg => {
            const isSelected = selectedId === msg.id;
            const isUnread = msg.isUnread;
            const tag = dealTags[msg.id];
            return (
              <button
                key={msg.id}
                onClick={() => setSelectedId(msg.id)}
                style={{
                  width: "100%", textAlign: "left", display: "flex", flexDirection: "column",
                  padding: "12px 16px", gap: 3, border: "none", cursor: "pointer",
                  background: isSelected ? "rgba(99,102,241,0.1)" : "transparent",
                  borderLeft: isSelected ? "3px solid #6366f1" : "3px solid transparent",
                  borderBottom: "1px solid var(--border)",
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(99,102,241,0.04)"; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {isUnread && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6366f1", flexShrink: 0 }} />}
                  <span style={{
                    fontSize: 12, fontWeight: isUnread ? 700 : 500, color: "var(--text)",
                    flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {parseSender(msg.from)}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-faint)", flexShrink: 0, fontFamily: "'DM Mono',monospace" }}>
                    {formatDate(msg.date)}
                  </span>
                </div>
                <span style={{
                  fontSize: 12, fontWeight: isUnread ? 600 : 400, color: isUnread ? "var(--text)" : "var(--text-secondary)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {msg.subject || "(no subject)"}
                </span>
                <span style={{
                  fontSize: 11, color: "var(--text-faint)", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {msg.snippet}
                </span>
                {tag && (
                  <span style={{
                    fontSize: 9, fontWeight: 600, background: "rgba(99,102,241,0.15)",
                    color: "#a5b4fc", borderRadius: 4, padding: "2px 6px", alignSelf: "flex-start",
                    marginTop: 2, fontFamily: "'DM Sans',sans-serif",
                  }}>
                    {tag.dealName}
                  </span>
                )}
              </button>
            );
          })}
          {nextPageToken && (
            <button
              onClick={() => fetchMessages(nextPageToken)}
              disabled={loadingList}
              style={{
                width: "100%", padding: "12px", background: "transparent", border: "none",
                color: "#6366f1", fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: "'DM Sans',sans-serif",
              }}
            >
              {loadingList ? "Loading..." : "Load more"}
            </button>
          )}
        </div>
      </div>

      {/* Right panel — email reader */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        {!selectedId && (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--text-faint)", fontSize: 13,
          }}>
            Select an email to read
          </div>
        )}
        {selectedId && loadingMsg && (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--text-faint)", fontSize: 13,
          }}>
            Loading...
          </div>
        )}
        {selectedId && !loadingMsg && selectedMsg && (
          <>
            {/* Email header */}
            <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)" }}>
              <h3 style={{ fontSize: 17, fontWeight: 600, color: "var(--text)", margin: "0 0 12px" }}>
                {selectedMsg.subject || "(no subject)"}
              </h3>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                {/* Avatar */}
                <div style={{
                  width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                  background: "#6366f1", display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontSize: 14, fontWeight: 700,
                }}>
                  {parseSender(selectedMsg.from)?.[0]?.toUpperCase() || "?"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{parseSender(selectedMsg.from)}</div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 1 }}>
                    To: {selectedMsg.to}
                    {selectedMsg.cc && <> &middot; Cc: {selectedMsg.cc}</>}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: "var(--text-faint)", flexShrink: 0, fontFamily: "'DM Mono',monospace" }}>
                  {formatDate(selectedMsg.date)}
                </span>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
                <button
                  onClick={() => {
                    const fromEmail = selectedMsg.from?.match(/<([^>]+)>/)?.[1] || selectedMsg.from;
                    setReplyTo({
                      replyTo: fromEmail,
                      subject: selectedMsg.subject,
                      messageId: selectedMsg.messageId,
                    });
                    setComposeOpen(true);
                  }}
                  style={{
                    background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
                    padding: "6px 12px", fontSize: 11, color: "var(--text-secondary)", cursor: "pointer",
                    fontFamily: "'DM Sans',sans-serif", fontWeight: 500,
                  }}
                >
                  Reply
                </button>
                <button
                  onClick={() => {
                    setReplyTo(null);
                    setComposeOpen(true);
                    // Pre-fill forward
                  }}
                  style={{
                    background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
                    padding: "6px 12px", fontSize: 11, color: "var(--text-secondary)", cursor: "pointer",
                    fontFamily: "'DM Sans',sans-serif", fontWeight: 500,
                  }}
                >
                  Forward
                </button>

                {/* Deal tag */}
                <div style={{ position: "relative", marginLeft: "auto" }}>
                  {dealTags[selectedMsg.id] ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, background: "rgba(99,102,241,0.15)",
                        color: "#a5b4fc", borderRadius: 4, padding: "4px 8px",
                      }}>
                        {dealTags[selectedMsg.id].dealName}
                      </span>
                      <button onClick={() => handleUntagDeal(selectedMsg.id)} style={{
                        background: "none", border: "none", color: "var(--text-faint)",
                        cursor: "pointer", fontSize: 14, padding: 0,
                      }}>&times;</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowDealPicker(p => !p)}
                      style={{
                        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
                        padding: "6px 12px", fontSize: 11, color: "#6366f1", cursor: "pointer",
                        fontFamily: "'DM Sans',sans-serif", fontWeight: 600,
                      }}
                    >
                      Tag Deal
                    </button>
                  )}
                  {showDealPicker && (
                    <DealTagPicker
                      onSelect={handleTagDeal}
                      onClose={() => setShowDealPicker(false)}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Email body */}
            <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
              <div
                style={{
                  fontSize: 13, lineHeight: 1.7, color: "var(--text-secondary)",
                  fontFamily: "'DM Sans',sans-serif",
                  wordBreak: "break-word",
                }}
                dangerouslySetInnerHTML={{ __html: selectedMsg.body }}
              />
            </div>
          </>
        )}
      </div>

      {/* Compose modal */}
      {composeOpen && (
        <ComposeModal
          uid={uid}
          onClose={() => { setComposeOpen(false); setReplyTo(null); }}
          onSent={() => { if (tab === "sent") fetchMessages(); }}
          replyTo={replyTo}
        />
      )}
    </div>
  );
}
