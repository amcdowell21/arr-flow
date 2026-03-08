import { useState, useEffect, useRef, useCallback } from "react";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc } from "firebase/firestore";

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

// ── Main TodosPage ─────────────────────────────────────────────────────────────
export default function TodosPage({ currentUser }) {
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

  return (
    <div style={{ flex: 1, overflowY: "auto", background: "var(--bg)", position: "relative" }}>
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

      {/* Save status */}
      <div style={{
        position: "fixed", bottom: 16, right: 20,
        fontSize: 10, fontFamily: "'DM Mono',monospace",
        color: saving ? "#64748b" : "#1e3a5f",
        transition: "color 0.5s", userSelect: "none", pointerEvents: "none",
      }}>
        {saving ? "Saving…" : "All saved"}
      </div>
    </div>
  );
}
