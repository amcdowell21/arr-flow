import { useState, useEffect, useCallback, useRef } from "react";
import { db } from "./firebase";
import { collection, addDoc, getDocs, deleteDoc, doc, query, where, serverTimestamp } from "firebase/firestore";
import {
  listMessagesWithMetadata, getThread, sendMessage, createDraft,
  trashThread, archiveThread, starThread, unstarThread,
  markThreadRead, markThreadUnread, listLabels, modifyThread,
} from "./gmail";

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
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [tab, setTab] = useState("inbox"); // inbox, sent, drafts
  const [searchQuery, setSearchQuery] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [dealTags, setDealTags] = useState({}); // { messageId: { dealId, dealName } }
  const [showDealPicker, setShowDealPicker] = useState(false);
  const [gmailLabels, setGmailLabels] = useState([]);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [showSnoozeMenu, setShowSnoozeMenu] = useState(false);
  const [snoozeReminders, setSnoozeReminders] = useState({}); // { threadId: { date, subject } }

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

  // Load Gmail labels
  useEffect(() => {
    if (!uid || !connected) return;
    listLabels(uid).then(data => {
      // Filter to user-created labels + useful system ones
      const useful = (data.labels || []).filter(l =>
        l.type === "user" || ["STARRED", "IMPORTANT", "SPAM"].includes(l.id)
      );
      setGmailLabels(useful);
    }).catch(() => {});
  }, [uid, connected]);

  // Load snooze reminders from Firestore
  useEffect(() => {
    if (!uid) return;
    getDocs(collection(db, "emailReminders")).then(snap => {
      const reminders = {};
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.userId === uid && data.status === "pending") {
          reminders[data.threadId] = { ...data, docId: d.id };
        }
      });
      setSnoozeReminders(reminders);
    }).catch(() => {});
  }, [uid]);

  // Fetch messages
  const fetchMessages = useCallback(async (pageToken) => {
    if (!uid || !connected) return;
    setLoadingList(true);
    try {
      let q = searchQuery;
      if (tab === "sent") q = "in:sent " + q;
      else if (tab === "drafts") q = "in:drafts " + q;
      else if (tab === "starred") q = "is:starred " + q;
      else if (tab === "trash") q = "in:trash " + q;
      else if (!q) q = "in:inbox";

      const data = await listMessagesWithMetadata(uid, q.trim(), 25, pageToken || "");
      if (pageToken) {
        setMessages(prev => [...prev, ...(data.messages || [])]);
      } else {
        setMessages(data.messages || []);
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

  // Fetch full thread when a message is selected
  useEffect(() => {
    if (!selectedThreadId || !uid) { setThreadMessages([]); return; }
    setLoadingMsg(true);
    getThread(uid, selectedThreadId).then(data => {
      setThreadMessages(data.messages || []);
      setLoadingMsg(false);
    }).catch(() => { setThreadMessages([]); setLoadingMsg(false); });
  }, [selectedThreadId, uid]);

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

  // ─── Thread actions (accept optional threadId for hover actions) ────────
  async function handleTrash(tid) {
    const t = tid || selectedThreadId;
    if (!t) return;
    try {
      await trashThread(uid, t);
      setMessages(prev => prev.filter(m => m.threadId !== t));
      if (t === selectedThreadId) { setSelectedId(null); setSelectedThreadId(null); setThreadMessages([]); }
    } catch (e) { alert("Failed to delete: " + e.message); }
  }

  async function handleArchive(tid) {
    const t = tid || selectedThreadId;
    if (!t) return;
    try {
      await archiveThread(uid, t);
      setMessages(prev => prev.filter(m => m.threadId !== t));
      if (t === selectedThreadId) { setSelectedId(null); setSelectedThreadId(null); setThreadMessages([]); }
    } catch (e) { alert("Failed to archive: " + e.message); }
  }

  async function handleToggleStar(tid) {
    const t = tid || selectedThreadId;
    if (!t) return;
    const firstMsg = messages.find(m => m.threadId === t);
    const isStarred = firstMsg?.labelIds?.includes("STARRED");
    try {
      if (isStarred) await unstarThread(uid, t);
      else await starThread(uid, t);
      setMessages(prev => prev.map(m => {
        if (m.threadId !== t) return m;
        const ids = new Set(m.labelIds || []);
        if (isStarred) ids.delete("STARRED"); else ids.add("STARRED");
        return { ...m, labelIds: [...ids] };
      }));
    } catch (e) { alert("Failed to star: " + e.message); }
  }

  async function handleToggleRead(tid) {
    const t = tid || selectedThreadId;
    if (!t) return;
    const firstMsg = messages.find(m => m.threadId === t);
    const isUnread = firstMsg?.isUnread;
    try {
      if (isUnread) await markThreadRead(uid, t);
      else await markThreadUnread(uid, t);
      setMessages(prev => prev.map(m => {
        if (m.threadId !== t) return m;
        const ids = new Set(m.labelIds || []);
        if (isUnread) ids.delete("UNREAD"); else ids.add("UNREAD");
        return { ...m, labelIds: [...ids], isUnread: !isUnread };
      }));
    } catch (e) { alert("Failed: " + e.message); }
  }

  async function handleApplyLabel(labelId) {
    if (!selectedThreadId) return;
    try {
      await modifyThread(uid, selectedThreadId, [labelId], []);
      setShowLabelPicker(false);
    } catch (e) { alert("Failed to apply label: " + e.message); }
  }

  async function handleSnooze(hours, label) {
    if (!selectedThreadId) return;
    const remindAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const firstMsg = messages.find(m => m.threadId === selectedThreadId);
    try {
      // Archive the thread (remove from inbox)
      await archiveThread(uid, selectedThreadId);
      // Save reminder in Firestore
      const docRef = await addDoc(collection(db, "emailReminders"), {
        userId: uid,
        threadId: selectedThreadId,
        messageId: selectedId,
        subject: firstMsg?.subject || "(no subject)",
        from: firstMsg?.from || "",
        remindAt,
        label,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      setSnoozeReminders(prev => ({
        ...prev,
        [selectedThreadId]: { remindAt, label, subject: firstMsg?.subject, docId: docRef.id },
      }));
      // Remove from list
      setMessages(prev => prev.filter(m => m.threadId !== selectedThreadId));
      setSelectedId(null);
      setSelectedThreadId(null);
      setThreadMessages([]);
      setShowSnoozeMenu(false);
    } catch (e) { alert("Failed to snooze: " + e.message); }
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
    { id: "starred", label: "Starred" },
    { id: "sent", label: "Sent" },
    { id: "drafts", label: "Drafts" },
    { id: "trash", label: "Trash" },
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
                onClick={() => { setTab(t.id); setSelectedId(null); setSelectedThreadId(null); setThreadMessages([]); setMessages([]); }}
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
            const isStarred = msg.labelIds?.includes("STARRED");
            const tag = dealTags[msg.id];
            const hoverBtnStyle = {
              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 5,
              width: 26, height: 26, cursor: "pointer", display: "flex", alignItems: "center",
              justifyContent: "center", padding: 0, color: "var(--text-faint)", flexShrink: 0,
              transition: "all 0.1s",
            };
            return (
              <div
                key={msg.id}
                onClick={() => { setSelectedId(msg.id); setSelectedThreadId(msg.threadId); }}
                style={{
                  width: "100%", textAlign: "left", display: "flex", alignItems: "center",
                  padding: "10px 12px 10px 16px", gap: 8, border: "none", cursor: "pointer",
                  background: isSelected ? "rgba(99,102,241,0.1)" : "transparent",
                  borderLeft: isSelected ? "3px solid #6366f1" : "3px solid transparent",
                  borderBottom: "1px solid var(--border)",
                  transition: "background 0.1s", position: "relative",
                }}
                onMouseEnter={e => {
                  if (!isSelected) e.currentTarget.style.background = "rgba(99,102,241,0.04)";
                  e.currentTarget.querySelector("[data-hover-actions]").style.opacity = "1";
                  e.currentTarget.querySelector("[data-hover-actions]").style.pointerEvents = "auto";
                }}
                onMouseLeave={e => {
                  if (!isSelected) e.currentTarget.style.background = "transparent";
                  e.currentTarget.querySelector("[data-hover-actions]").style.opacity = "0";
                  e.currentTarget.querySelector("[data-hover-actions]").style.pointerEvents = "none";
                }}
              >
                {/* Star toggle */}
                <button
                  onClick={e => { e.stopPropagation(); handleToggleStar(msg.threadId); }}
                  style={{
                    background: "none", border: "none", cursor: "pointer", padding: 0,
                    flexShrink: 0, width: 16, display: "flex", alignItems: "center",
                  }}
                  title={isStarred ? "Unstar" : "Star"}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill={isStarred ? "#fbbf24" : "none"}>
                    <path d="M6.5 1l1.6 3.3 3.6.5-2.6 2.5.6 3.6L6.5 9.2 3.3 10.9l.6-3.6L1.3 4.8l3.6-.5z" stroke={isStarred ? "#fbbf24" : "#64748b"} strokeWidth="1" strokeLinejoin="round"/>
                  </svg>
                </button>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
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
                </div>

                {/* Hover actions */}
                <div
                  data-hover-actions
                  style={{
                    position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                    display: "flex", gap: 3, opacity: 0, pointerEvents: "none",
                    transition: "opacity 0.12s", background: "var(--surface)",
                    padding: "2px 4px", borderRadius: 6, border: "1px solid var(--border)",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                  }}
                >
                  {/* Archive */}
                  <button
                    onClick={e => { e.stopPropagation(); handleArchive(msg.threadId); }}
                    style={hoverBtnStyle}
                    title="Archive"
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(99,102,241,0.1)"; e.currentTarget.style.color = "#a5b4fc"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.color = "var(--text-faint)"; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                      <rect x="1" y="1" width="11" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                      <path d="M2 5v6.5a1 1 0 001 1h7a1 1 0 001-1V5" stroke="currentColor" strokeWidth="1.2"/>
                      <path d="M5 8h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </button>

                  {/* Delete */}
                  <button
                    onClick={e => { e.stopPropagation(); handleTrash(msg.threadId); }}
                    style={hoverBtnStyle}
                    title="Delete"
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(248,113,113,0.1)"; e.currentTarget.style.color = "#f87171"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.color = "var(--text-faint)"; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                      <path d="M2 3.5h9M4.5 3.5V2.5a1 1 0 011-1h2a1 1 0 011 1v1M3.5 3.5l.5 8a1 1 0 001 1h3a1 1 0 001-1l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </button>

                  {/* Mark read/unread */}
                  <button
                    onClick={e => { e.stopPropagation(); handleToggleRead(msg.threadId); }}
                    style={hoverBtnStyle}
                    title={isUnread ? "Mark as read" : "Mark as unread"}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(99,102,241,0.1)"; e.currentTarget.style.color = "#a5b4fc"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.color = "var(--text-faint)"; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                      <rect x="1" y="3" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                      {isUnread ? (
                        <path d="M1 4.5l5.5 3.5 5.5-3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                      ) : (
                        <circle cx="9.5" cy="4" r="2" fill="#6366f1" stroke="var(--surface)" strokeWidth="0.5"/>
                      )}
                    </svg>
                  </button>

                  {/* Snooze */}
                  <button
                    onClick={e => { e.stopPropagation(); setSelectedId(msg.id); setSelectedThreadId(msg.threadId); setShowSnoozeMenu(true); }}
                    style={hoverBtnStyle}
                    title="Snooze"
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(99,102,241,0.1)"; e.currentTarget.style.color = "#a5b4fc"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.color = "var(--text-faint)"; }}
                  >
                    <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                      <circle cx="6.5" cy="7" r="5" stroke="currentColor" strokeWidth="1.2"/>
                      <path d="M6.5 4.5v3l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>
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

      {/* Right panel — thread view */}
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
        {selectedId && !loadingMsg && threadMessages.length > 0 && (() => {
          const lastMsg = threadMessages[threadMessages.length - 1];
          const threadSubject = threadMessages[0]?.subject || "(no subject)";
          return (
            <>
              {/* Thread header + action toolbar */}
              <div style={{ borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                {/* Action toolbar */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 4, padding: "10px 24px",
                  borderBottom: "1px solid var(--border)", background: "var(--surface)",
                }}>
                  {(() => {
                    const btnStyle = {
                      background: "transparent", border: "1px solid var(--border)", borderRadius: 6,
                      padding: "5px 10px", fontSize: 11, cursor: "pointer", display: "flex",
                      alignItems: "center", gap: 4, fontFamily: "'DM Sans',sans-serif",
                      color: "var(--text-secondary)", fontWeight: 500, whiteSpace: "nowrap",
                    };
                    const isStarred = messages.find(m => m.threadId === selectedThreadId)?.labelIds?.includes("STARRED");
                    const isUnread = messages.find(m => m.threadId === selectedThreadId)?.isUnread;
                    return (
                      <>
                        {/* Archive */}
                        <button onClick={handleArchive} style={btnStyle} title="Archive">
                          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                            <rect x="1" y="1" width="11" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                            <path d="M2 5v6.5a1 1 0 001 1h7a1 1 0 001-1V5" stroke="currentColor" strokeWidth="1.2"/>
                            <path d="M5 8h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                          </svg>
                          Archive
                        </button>

                        {/* Delete */}
                        <button onClick={handleTrash} style={{ ...btnStyle, color: "#f87171" }} title="Delete">
                          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                            <path d="M2 3.5h9M4.5 3.5V2.5a1 1 0 011-1h2a1 1 0 011 1v1M3.5 3.5l.5 8a1 1 0 001 1h3a1 1 0 001-1l.5-8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                          </svg>
                          Delete
                        </button>

                        {/* Star */}
                        <button onClick={handleToggleStar} style={{ ...btnStyle, color: isStarred ? "#fbbf24" : "var(--text-secondary)" }} title={isStarred ? "Unstar" : "Star"}>
                          <svg width="13" height="13" viewBox="0 0 13 13" fill={isStarred ? "#fbbf24" : "none"}>
                            <path d="M6.5 1l1.6 3.3 3.6.5-2.6 2.5.6 3.6L6.5 9.2 3.3 10.9l.6-3.6L1.3 4.8l3.6-.5z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
                          </svg>
                          {isStarred ? "Starred" : "Star"}
                        </button>

                        {/* Mark read/unread */}
                        <button onClick={handleToggleRead} style={btnStyle} title={isUnread ? "Mark as read" : "Mark as unread"}>
                          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                            <rect x="1" y="3" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                            {isUnread ? (
                              <path d="M1 4.5l5.5 3.5 5.5-3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                            ) : (
                              <circle cx="9.5" cy="4" r="2" fill="#6366f1" stroke="var(--surface)" strokeWidth="0.5"/>
                            )}
                          </svg>
                          {isUnread ? "Mark read" : "Mark unread"}
                        </button>

                        {/* Snooze / Remind */}
                        <div style={{ position: "relative" }}>
                          <button onClick={() => { setShowSnoozeMenu(p => !p); setShowLabelPicker(false); }} style={btnStyle} title="Snooze">
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                              <circle cx="6.5" cy="7" r="5" stroke="currentColor" strokeWidth="1.2"/>
                              <path d="M6.5 4.5v3l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            Snooze
                          </button>
                          {showSnoozeMenu && (
                            <div style={{
                              position: "absolute", top: "100%", left: 0, zIndex: 100, marginTop: 4,
                              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
                              width: 200, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", overflow: "hidden",
                            }}>
                              <div style={{ padding: "8px 12px", fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--border)" }}>
                                Snooze until...
                              </div>
                              {[
                                { label: "Later today", hours: 3, tag: "later_today" },
                                { label: "Tomorrow morning", hours: 18, tag: "tomorrow" },
                                { label: "This weekend", hours: (() => { const d = new Date(); const sat = 6 - d.getDay(); return sat <= 0 ? (sat + 7) * 24 : sat * 24; })(), tag: "weekend" },
                                { label: "Next week", hours: (() => { const d = new Date(); const mon = (8 - d.getDay()) % 7 || 7; return mon * 24; })(), tag: "next_week" },
                              ].map(opt => (
                                <button
                                  key={opt.tag}
                                  onClick={() => handleSnooze(opt.hours, opt.tag)}
                                  style={{
                                    width: "100%", textAlign: "left", background: "transparent", border: "none",
                                    padding: "8px 12px", fontSize: 12, color: "var(--text)", cursor: "pointer",
                                    fontFamily: "'DM Sans',sans-serif",
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.background = "rgba(99,102,241,0.08)"}
                                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                                >
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Labels */}
                        <div style={{ position: "relative" }}>
                          <button onClick={() => { setShowLabelPicker(p => !p); setShowSnoozeMenu(false); }} style={btnStyle} title="Label">
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                              <path d="M1.5 3a1 1 0 011-1h3.6a1 1 0 01.7.3l5.2 5.2a1 1 0 010 1.4l-3.1 3.1a1 1 0 01-1.4 0L2.3 6.8a1 1 0 01-.3-.7V3.5z" stroke="currentColor" strokeWidth="1.2"/>
                              <circle cx="4.5" cy="4.5" r="0.8" fill="currentColor"/>
                            </svg>
                            Label
                          </button>
                          {showLabelPicker && (
                            <div style={{
                              position: "absolute", top: "100%", left: 0, zIndex: 100, marginTop: 4,
                              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
                              width: 220, maxHeight: 250, overflow: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                            }}>
                              <div style={{ padding: "8px 12px", fontSize: 10, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--border)" }}>
                                Apply label
                              </div>
                              {gmailLabels.length === 0 && (
                                <div style={{ padding: 12, fontSize: 12, color: "var(--text-faint)" }}>No labels found</div>
                              )}
                              {gmailLabels.map(label => (
                                <button
                                  key={label.id}
                                  onClick={() => handleApplyLabel(label.id)}
                                  style={{
                                    width: "100%", textAlign: "left", background: "transparent", border: "none",
                                    padding: "7px 12px", fontSize: 12, color: "var(--text)", cursor: "pointer",
                                    fontFamily: "'DM Sans',sans-serif", borderBottom: "1px solid var(--border)",
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.background = "rgba(99,102,241,0.08)"}
                                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                                >
                                  {label.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <div style={{ flex: 1 }} />

                        {/* Deal tag */}
                        <div style={{ position: "relative" }}>
                          {dealTags[selectedId] ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{
                                fontSize: 10, fontWeight: 600, background: "rgba(99,102,241,0.15)",
                                color: "#a5b4fc", borderRadius: 4, padding: "4px 8px",
                              }}>
                                {dealTags[selectedId].dealName}
                              </span>
                              <button onClick={() => handleUntagDeal(selectedId)} style={{
                                background: "none", border: "none", color: "var(--text-faint)",
                                cursor: "pointer", fontSize: 14, padding: 0,
                              }}>&times;</button>
                            </div>
                          ) : (
                            <button onClick={() => { setShowDealPicker(p => !p); setShowLabelPicker(false); setShowSnoozeMenu(false); }} style={{ ...btnStyle, color: "#6366f1", fontWeight: 600 }}>
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
                      </>
                    );
                  })()}
                </div>

                {/* Subject + thread count */}
                <div style={{ padding: "12px 24px" }}>
                  <h3 style={{ fontSize: 17, fontWeight: 600, color: "var(--text)", margin: 0 }}>
                    {threadSubject}
                  </h3>
                  <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
                    {threadMessages.length} message{threadMessages.length !== 1 ? "s" : ""} in this thread
                    {snoozeReminders[selectedThreadId] && (
                      <span style={{ marginLeft: 8, color: "#f59e0b", fontWeight: 600 }}>
                        Snoozed until {new Date(snoozeReminders[selectedThreadId].remindAt).toLocaleDateString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Thread messages */}
              <div style={{ flex: 1, overflow: "auto" }}>
                {threadMessages.map((msg, idx) => {
                  const isLast = idx === threadMessages.length - 1;
                  const [expanded, setExpanded] = [true, null]; // All expanded by default for now
                  return (
                    <div key={msg.id} style={{
                      borderBottom: !isLast ? "1px solid var(--border)" : "none",
                    }}>
                      {/* Message header */}
                      <div style={{
                        display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 24px 8px",
                      }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                          background: msg.from?.includes(googleEmail) ? "#14b8a6" : "#6366f1",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#fff", fontSize: 12, fontWeight: 700,
                        }}>
                          {parseSender(msg.from)?.[0]?.toUpperCase() || "?"}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
                              {parseSender(msg.from)}
                            </span>
                            {msg.from?.includes(googleEmail) && (
                              <span style={{ fontSize: 9, color: "#14b8a6", fontWeight: 600, background: "rgba(20,184,166,0.12)", borderRadius: 3, padding: "1px 5px" }}>You</span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 1 }}>
                            To: {msg.to}
                            {msg.cc && <> &middot; Cc: {msg.cc}</>}
                          </div>
                        </div>
                        <span style={{ fontSize: 10, color: "var(--text-faint)", flexShrink: 0, fontFamily: "'DM Mono',monospace" }}>
                          {formatDate(msg.date)}
                        </span>
                      </div>

                      {/* Message body */}
                      <div style={{ padding: "4px 24px 16px 66px" }}>
                        <div
                          style={{
                            fontSize: 13, lineHeight: 1.7, color: "var(--text-secondary)",
                            fontFamily: "'DM Sans',sans-serif", wordBreak: "break-word",
                          }}
                          dangerouslySetInnerHTML={{ __html: msg.body }}
                        />
                      </div>
                    </div>
                  );
                })}

                {/* Reply buttons at bottom of thread */}
                <div style={{ padding: "16px 24px 24px", display: "flex", gap: 8 }}>
                  {(() => {
                    const replyBtnStyle = {
                      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
                      padding: "10px 20px", fontSize: 12, color: "var(--text-secondary)", cursor: "pointer",
                      fontFamily: "'DM Sans',sans-serif", fontWeight: 500, display: "flex",
                      alignItems: "center", gap: 6,
                    };
                    const fromEmail = lastMsg.from?.match(/<([^>]+)>/)?.[1] || lastMsg.from;
                    // Collect all recipients for Reply All
                    const allTo = [lastMsg.from, lastMsg.to, lastMsg.cc].filter(Boolean).join(", ");
                    const allEmails = [...new Set(
                      allTo.match(/[\w.-]+@[\w.-]+/g) || []
                    )].filter(e => !googleEmail || !e.toLowerCase().includes(googleEmail.toLowerCase()));
                    return (
                      <>
                        <button
                          onClick={() => {
                            setReplyTo({ replyTo: fromEmail, subject: lastMsg.subject, messageId: lastMsg.messageId });
                            setComposeOpen(true);
                          }}
                          style={{ ...replyBtnStyle, fontWeight: 600 }}
                        >
                          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                            <path d="M5 3L1.5 6.5 5 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M2 6.5h7a3 3 0 013 3v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                          </svg>
                          Reply
                        </button>
                        <button
                          onClick={() => {
                            setReplyTo({
                              replyTo: allEmails.join(", "),
                              subject: lastMsg.subject,
                              messageId: lastMsg.messageId,
                            });
                            setComposeOpen(true);
                          }}
                          style={replyBtnStyle}
                        >
                          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                            <path d="M5 3L1.5 6.5 5 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M7 3L3.5 6.5 7 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
                            <path d="M4 6.5h5a3 3 0 013 3v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                          </svg>
                          Reply All
                        </button>
                        <button
                          onClick={() => { setReplyTo(null); setComposeOpen(true); }}
                          style={replyBtnStyle}
                        >
                          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                            <path d="M8 3l3.5 3.5L8 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M11 6.5H4a3 3 0 00-3 3v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                          </svg>
                          Forward
                        </button>
                      </>
                    );
                  })()}
                </div>
              </div>
            </>
          );
        })()}
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
