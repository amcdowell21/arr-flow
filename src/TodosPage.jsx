import { useState, useEffect, useRef, useCallback } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc, getDocs, collection } from "firebase/firestore";
import {
  getFirefliesToken, setFirefliesToken,
  fetchTranscripts, parseActionItems, matchDeal,
} from "./fireflies";

// ── Helpers ───────────────────────────────────────────────────────────────────
function genId() { return Math.random().toString(36).slice(2, 11); }
function newBlock(type = "text") { return { id: genId(), type, content: "", checked: false }; }

function setCursorEnd(el) {
  if (!el) return;
  el.focus();
  const range = document.createRange(), sel = window.getSelection();
  range.selectNodeContents(el); range.collapse(false);
  sel.removeAllRanges(); sel.addRange(range);
}
function setCursorStart(el) {
  if (!el) return;
  el.focus();
  const range = document.createRange(), sel = window.getSelection();
  range.selectNodeContents(el); range.collapse(true);
  sel.removeAllRanges(); sel.addRange(range);
}

// ── Block type definitions ────────────────────────────────────────────────────
const BLOCK_TYPES = [
  { type: "text",     icon: "¶",    label: "Text",         desc: "Plain paragraph" },
  { type: "h1",       icon: "H1",   label: "Heading 1",    desc: "Large section title" },
  { type: "h2",       icon: "H2",   label: "Heading 2",    desc: "Medium heading" },
  { type: "h3",       icon: "H3",   label: "Heading 3",    desc: "Smaller heading" },
  { type: "bullet",   icon: "•",    label: "Bullet List",  desc: "Unordered list item" },
  { type: "numbered", icon: "1.",   label: "Numbered",     desc: "Ordered list item" },
  { type: "todo",     icon: "☐",    label: "To-do",        desc: "Checkable task" },
  { type: "quote",    icon: "❝",    label: "Quote",        desc: "Highlighted block quote" },
  { type: "code",     icon: "</>",  label: "Code",         desc: "Monospace code block" },
  { type: "divider",  icon: "—",    label: "Divider",      desc: "Horizontal separator" },
];

function getBlockStyle(type, checked) {
  const base = { fontFamily: "'DM Sans',sans-serif", lineHeight: 1.7, wordBreak: "break-word" };
  switch (type) {
    case "h1": return { ...base, fontSize: 30, fontWeight: 800, color: "var(--text)", lineHeight: 1.25 };
    case "h2": return { ...base, fontSize: 22, fontWeight: 700, color: "var(--text)", lineHeight: 1.3 };
    case "h3": return { ...base, fontSize: 17, fontWeight: 600, color: "var(--text)", lineHeight: 1.35 };
    case "quote": return { ...base, fontSize: 14, fontStyle: "italic", color: "#a5b4fc", borderLeft: "3px solid #6366f1", paddingLeft: 14 };
    case "code": return { ...base, fontSize: 13, fontFamily: "'DM Mono',monospace", color: "#a5f3fc", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "10px 14px", whiteSpace: "pre-wrap" };
    case "todo": return { ...base, fontSize: 14, color: checked ? "#64748b" : "var(--text-body)", textDecoration: checked ? "line-through" : "none" };
    default: return { ...base, fontSize: 14, color: "var(--text-body)" };
  }
}

function getPlaceholder(type) {
  switch (type) {
    case "h1": return "Heading 1";
    case "h2": return "Heading 2";
    case "h3": return "Heading 3";
    case "bullet": case "numbered": return "List item";
    case "todo": return "To-do…";
    case "quote": return "Enter a quote…";
    case "code": return "// code…";
    default: return "Type '/' for commands…";
  }
}

// ── Slash Menu ────────────────────────────────────────────────────────────────
function SlashMenu({ filter, pos, onSelect, onClose }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const filtered = BLOCK_TYPES.filter(t =>
    !filter || t.label.toLowerCase().includes(filter.toLowerCase()) || t.type.includes(filter.toLowerCase())
  );

  useEffect(() => { setActiveIdx(0); }, [filter]);

  useEffect(() => {
    function onKey(e) {
      if (!filtered.length) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => (i + 1) % filtered.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => (i - 1 + filtered.length) % filtered.length); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); onSelect(filtered[activeIdx]?.type); }
      else if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [filtered, activeIdx, onSelect, onClose]);

  if (!filtered.length) return null;

  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: "fixed", left: pos.x, top: pos.y,
        background: "#1e293b", border: "1px solid #334155",
        borderRadius: 10, boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
        zIndex: 2000, minWidth: 244, maxHeight: 340, overflowY: "auto",
        fontFamily: "'DM Sans',sans-serif",
      }}
    >
      <div style={{ padding: "6px 12px 5px", borderBottom: "1px solid #1e3a5f" }}>
        <span style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#475569", fontFamily: "'DM Mono',monospace" }}>
          Block Type {filter ? `— "${filter}"` : ""}
        </span>
      </div>
      {filtered.map((t, i) => (
        <button
          key={t.type}
          onClick={() => onSelect(t.type)}
          onMouseEnter={() => setActiveIdx(i)}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 10,
            padding: "7px 12px",
            background: i === activeIdx ? "rgba(99,102,241,0.14)" : "transparent",
            border: "none", borderLeft: `2px solid ${i === activeIdx ? "#6366f1" : "transparent"}`,
            cursor: "pointer", textAlign: "left",
          }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: 7, flexShrink: 0,
            background: i === activeIdx ? "rgba(99,102,241,0.2)" : "#0f172a",
            border: `1px solid ${i === activeIdx ? "rgba(99,102,241,0.4)" : "#334155"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 700, color: i === activeIdx ? "#a5b4fc" : "#64748b",
            fontFamily: "'DM Mono',monospace",
          }}>
            {t.icon}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#f1f5f9" }}>{t.label}</div>
            <div style={{ fontSize: 10, color: "#64748b" }}>{t.desc}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Format Toolbar ────────────────────────────────────────────────────────────
function FormatBar({ x, y }) {
  const buttons = [
    { label: "B", title: "Bold", cmd: "bold", style: { fontWeight: 700 } },
    { label: "I", title: "Italic", cmd: "italic", style: { fontStyle: "italic" } },
    { label: "U", title: "Underline", cmd: "underline", style: { textDecoration: "underline" } },
    { label: "S", title: "Strikethrough", cmd: "strikeThrough", style: { textDecoration: "line-through" } },
  ];

  return (
    <div
      onMouseDown={e => e.preventDefault()}
      style={{
        position: "fixed", left: x, top: y - 46,
        background: "#0f172a", border: "1px solid #334155",
        borderRadius: 8, boxShadow: "0 4px 24px rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", gap: 2, padding: "4px 5px",
        zIndex: 2001, fontFamily: "'DM Sans',sans-serif",
      }}
    >
      {buttons.map(b => (
        <button
          key={b.cmd}
          title={b.title}
          onMouseDown={e => { e.preventDefault(); document.execCommand(b.cmd); }}
          style={{
            ...b.style, background: "transparent", border: "1px solid transparent",
            borderRadius: 5, padding: "2px 9px", cursor: "pointer", fontSize: 13,
            color: "#e2e8f0", transition: "all 0.1s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(99,102,241,0.2)"; e.currentTarget.style.borderColor = "rgba(99,102,241,0.35)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}
        >
          {b.label}
        </button>
      ))}
      <div style={{ width: 1, height: 18, background: "#334155", margin: "0 2px" }} />
      <button
        title="Inline code"
        onMouseDown={e => {
          e.preventDefault();
          const sel = window.getSelection();
          if (!sel || sel.isCollapsed) return;
          try {
            const range = sel.getRangeAt(0);
            const code = document.createElement("code");
            code.style.cssText = "background:#1e293b;border:1px solid #334155;border-radius:3px;padding:1px 5px;font-family:'DM Mono',monospace;font-size:0.88em;color:#a5f3fc;";
            range.surroundContents(code);
            sel.removeAllRanges();
          } catch { /* ignore multi-node selections */ }
        }}
        style={{
          background: "transparent", border: "1px solid transparent", borderRadius: 5,
          padding: "2px 8px", cursor: "pointer", fontSize: 10,
          color: "#a5f3fc", fontFamily: "'DM Mono',monospace", transition: "all 0.1s",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(165,243,252,0.1)"; e.currentTarget.style.borderColor = "rgba(165,243,252,0.2)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }}
      >
        code
      </button>
    </div>
  );
}

// ── Block Handle (hover grip) ─────────────────────────────────────────────────
function BlockHandle({ onDelete, onTypeChange }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e) { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); }
    setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  return (
    <div style={{ position: "absolute", left: 2, top: "50%", transform: "translateY(-50%)" }} ref={menuRef}>
      <button
        onMouseDown={e => e.preventDefault()}
        onClick={() => setMenuOpen(o => !o)}
        title="Block options"
        style={{
          background: "transparent", border: "none", cursor: "pointer",
          color: "#4b5563", padding: "3px", borderRadius: 4, lineHeight: 1,
          transition: "color 0.15s",
        }}
        onMouseEnter={e => e.currentTarget.style.color = "#94a3b8"}
        onMouseLeave={e => e.currentTarget.style.color = "#4b5563"}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="5" cy="4.5" r="1.1" fill="currentColor"/>
          <circle cx="9" cy="4.5" r="1.1" fill="currentColor"/>
          <circle cx="5" cy="7" r="1.1" fill="currentColor"/>
          <circle cx="9" cy="7" r="1.1" fill="currentColor"/>
          <circle cx="5" cy="9.5" r="1.1" fill="currentColor"/>
          <circle cx="9" cy="9.5" r="1.1" fill="currentColor"/>
        </svg>
      </button>

      {menuOpen && (
        <div style={{
          position: "absolute", left: 20, top: -4,
          background: "#1e293b", border: "1px solid #334155",
          borderRadius: 9, boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
          zIndex: 500, minWidth: 190, padding: 4,
        }}>
          <div style={{ padding: "4px 8px 5px", fontSize: 9, color: "#475569", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Turn into
          </div>
          {BLOCK_TYPES.filter(t => t.type !== "divider").map(t => (
            <button
              key={t.type}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onTypeChange(t.type); setMenuOpen(false); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "5px 8px", background: "transparent", border: "none",
                borderRadius: 5, cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(99,102,241,0.1)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: "#64748b", width: 26, textAlign: "center" }}>{t.icon}</span>
              <span style={{ fontSize: 11, color: "#e2e8f0", fontFamily: "'DM Sans',sans-serif" }}>{t.label}</span>
            </button>
          ))}
          <div style={{ borderTop: "1px solid #1e3a5f", margin: "4px 0" }} />
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => { onDelete(); setMenuOpen(false); }}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8,
              padding: "5px 8px", background: "transparent", border: "none",
              borderRadius: 5, cursor: "pointer", textAlign: "left", color: "#f87171",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(239,68,68,0.1)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", width: 26, textAlign: "center" }}>✕</span>
            <span style={{ fontSize: 11, fontFamily: "'DM Sans',sans-serif" }}>Delete block</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ── BlockRow ──────────────────────────────────────────────────────────────────
function BlockRow({
  block, blocks, blockIdx,
  onContentChange, onTypeChange, onToggleCheck,
  onEnter, onDeleteBlock, onFocusPrev, onFocusNext,
  onSlashOpen, onSlashClose, isSlashActive,
  registerRef,
}) {
  const editRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  // Register DOM ref with parent on every render (ref may change)
  useEffect(() => {
    if (editRef.current) registerRef(block.id, editRef.current);
    return () => registerRef(block.id, null);
  });

  // Sync content from state → DOM only when block.id changes (avoids cursor jumping)
  const syncedId = useRef(null);
  useEffect(() => {
    if (editRef.current && syncedId.current !== block.id) {
      editRef.current.innerHTML = block.content || "";
      const text = editRef.current.innerText?.trim() || "";
      setIsEmpty(!text);
      syncedId.current = block.id;
    }
  });

  function handleInput() {
    if (!editRef.current) return;
    const html = editRef.current.innerHTML;
    const text = editRef.current.innerText?.trim() || "";
    setIsEmpty(!text);
    onContentChange(block.id, html);
    // Slash menu detection
    const raw = editRef.current.innerText || "";
    if (raw.startsWith("/")) {
      const rect = editRef.current.getBoundingClientRect();
      onSlashOpen(block.id, raw.slice(1), { x: rect.left, y: rect.bottom + 6 });
    } else if (isSlashActive) {
      onSlashClose();
    }
  }

  function handleKeyDown(e) {
    if (!editRef.current) return;
    const text = editRef.current.innerText?.trim() || "";
    const isEmptyBlock = !text;

    if (e.key === "Enter") {
      // Allow normal line breaks in code blocks
      if (block.type === "code") return;
      if (isSlashActive) return; // slash menu handles Enter
      e.preventDefault();
      onEnter(block.id);
    } else if (e.key === "Backspace" && isEmptyBlock) {
      e.preventDefault();
      if (block.type !== "text") {
        onTypeChange(block.id, "text");
      } else {
        onDeleteBlock(block.id);
      }
    } else if (e.key === "ArrowUp") {
      const sel = window.getSelection();
      if (sel?.rangeCount > 0 && sel.getRangeAt(0).startOffset === 0) {
        e.preventDefault();
        onFocusPrev(block.id);
      }
    } else if (e.key === "ArrowDown") {
      const sel = window.getSelection();
      if (sel?.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const len = range.startContainer?.textContent?.length ?? 0;
        if (range.startOffset >= len || isEmptyBlock) {
          e.preventDefault();
          onFocusNext(block.id);
        }
      }
    } else if (e.key === "Escape" && isSlashActive) {
      e.preventDefault();
      onSlashClose();
    }
  }

  // Compute numbered list index
  let numIdx = 1;
  if (block.type === "numbered") {
    for (let i = blockIdx - 1; i >= 0; i--) {
      if (blocks[i].type === "numbered") numIdx++;
      else break;
    }
  }

  const blockStyle = getBlockStyle(block.type, block.checked);
  const placeholder = getPlaceholder(block.type);
  const isHeading = ["h1", "h2", "h3"].includes(block.type);

  // Outer wrapper extends 36px left so the handle (left:2) stays inside the hover zone
  const outerStyle = {
    position: "relative",
    marginLeft: -36, paddingLeft: 36,
    marginTop: isHeading ? 14 : 2,
    paddingTop: 1, paddingBottom: 1,
  };

  // Divider
  if (block.type === "divider") {
    return (
      <div style={outerStyle} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        {hovered && (
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => onDeleteBlock(block.id)}
            style={{
              position: "absolute", left: 2, top: "50%", transform: "translateY(-50%)",
              background: "transparent", border: "none", cursor: "pointer", color: "#4b5563", padding: 3, borderRadius: 4,
            }}
            onMouseEnter={e => e.currentTarget.style.color = "#f87171"}
            onMouseLeave={e => e.currentTarget.style.color = "#4b5563"}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        )}
        <hr style={{ border: "none", borderTop: `1px solid ${hovered ? "#6366f1" : "#334155"}`, margin: "11px 0", transition: "border-color 0.2s" }} />
      </div>
    );
  }

  return (
    <div style={outerStyle} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {hovered && (
        <BlockHandle
          onDelete={() => onDeleteBlock(block.id)}
          onTypeChange={t => onTypeChange(block.id, t)}
        />
      )}

      <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        {/* Prefix decorations */}
        {block.type === "bullet" && (
          <span style={{ color: "#6366f1", fontSize: 18, lineHeight: "1.7", flexShrink: 0, userSelect: "none" }}>•</span>
        )}
        {block.type === "numbered" && (
          <span style={{ color: "#6366f1", fontFamily: "'DM Mono',monospace", fontSize: 12, lineHeight: "1.9", flexShrink: 0, userSelect: "none", minWidth: 20 }}>
            {numIdx}.
          </span>
        )}
        {block.type === "todo" && (
          <button
            onMouseDown={e => e.preventDefault()}
            onClick={() => onToggleCheck(block.id)}
            style={{
              width: 17, height: 17, borderRadius: 4, flexShrink: 0, marginTop: 5,
              background: block.checked ? "#6366f1" : "transparent",
              border: `1.5px solid ${block.checked ? "#6366f1" : "#4b5563"}`,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s", padding: 0,
            }}
          >
            {block.checked && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 5L3.8 7.5L8.5 2.5" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        )}

        {/* Editable area + placeholder */}
        <div style={{ flex: 1, position: "relative" }}>
          <div
            ref={editRef}
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            style={{ ...blockStyle, outline: "none", minHeight: "1.5em" }}
          />
          {isEmpty && (
            <div style={{
              ...blockStyle,
              position: "absolute", top: 0, left: 0,
              color: "#2d3f55", pointerEvents: "none", userSelect: "none",
            }}>
              {placeholder}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Deal Link Picker ──────────────────────────────────────────────────────────
function DealLinkPicker({ transcriptId, linkMode, linkedDealId, deals, onLink }) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef(null);

  const currentDeal = linkedDealId && linkedDealId !== "__none__"
    ? deals.find(d => d.id === linkedDealId) : null;

  function openPicker(e) {
    e.stopPropagation();
    const rect = btnRef.current.getBoundingClientRect();
    setDropPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (!e.target.closest("[data-deallink-drop]")) setOpen(false);
    }
    setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const btnLabel = linkMode === "manual"
    ? `🔗 ${currentDeal?.name || "Linked"}`
    : linkMode === "auto"
      ? "✦ Auto"
      : "+ Link to deal";

  const btnStyle = {
    background: linkMode === "manual" ? "rgba(99,102,241,0.12)" : linkMode === "auto" ? "rgba(255,255,255,0.04)" : "transparent",
    border: `1px solid ${linkMode === "manual" ? "rgba(99,102,241,0.3)" : linkMode === "auto" ? "#334155" : "#334155"}`,
    borderRadius: 6, padding: "2px 8px", cursor: "pointer",
    fontSize: 10, fontFamily: "'DM Sans',sans-serif", fontWeight: 500,
    color: linkMode === "manual" ? "#a5b4fc" : linkMode === "auto" ? "#64748b" : "#475569",
    whiteSpace: "nowrap", flexShrink: 0,
  };

  const sortedDeals = [...deals].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  return (
    <>
      <button ref={btnRef} onClick={openPicker} style={btnStyle}
        onMouseEnter={e => { if (linkMode === "none") e.currentTarget.style.color = "#94a3b8"; }}
        onMouseLeave={e => { if (linkMode === "none") e.currentTarget.style.color = "#475569"; }}
      >
        {btnLabel}
      </button>

      {open && (
        <div
          data-deallink-drop
          style={{
            position: "fixed", top: dropPos.top, right: dropPos.right,
            background: "#1e293b", border: "1px solid #334155",
            borderRadius: 10, boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
            zIndex: 3000, minWidth: 220, maxHeight: 320, overflowY: "auto",
            fontFamily: "'DM Sans',sans-serif",
          }}
        >
          <div style={{ padding: "6px 12px 5px", borderBottom: "1px solid #1e3a5f", fontSize: 9, color: "#475569", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Link to deal
          </div>
          {[
            { id: "__auto__", label: "✦ Auto-detect", sub: "Use name / email matching" },
            { id: "__none__", label: "— No deal", sub: "Keep in unlinked" },
          ].map(opt => (
            <button
              key={opt.id}
              data-deallink-drop
              onClick={() => { onLink(opt.id === "__auto__" ? undefined : "__none__"); setOpen(false); }}
              style={{
                width: "100%", display: "flex", flexDirection: "column", alignItems: "flex-start",
                padding: "7px 12px", background: "transparent", border: "none",
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(99,102,241,0.1)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 500 }}>{opt.label}</span>
              <span style={{ fontSize: 10, color: "#475569" }}>{opt.sub}</span>
            </button>
          ))}
          <div style={{ borderTop: "1px solid #1e3a5f", margin: "4px 0" }} />
          {sortedDeals.map(d => (
            <button
              key={d.id}
              data-deallink-drop
              onClick={() => { onLink(d.id); setOpen(false); }}
              style={{
                width: "100%", display: "flex", alignItems: "center",
                padding: "7px 12px", background: "transparent", border: "none",
                cursor: "pointer", textAlign: "left",
                borderLeft: `2px solid ${d.id === linkedDealId ? "#6366f1" : "transparent"}`,
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(99,102,241,0.1)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ fontSize: 12, color: d.id === linkedDealId ? "#a5b4fc" : "#e2e8f0" }}>{d.name || "Unnamed deal"}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ── Meeting Todos Panel ───────────────────────────────────────────────────────
function MeetingTodosPanel({ currentUser }) {
  const [ffToken, setFfToken] = useState(() => getFirefliesToken());
  const [inputToken, setInputToken] = useState("");
  const [transcripts, setTranscripts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deals, setDeals] = useState([]);
  const [checked, setChecked] = useState({});
  const [meetingLinks, setMeetingLinks] = useState({}); // { transcriptId: dealId | "__none__" }
  const [collapsed, setCollapsed] = useState({});
  const [lastSync, setLastSync] = useState(null);
  const docRef = useRef(null);
  const didAutoSync = useRef(false);

  useEffect(() => {
    if (!currentUser) return;
    docRef.current = doc(db, "userNotes", currentUser.uid);

    const unsub = onSnapshot(docRef.current, snap => {
      if (snap.exists()) {
        setChecked(snap.data().meetingChecked || {});
        setMeetingLinks(snap.data().meetingDealLinks || {});
      }
    });

    getDocs(collection(db, "pipelineDeals")).then(snap => {
      setDeals(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    if (ffToken && !didAutoSync.current) {
      didAutoSync.current = true;
      doSync();
    }

    return unsub;
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  async function doSync() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTranscripts();
      setTranscripts(data);
      setLastSync(new Date());
    } catch (e) {
      if (e.message === "NO_TOKEN") setError("No API key set.");
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleChecked(key) {
    const next = { ...checked, [key]: !checked[key] };
    setChecked(next);
    if (docRef.current) {
      setDoc(docRef.current, { meetingChecked: next }, { merge: true }).catch(() => {});
    }
  }

  function toggleAllForMeeting(transcriptId, actionItems) {
    const keys = actionItems.map((_, idx) => `${transcriptId}_${idx}`);
    const allDone = keys.every(k => checked[k]);
    const next = { ...checked };
    keys.forEach(k => { next[k] = !allDone; });
    setChecked(next);
    if (docRef.current) {
      setDoc(docRef.current, { meetingChecked: next }, { merge: true }).catch(() => {});
    }
  }

  function saveToken() {
    const t = inputToken.trim();
    setFirefliesToken(t);
    setFfToken(t);
    setInputToken("");
    doSync();
  }

  function disconnect() {
    setFirefliesToken("");
    setFfToken("");
    setTranscripts(null);
    setError(null);
  }

  function saveMeetingLink(transcriptId, dealId) {
    setMeetingLinks(prev => {
      const next = { ...prev };
      if (dealId === undefined) delete next[transcriptId]; // revert to auto
      else next[transcriptId] = dealId;
      setDoc(docRef.current, { meetingDealLinks: next }, { merge: true }).catch(() => {});
      return next;
    });
  }

  function groupTranscripts(list) {
    const groups = {};
    for (const t of list) {
      const items = parseActionItems(t.summary?.action_items);
      if (!items.length) continue;

      let linked = null;
      let linkMode = "none"; // "auto" | "manual" | "none"
      const manualLink = meetingLinks[t.id];

      if (manualLink !== undefined) {
        if (manualLink === "__none__") {
          linkMode = "none";
        } else {
          linked = deals.find(d => d.id === manualLink) || null;
          linkMode = linked ? "manual" : "none";
        }
      } else {
        linked = matchDeal(t.title, t.participants, deals);
        linkMode = linked ? "auto" : "none";
      }

      const key = linked ? (linked.name || linked.id) : "__unlinked__";
      if (!groups[key]) groups[key] = { key, dealName: linked?.name || null, items: [] };
      groups[key].items.push({ transcript: t, actionItems: items, linked, linkMode });
    }
    return Object.values(groups).sort((a, b) => {
      if (a.key === "__unlinked__") return 1;
      if (b.key === "__unlinked__") return -1;
      return (a.dealName || "").localeCompare(b.dealName || "");
    });
  }

  // ── Not connected ─────────────────────────────────────────────────────────
  if (!ffToken) {
    return (
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "80px 40px", textAlign: "center" }}>
          <div style={{ fontSize: 42, marginBottom: 18 }}>🔥</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9", marginBottom: 10, fontFamily: "'DM Sans',sans-serif" }}>
            Connect Fireflies
          </h2>
          <p style={{ fontSize: 13, color: "#64748b", marginBottom: 28, fontFamily: "'DM Sans',sans-serif", lineHeight: 1.7 }}>
            Paste your Fireflies API key to pull action items from your meeting transcripts,
            automatically grouped by deal.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={inputToken}
              onChange={e => setInputToken(e.target.value)}
              onKeyDown={e => e.key === "Enter" && inputToken.trim() && saveToken()}
              placeholder="Fireflies API key…"
              type="password"
              style={{
                flex: 1, background: "#0f172a", border: "1px solid #334155", borderRadius: 8,
                padding: "10px 14px", color: "#e2e8f0", fontSize: 13,
                fontFamily: "'DM Mono',monospace", outline: "none",
              }}
            />
            <button
              onClick={saveToken}
              disabled={!inputToken.trim()}
              style={{
                background: "#6366f1", border: "none", borderRadius: 8, padding: "10px 18px",
                color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans',sans-serif",
                cursor: inputToken.trim() ? "pointer" : "not-allowed", opacity: inputToken.trim() ? 1 : 0.5,
              }}
            >
              Connect
            </button>
          </div>
          <p style={{ fontSize: 11, color: "#475569", marginTop: 14, fontFamily: "'DM Mono',monospace" }}>
            app.fireflies.ai → Integrations → API Key
          </p>
          {error && (
            <div style={{ marginTop: 16, padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, color: "#f87171", fontSize: 12, fontFamily: "'DM Sans',sans-serif" }}>
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Connected ─────────────────────────────────────────────────────────────
  const groups = transcripts ? groupTranscripts(transcripts) : [];

  // Split meetings into active/completed per group
  const activeGroups = [];
  const completedGroups = [];
  for (const group of groups) {
    const activeItems = [];
    const completedItems = [];
    for (const item of group.items) {
      const keys = item.actionItems.map((_, idx) => `${item.transcript.id}_${idx}`);
      const allDone = keys.length > 0 && keys.every(k => checked[k]);
      if (allDone) completedItems.push(item);
      else activeItems.push(item);
    }
    if (activeItems.length > 0) activeGroups.push({ ...group, items: activeItems });
    if (completedItems.length > 0) completedGroups.push({ ...group, items: completedItems });
  }

  const totalOpen = groups.reduce((sum, g) =>
    sum + g.items.reduce((s, item) =>
      s + item.actionItems.filter((_, idx) => !checked[`${item.transcript.id}_${idx}`]).length, 0), 0);
  const totalDone = groups.reduce((sum, g) =>
    sum + g.items.reduce((s, item) =>
      s + item.actionItems.filter((_, idx) => !!checked[`${item.transcript.id}_${idx}`]).length, 0), 0);

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "52px 80px 240px" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
          <h1 style={{
            fontSize: 38, fontWeight: 800, color: "#f1f5f9",
            fontFamily: "'DM Sans',sans-serif", flex: 1, margin: 0,
          }}>
            Meeting Todos
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {lastSync && (
              <span style={{ fontSize: 10, color: "#475569", fontFamily: "'DM Mono',monospace" }}>
                {lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={doSync}
              disabled={loading}
              style={{
                background: "#1e293b", border: "1px solid #334155", borderRadius: 8,
                padding: "7px 14px", color: loading ? "#475569" : "#e2e8f0",
                fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans',sans-serif",
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Syncing…" : "↻ Sync"}
            </button>
            <button
              onClick={disconnect}
              title="Disconnect Fireflies"
              style={{
                background: "transparent", border: "1px solid #334155", borderRadius: 8,
                padding: "7px 10px", color: "#64748b", fontSize: 11,
                fontFamily: "'DM Mono',monospace", cursor: "pointer",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#f87171"; e.currentTarget.style.color = "#f87171"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#334155"; e.currentTarget.style.color = "#64748b"; }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 10, padding: "12px 16px", marginBottom: 20,
            color: "#f87171", fontSize: 12, fontFamily: "'DM Sans',sans-serif",
          }}>
            {error}
          </div>
        )}

        {/* Loading / empty states */}
        {loading && !transcripts && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#475569", fontFamily: "'DM Mono',monospace", fontSize: 12 }}>
            Pulling from Fireflies…
          </div>
        )}
        {!loading && transcripts !== null && groups.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#475569", fontFamily: "'DM Sans',sans-serif", fontSize: 13 }}>
            No action items found in recent transcripts.
          </div>
        )}

        {/* Stats */}
        {groups.length > 0 && (
          <div style={{ display: "flex", gap: 12, marginBottom: 28 }}>
            {[
              { label: "Open", value: totalOpen, color: "#f1f5f9" },
              { label: "Done", value: totalDone, color: "#4ade80" },
              { label: "Deals", value: groups.filter(g => g.key !== "__unlinked__").length, color: "#a5b4fc" },
            ].map(stat => (
              <div key={stat.label} style={{
                background: "#1e293b", border: "1px solid #334155", borderRadius: 10,
                padding: "12px 18px", flex: 1,
              }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: stat.color, fontFamily: "'DM Mono',monospace" }}>
                  {stat.value}
                </div>
                <div style={{ fontSize: 10, color: "#64748b", fontFamily: "'DM Sans',sans-serif", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Active deal groups */}
        {activeGroups.map(group => {
          const isCollapsed = collapsed[group.key] !== false;
          const groupTotal = group.items.reduce((s, i) => s + i.actionItems.length, 0);
          const groupDone = group.items.reduce((s, item) =>
            s + item.actionItems.filter((_, idx) => !!checked[`${item.transcript.id}_${idx}`]).length, 0);

          return (
            <div key={group.key} style={{ marginBottom: 18 }}>
              {/* Group header */}
              <button
                onClick={() => setCollapsed(c => ({ ...c, [group.key]: c[group.key] === false }))}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  background: "transparent", border: "none", cursor: "pointer",
                  padding: "6px 0", marginBottom: isCollapsed ? 0 : 10, textAlign: "left",
                }}
              >
                <span style={{
                  color: "#475569", fontSize: 9, transition: "transform 0.15s",
                  transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)", display: "inline-block",
                }}>▼</span>
                <span style={{
                  fontSize: 13, fontWeight: group.key === "__unlinked__" ? 500 : 700,
                  color: group.key === "__unlinked__" ? "#64748b" : "#f1f5f9",
                  fontFamily: "'DM Sans',sans-serif",
                }}>
                  {group.key === "__unlinked__" ? "Unlinked Meetings" : group.dealName}
                </span>
                <span style={{
                  marginLeft: "auto", fontSize: 10, fontFamily: "'DM Mono',monospace",
                  color: groupDone === groupTotal ? "#4ade80" : "#64748b",
                }}>
                  {groupDone}/{groupTotal}
                </span>
              </button>

              {!isCollapsed && (
                <div style={{ border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden" }}>
                  {group.items.map((item, mIdx) => {
                    const rawDate = item.transcript.date;
                    const d = rawDate ? new Date(rawDate > 1e12 ? rawDate : rawDate * 1000) : null;
                    const dateStr = d && !isNaN(d) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
                    const meetingKeys = item.actionItems.map((_, idx) => `${item.transcript.id}_${idx}`);
                    const meetingAllDone = meetingKeys.length > 0 && meetingKeys.every(k => checked[k]);

                    return (
                      <div
                        key={item.transcript.id}
                        style={{ borderBottom: mIdx < group.items.length - 1 ? "1px solid #1e3a5f" : "none" }}
                      >
                        {/* Meeting sub-header */}
                        <div style={{
                          background: "#0f172a", padding: "9px 16px",
                          display: "flex", alignItems: "center", gap: 8,
                        }}>
                          <button
                            onClick={() => toggleAllForMeeting(item.transcript.id, item.actionItems)}
                            title={meetingAllDone ? "Uncheck all" : "Check all todos for this meeting"}
                            style={{
                              width: 17, height: 17, borderRadius: 4, flexShrink: 0,
                              background: meetingAllDone ? "#4ade80" : "transparent",
                              border: `1.5px solid ${meetingAllDone ? "#4ade80" : "#475569"}`,
                              cursor: "pointer", display: "flex", alignItems: "center",
                              justifyContent: "center", transition: "all 0.15s", padding: 0,
                            }}
                          >
                            {meetingAllDone && (
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M1.5 5L3.8 7.5L8.5 2.5" stroke="#09090e" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </button>
                          <span style={{ fontSize: 11, color: "#64748b", fontFamily: "'DM Sans',sans-serif", flex: 1, display: "flex", alignItems: "center", gap: 5 }}>
                            {item.transcript.title}
                            <a
                              href={`https://app.fireflies.ai/view/${item.transcript.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="View Fireflies notes"
                              style={{ color: "#475569", lineHeight: 1, flexShrink: 0 }}
                              onClick={e => e.stopPropagation()}
                            >
                              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M10 6.667V10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3.333" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M7.5 1H11v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M5 7L11 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </a>
                          </span>
                          {dateStr && (
                            <span style={{ fontSize: 10, color: "#334155", fontFamily: "'DM Mono',monospace" }}>
                              {dateStr}
                            </span>
                          )}
                          <DealLinkPicker
                            transcriptId={item.transcript.id}
                            linkMode={item.linkMode}
                            linkedDealId={item.linkMode === "manual" ? meetingLinks[item.transcript.id] : item.linked?.id}
                            deals={deals}
                            onLink={dealId => saveMeetingLink(item.transcript.id, dealId)}
                          />
                        </div>

                        {/* Action items */}
                        {item.actionItems.map((todo, idx) => {
                          const key = `${item.transcript.id}_${idx}`;
                          const isDone = !!checked[key];
                          return (
                            <div
                              key={key}
                              style={{
                                display: "flex", alignItems: "flex-start", gap: 10,
                                padding: "10px 16px", borderTop: "1px solid #0f172a",
                                background: isDone ? "rgba(74,222,128,0.025)" : "transparent",
                              }}
                            >
                              <button
                                onClick={() => toggleChecked(key)}
                                style={{
                                  width: 17, height: 17, borderRadius: 4, flexShrink: 0, marginTop: 2,
                                  background: isDone ? "#4ade80" : "transparent",
                                  border: `1.5px solid ${isDone ? "#4ade80" : "#334155"}`,
                                  cursor: "pointer", display: "flex", alignItems: "center",
                                  justifyContent: "center", transition: "all 0.15s", padding: 0,
                                }}
                              >
                                {isDone && (
                                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                    <path d="M1.5 5L3.8 7.5L8.5 2.5" stroke="#09090e" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </button>
                              <span style={{
                                fontSize: 13, color: isDone ? "#475569" : "#e2e8f0",
                                fontFamily: "'DM Sans',sans-serif", lineHeight: 1.55,
                                textDecoration: isDone ? "line-through" : "none",
                                transition: "color 0.15s",
                              }}>
                                {todo}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Completed section */}
        {completedGroups.length > 0 && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "32px 0 16px" }}>
              <div style={{ flex: 1, height: 1, background: "#1e3a5f" }} />
              <span style={{ fontSize: 10, color: "#475569", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Completed
              </span>
              <div style={{ flex: 1, height: 1, background: "#1e3a5f" }} />
            </div>

            {completedGroups.map(group => {
              const doneKey = `done_${group.key}`;
              const isCollapsed = collapsed[doneKey] !== false;
              const groupTotal = group.items.reduce((s, i) => s + i.actionItems.length, 0);

              return (
                <div key={group.key} style={{ marginBottom: 18, opacity: 0.6 }}>
                  <button
                    onClick={() => setCollapsed(c => ({ ...c, [doneKey]: c[doneKey] === false }))}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 8,
                      background: "transparent", border: "none", cursor: "pointer",
                      padding: "6px 0", marginBottom: isCollapsed ? 0 : 10, textAlign: "left",
                    }}
                  >
                    <span style={{
                      color: "#475569", fontSize: 9, transition: "transform 0.15s",
                      transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)", display: "inline-block",
                    }}>▼</span>
                    <span style={{
                      fontSize: 13, fontWeight: group.key === "__unlinked__" ? 500 : 700,
                      color: group.key === "__unlinked__" ? "#475569" : "#94a3b8",
                      fontFamily: "'DM Sans',sans-serif",
                    }}>
                      {group.key === "__unlinked__" ? "Unlinked Meetings" : group.dealName}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: "'DM Mono',monospace", color: "#4ade80" }}>
                      {groupTotal}/{groupTotal}
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div style={{ border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden" }}>
                      {group.items.map((item, mIdx) => {
                        const rawDate = item.transcript.date;
                        const d = rawDate ? new Date(rawDate > 1e12 ? rawDate : rawDate * 1000) : null;
                        const dateStr = d && !isNaN(d) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

                        return (
                          <div
                            key={item.transcript.id}
                            style={{ borderBottom: mIdx < group.items.length - 1 ? "1px solid #1e3a5f" : "none" }}
                          >
                            <div style={{
                              background: "#0f172a", padding: "9px 16px",
                              display: "flex", alignItems: "center", gap: 8,
                            }}>
                              <button
                                onClick={() => toggleAllForMeeting(item.transcript.id, item.actionItems)}
                                title="Uncheck all"
                                style={{
                                  width: 17, height: 17, borderRadius: 4, flexShrink: 0,
                                  background: "#4ade80", border: "1.5px solid #4ade80",
                                  cursor: "pointer", display: "flex", alignItems: "center",
                                  justifyContent: "center", padding: 0,
                                }}
                              >
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                  <path d="M1.5 5L3.8 7.5L8.5 2.5" stroke="#09090e" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </button>
                              <span style={{ fontSize: 11, color: "#475569", fontFamily: "'DM Sans',sans-serif", flex: 1, textDecoration: "line-through", display: "flex", alignItems: "center", gap: 5 }}>
                                {item.transcript.title}
                                <a
                                  href={`https://app.fireflies.ai/view/${item.transcript.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title="View Fireflies notes"
                                  style={{ color: "#475569", lineHeight: 1, flexShrink: 0, textDecoration: "none" }}
                                  onClick={e => e.stopPropagation()}
                                >
                                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M10 6.667V10a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3.333" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M7.5 1H11v3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M5 7L11 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                </a>
                              </span>
                              {dateStr && (
                                <span style={{ fontSize: 10, color: "#334155", fontFamily: "'DM Mono',monospace" }}>
                                  {dateStr}
                                </span>
                              )}
                            </div>
                            {item.actionItems.map((todo, idx) => {
                              const key = `${item.transcript.id}_${idx}`;
                              return (
                                <div
                                  key={key}
                                  style={{
                                    display: "flex", alignItems: "flex-start", gap: 10,
                                    padding: "10px 16px", borderTop: "1px solid #0f172a",
                                    background: "rgba(74,222,128,0.025)",
                                  }}
                                >
                                  <button
                                    onClick={() => toggleChecked(key)}
                                    style={{
                                      width: 17, height: 17, borderRadius: 4, flexShrink: 0, marginTop: 2,
                                      background: "#4ade80", border: "1.5px solid #4ade80",
                                      cursor: "pointer", display: "flex", alignItems: "center",
                                      justifyContent: "center", padding: 0,
                                    }}
                                  >
                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                      <path d="M1.5 5L3.8 7.5L8.5 2.5" stroke="#09090e" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  </button>
                                  <span style={{
                                    fontSize: 13, color: "#475569",
                                    fontFamily: "'DM Sans',sans-serif", lineHeight: 1.55,
                                    textDecoration: "line-through",
                                  }}>
                                    {todo}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ── Main TodosPage ─────────────────────────────────────────────────────────────
export default function TodosPage({ currentUser }) {
  const [activeTab, setActiveTab] = useState("notes");
  const [blocks, setBlocks] = useState([newBlock()]);
  const [title, setTitle] = useState("");
  const [titleEmpty, setTitleEmpty] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [slashState, setSlashState] = useState(null);
  const [formatBar, setFormatBar] = useState(null);
  const [saving, setSaving] = useState(false);

  const blockRefs = useRef({});
  const saveTimerRef = useRef(null);
  const docRef = useRef(null);
  const titleDivRef = useRef(null);
  const currentTitle = useRef("");
  const currentBlocks = useRef([]);

  useEffect(() => { currentTitle.current = title; }, [title]);
  useEffect(() => { currentBlocks.current = blocks; }, [blocks]);

  // Load from Firestore (once per session)
  useEffect(() => {
    if (!currentUser) return;
    docRef.current = doc(db, "userNotes", currentUser.uid);
    let firstLoad = true;
    const unsub = onSnapshot(docRef.current, snap => {
      if (!firstLoad) return;
      firstLoad = false;
      if (snap.exists()) {
        const data = snap.data();
        const t = data.title || "";
        const b = data.blocks?.length ? data.blocks : [newBlock()];
        setTitle(t);
        setTitleEmpty(!t.trim());
        setBlocks(b);
        currentTitle.current = t;
        currentBlocks.current = b;
        if (titleDivRef.current) titleDivRef.current.innerText = t;
      } else {
        setBlocks([newBlock()]);
        setTitle("");
        setTitleEmpty(true);
      }
      setLoaded(true);
    });
    return unsub;
  }, [currentUser]);

  // Flush save on unmount
  useEffect(() => {
    return () => {
      clearTimeout(saveTimerRef.current);
      if (docRef.current) {
        setDoc(docRef.current, {
          blocks: currentBlocks.current,
          title: currentTitle.current,
          updatedAt: Date.now(),
        }).catch(() => {});
      }
    };
  }, []);

  function scheduleSave(newBlocks, newTitle) {
    if (!docRef.current) return;
    clearTimeout(saveTimerRef.current);
    setSaving(true);
    saveTimerRef.current = setTimeout(async () => {
      await setDoc(docRef.current, { blocks: newBlocks, title: newTitle, updatedAt: Date.now() });
      setSaving(false);
    }, 1500);
  }

  const registerRef = useCallback((id, el) => {
    if (el) blockRefs.current[id] = el;
    else delete blockRefs.current[id];
  }, []);

  function focusBlock(id, atEnd = true) {
    setTimeout(() => {
      const el = blockRefs.current[id];
      if (el) atEnd ? setCursorEnd(el) : setCursorStart(el);
    }, 20);
  }

  // ── Block operations ──────────────────────────────────────────────────────
  function handleContentChange(id, html) {
    setBlocks(prev => {
      const next = prev.map(b => b.id === id ? { ...b, content: html } : b);
      scheduleSave(next, currentTitle.current);
      return next;
    });
  }

  function handleTypeChange(id, newType) {
    setBlocks(prev => {
      const next = prev.map(b => b.id === id ? { ...b, type: newType } : b);
      scheduleSave(next, currentTitle.current);
      return next;
    });
    // Clear slash command text from DOM
    setTimeout(() => {
      const el = blockRefs.current[id];
      if (el) {
        const raw = el.innerText || "";
        if (raw.startsWith("/")) {
          el.innerHTML = "";
          setBlocks(prev => {
            const next = prev.map(b => b.id === id ? { ...b, content: "" } : b);
            scheduleSave(next, currentTitle.current);
            return next;
          });
        }
        setCursorStart(el);
      }
    }, 20);
    setSlashState(null);
  }

  function handleToggleCheck(id) {
    setBlocks(prev => {
      const next = prev.map(b => b.id === id ? { ...b, checked: !b.checked } : b);
      scheduleSave(next, currentTitle.current);
      return next;
    });
  }

  function handleEnter(id) {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id);
      const cur = prev[idx];
      const nextType = ["bullet", "numbered", "todo"].includes(cur.type) ? cur.type : "text";
      const nb = newBlock(nextType);
      const next = [...prev.slice(0, idx + 1), nb, ...prev.slice(idx + 1)];
      scheduleSave(next, currentTitle.current);
      focusBlock(nb.id, false);
      return next;
    });
  }

  function handleDeleteBlock(id) {
    setBlocks(prev => {
      if (prev.length === 1) {
        const cleared = [{ ...prev[0], content: "", type: "text" }];
        setTimeout(() => {
          const el = blockRefs.current[cleared[0].id];
          if (el) { el.innerHTML = ""; setCursorStart(el); }
        }, 10);
        scheduleSave(cleared, currentTitle.current);
        return cleared;
      }
      const idx = prev.findIndex(b => b.id === id);
      const next = prev.filter(b => b.id !== id);
      scheduleSave(next, currentTitle.current);
      const target = prev[idx - 1] || prev[idx + 1];
      if (target) setTimeout(() => {
        const el = blockRefs.current[target.id];
        if (el) setCursorEnd(el);
      }, 10);
      return next;
    });
  }

  function handleFocusPrev(id) {
    const bs = currentBlocks.current;
    const idx = bs.findIndex(b => b.id === id);
    if (idx > 0) {
      const prev = bs[idx - 1];
      if (prev.type === "divider" && idx - 1 > 0) focusBlock(bs[idx - 2].id, true);
      else if (prev.type !== "divider") focusBlock(prev.id, true);
    }
  }

  function handleFocusNext(id) {
    const bs = currentBlocks.current;
    const idx = bs.findIndex(b => b.id === id);
    if (idx < bs.length - 1) {
      const next = bs[idx + 1];
      if (next.type === "divider" && idx + 2 < bs.length) focusBlock(bs[idx + 2].id, false);
      else if (next.type !== "divider") focusBlock(next.id, false);
    }
  }

  // Format bar on text selection
  useEffect(() => {
    function onSelChange() {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.width > 5) { setFormatBar({ x: rect.left + rect.width / 2 - 95, y: rect.top }); return; }
      }
      setFormatBar(null);
    }
    document.addEventListener("selectionchange", onSelChange);
    return () => document.removeEventListener("selectionchange", onSelChange);
  }, []);

  // Close slash menu on outside click
  useEffect(() => {
    if (!slashState) return;
    function onDown() { setSlashState(null); }
    setTimeout(() => document.addEventListener("mousedown", onDown), 50);
    return () => document.removeEventListener("mousedown", onDown);
  }, [slashState]);

  if (!loaded) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <span style={{ color: "#64748b", fontFamily: "'DM Mono',monospace", fontSize: 12 }}>Loading…</span>
      </div>
    );
  }

  const tabs = [
    { id: "notes", label: "Notes" },
    { id: "meetings", label: "Meeting Todos" },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg)", position: "relative", overflow: "hidden" }}>

      {/* Tab bar */}
      <div style={{ borderBottom: "1px solid #1e3a5f", padding: "0 80px", display: "flex", gap: 0, flexShrink: 0 }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: "transparent", border: "none",
              borderBottom: `2px solid ${activeTab === tab.id ? "#6366f1" : "transparent"}`,
              padding: "11px 16px", marginBottom: -1,
              color: activeTab === tab.id ? "#a5b4fc" : "#64748b",
              fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans',sans-serif",
              cursor: "pointer", transition: "color 0.15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Notes tab */}
      {activeTab === "notes" && (
        <div style={{ flex: 1, overflowY: "auto", position: "relative" }}>
          <div style={{ maxWidth: 720, margin: "0 auto", padding: "52px 80px 240px" }}>

            {/* Page title */}
            <div style={{ position: "relative", marginBottom: 36 }}>
              <div
                ref={titleDivRef}
                contentEditable
                suppressContentEditableWarning
                onInput={e => {
                  const t = e.currentTarget.innerText;
                  setTitle(t); setTitleEmpty(!t.trim());
                  scheduleSave(currentBlocks.current, t);
                }}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (blocks.length > 0) focusBlock(blocks[0].id, false);
                  }
                }}
                style={{
                  fontSize: 38, fontWeight: 800, color: "var(--text)",
                  fontFamily: "'DM Sans',sans-serif", outline: "none",
                  lineHeight: 1.2, wordBreak: "break-word", minHeight: 46,
                }}
              />
              {titleEmpty && (
                <div style={{
                  position: "absolute", top: 0, left: 0, pointerEvents: "none", userSelect: "none",
                  fontSize: 38, fontWeight: 800, color: "#1e3a5f",
                  fontFamily: "'DM Sans',sans-serif", lineHeight: 1.2,
                }}>
                  Untitled
                </div>
              )}
            </div>

            {/* Blocks */}
            <div style={{ paddingLeft: 36 }}>
              {blocks.map((block, i) => (
                <BlockRow
                  key={block.id}
                  block={block}
                  blocks={blocks}
                  blockIdx={i}
                  onContentChange={handleContentChange}
                  onTypeChange={handleTypeChange}
                  onToggleCheck={handleToggleCheck}
                  onEnter={handleEnter}
                  onDeleteBlock={handleDeleteBlock}
                  onFocusPrev={handleFocusPrev}
                  onFocusNext={handleFocusNext}
                  onSlashOpen={(blockId, filter, pos) => setSlashState({ blockId, filter, pos })}
                  onSlashClose={() => setSlashState(null)}
                  isSlashActive={slashState?.blockId === block.id}
                  registerRef={registerRef}
                />
              ))}
            </div>

            {/* Click empty space below to append a block */}
            <div
              style={{ height: 200, paddingLeft: 36, cursor: "text" }}
              onClick={() => {
                const last = blocks[blocks.length - 1];
                if (!last) return;
                const el = blockRefs.current[last.id];
                if (el) {
                  const txt = el.innerText?.trim();
                  if (!txt) setCursorEnd(el);
                  else handleEnter(last.id);
                }
              }}
            />
          </div>

          {/* Slash menu */}
          {slashState && (
            <SlashMenu
              filter={slashState.filter}
              pos={slashState.pos}
              onSelect={type => handleTypeChange(slashState.blockId, type)}
              onClose={() => setSlashState(null)}
            />
          )}

          {/* Inline format toolbar */}
          {formatBar && <FormatBar x={formatBar.x} y={formatBar.y} />}
        </div>
      )}

      {/* Meeting Todos tab */}
      {activeTab === "meetings" && (
        <MeetingTodosPanel currentUser={currentUser} />
      )}

      {/* Save status (notes tab only) */}
      {activeTab === "notes" && (
        <div style={{
          position: "fixed", bottom: 16, right: 20,
          fontSize: 10, fontFamily: "'DM Mono',monospace",
          color: saving ? "#64748b" : "#1e3a5f",
          transition: "color 0.5s", userSelect: "none", pointerEvents: "none",
        }}>
          {saving ? "Saving…" : "All saved"}
        </div>
      )}
    </div>
  );
}
