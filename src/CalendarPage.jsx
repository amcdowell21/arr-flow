import { useState, useEffect, useCallback, useMemo } from "react";
import { db } from "./firebase";
import { collection, addDoc, getDocs, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { listEvents, createEvent, updateEvent, deleteEvent as deleteCalEvent } from "./gcal";

// ─── Google Connection Banner ───────────────────────────────────────────────
function ConnectBanner({ uid }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100%", gap: 20, padding: 40,
    }}>
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <rect x="6" y="8" width="36" height="32" rx="4" stroke="#14b8a6" strokeWidth="2.5" fill="none" />
        <line x1="6" y1="18" x2="42" y2="18" stroke="#14b8a6" strokeWidth="2" />
        <line x1="18" y1="8" x2="18" y2="18" stroke="#14b8a6" strokeWidth="2" />
        <line x1="30" y1="8" x2="30" y2="18" stroke="#14b8a6" strokeWidth="2" />
        <circle cx="16" cy="26" r="2" fill="#14b8a6" />
        <circle cx="24" cy="26" r="2" fill="#14b8a6" />
        <circle cx="32" cy="26" r="2" fill="#14b8a6" />
        <circle cx="16" cy="34" r="2" fill="#14b8a6" opacity="0.5" />
        <circle cx="24" cy="34" r="2" fill="#14b8a6" opacity="0.5" />
      </svg>
      <h2 style={{ fontSize: 20, fontWeight: 600, color: "var(--text)", margin: 0 }}>Connect Google Calendar</h2>
      <p style={{ fontSize: 13, color: "var(--text-faint)", textAlign: "center", maxWidth: 340, lineHeight: 1.6 }}>
        Connect your Google account to view and manage your calendar directly from ARR Flow.
      </p>
      <button
        onClick={() => { window.location.href = `/api/google-auth?uid=${uid}`; }}
        style={{
          background: "#14b8a6", color: "#fff", border: "none", borderRadius: 10,
          padding: "12px 28px", fontSize: 14, fontWeight: 600, cursor: "pointer",
          fontFamily: "'DM Sans',sans-serif",
        }}
      >
        Connect Google
      </button>
    </div>
  );
}

// ─── Create/Edit Event Modal ────────────────────────────────────────────────
function EventModal({ uid, event, onClose, onSaved }) {
  const isEdit = !!event?.id;
  const [title, setTitle] = useState(event?.summary || "");
  const [date, setDate] = useState(event?.start?.dateTime?.slice(0, 10) || event?.start?.date || new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState(event?.start?.dateTime?.slice(11, 16) || "09:00");
  const [endTime, setEndTime] = useState(event?.end?.dateTime?.slice(11, 16) || "10:00");
  const [allDay, setAllDay] = useState(!!event?.start?.date && !event?.start?.dateTime);
  const [description, setDescription] = useState(event?.description || "");
  const [attendees, setAttendees] = useState((event?.attendees || []).map(a => a.email).join(", "));
  const [location, setLocation] = useState(event?.location || "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const body = {
        summary: title,
        description,
        location,
      };

      if (allDay) {
        body.start = { date };
        body.end = { date };
      } else {
        body.start = { dateTime: `${date}T${startTime}:00`, timeZone: tz };
        body.end = { dateTime: `${date}T${endTime}:00`, timeZone: tz };
      }

      if (attendees.trim()) {
        body.attendees = attendees.split(",").map(e => ({ email: e.trim() })).filter(a => a.email);
      }

      if (isEdit) {
        await updateEvent(uid, event.id, body);
      } else {
        await createEvent(uid, body);
      }
      onSaved?.();
      onClose();
    } catch (e) {
      alert("Failed to save event: " + e.message);
    }
    setSaving(false);
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
        width: 480, display: "flex", flexDirection: "column", overflow: "hidden",
      }} onClick={e => e.stopPropagation()}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: "1px solid var(--border)",
        }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
            {isEdit ? "Edit Event" : "New Event"}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 18 }}>
            &times;
          </button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <input placeholder="Event title" value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ ...inputStyle, flex: 1 }} />
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text-faint)", whiteSpace: "nowrap", cursor: "pointer" }}>
              <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} />
              All day
            </label>
          </div>

          {!allDay && (
            <div style={{ display: "flex", gap: 8 }}>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                style={{ ...inputStyle, flex: 1 }} />
              <span style={{ color: "var(--text-faint)", alignSelf: "center", fontSize: 12 }}>to</span>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                style={{ ...inputStyle, flex: 1 }} />
            </div>
          )}

          <input placeholder="Location" value={location} onChange={e => setLocation(e.target.value)} style={inputStyle} />
          <input placeholder="Attendees (comma-separated emails)" value={attendees} onChange={e => setAttendees(e.target.value)} style={inputStyle} />
          <textarea
            placeholder="Description"
            value={description} onChange={e => setDescription(e.target.value)}
            rows={4} style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={{
            background: saving ? "#4b5563" : "#14b8a6", color: "#fff", border: "none",
            borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600,
            cursor: saving ? "default" : "pointer", fontFamily: "'DM Sans',sans-serif",
          }}>
            {saving ? "Saving..." : isEdit ? "Update" : "Create"}
          </button>
          <button onClick={onClose} style={{
            background: "transparent", border: "1px solid var(--border)", borderRadius: 8,
            padding: "9px 16px", fontSize: 13, color: "var(--text-faint)", cursor: "pointer",
            fontFamily: "'DM Sans',sans-serif",
          }}>
            Cancel
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

  const filtered = deals.filter(d => d.name?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{
      position: "absolute", top: "100%", right: 0, zIndex: 100, marginTop: 4,
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
      width: 280, maxHeight: 300, display: "flex", flexDirection: "column", overflow: "hidden",
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    }}>
      <input
        autoFocus placeholder="Search deals..."
        value={search} onChange={e => setSearch(e.target.value)}
        style={{
          background: "var(--input-bg)", border: "none", borderBottom: "1px solid var(--border)",
          padding: "10px 12px", fontSize: 12, color: "var(--text)", outline: "none",
          fontFamily: "'DM Sans',sans-serif",
        }}
      />
      <div style={{ overflow: "auto", flex: 1 }}>
        {loading && <div style={{ padding: 12, fontSize: 12, color: "var(--text-faint)" }}>Loading...</div>}
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

// ─── Helper functions ───────────────────────────────────────────────────────
function getWeekDays(date) {
  const d = new Date(date);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));

  const days = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    days.push(dd);
  }
  return days;
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

function formatHour(h) {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6 AM to 9 PM
const HOUR_HEIGHT = 60;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ─── Main CalendarPage ──────────────────────────────────────────────────────
export default function CalendarPage({ currentUser }) {
  const [connected, setConnected] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState("week"); // week, month
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [dealTags, setDealTags] = useState({}); // { calendarEventId: { dealId, dealName, docId } }
  const [showDealPicker, setShowDealPicker] = useState(false);

  const uid = currentUser?.uid;
  const today = useMemo(() => new Date(), []);

  // Check connection
  useEffect(() => {
    if (!uid) return;
    fetch(`/api/google-token?uid=${uid}`)
      .then(r => r.json())
      .then(data => setConnected(data.connected))
      .catch(() => setConnected(false));
  }, [uid]);

  // Load deal tags
  useEffect(() => {
    if (!uid) return;
    getDocs(collection(db, "dealCalendarEvents")).then(snap => {
      const tags = {};
      snap.docs.forEach(d => {
        const data = d.data();
        tags[data.calendarEventId] = { dealId: data.dealId, dealName: data.dealName, docId: d.id };
      });
      setDealTags(tags);
    });
  }, [uid]);

  // Fetch events for current view
  const fetchEvents = useCallback(async () => {
    if (!uid || !connected) return;
    setLoading(true);
    try {
      let timeMin, timeMax;
      if (viewMode === "week") {
        const days = getWeekDays(currentDate);
        timeMin = new Date(days[0]);
        timeMin.setHours(0, 0, 0, 0);
        timeMax = new Date(days[6]);
        timeMax.setHours(23, 59, 59, 999);
      } else {
        timeMin = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        timeMax = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59, 999);
        // Include surrounding days for month view
        const startDay = timeMin.getDay();
        timeMin.setDate(timeMin.getDate() - (startDay === 0 ? 6 : startDay - 1));
        timeMax.setDate(timeMax.getDate() + (7 - (timeMax.getDay() || 7)));
      }

      const data = await listEvents(uid, timeMin.toISOString(), timeMax.toISOString());
      setEvents(data.items || []);
    } catch (e) {
      console.error("Failed to fetch calendar events:", e);
    }
    setLoading(false);
  }, [uid, connected, currentDate, viewMode]);

  useEffect(() => {
    if (connected) fetchEvents();
  }, [connected, currentDate, viewMode]);

  function navigate(dir) {
    const d = new Date(currentDate);
    if (viewMode === "week") d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setCurrentDate(d);
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  async function handleDeleteEvent(eventId) {
    if (!confirm("Delete this event?")) return;
    try {
      await deleteCalEvent(uid, eventId);
      setSelectedEvent(null);
      fetchEvents();
    } catch (e) {
      alert("Failed to delete: " + e.message);
    }
  }

  async function handleTagDeal(deal) {
    if (!selectedEvent) return;
    try {
      const docRef = await addDoc(collection(db, "dealCalendarEvents"), {
        dealId: deal.id,
        dealName: deal.name,
        calendarEventId: selectedEvent.id,
        calendarId: "primary",
        title: selectedEvent.summary,
        startTime: selectedEvent.start?.dateTime || selectedEvent.start?.date,
        endTime: selectedEvent.end?.dateTime || selectedEvent.end?.date,
        taggedBy: uid,
        taggedAt: serverTimestamp(),
      });
      setDealTags(prev => ({ ...prev, [selectedEvent.id]: { dealId: deal.id, dealName: deal.name, docId: docRef.id } }));
    } catch (e) {
      alert("Failed to tag deal: " + e.message);
    }
  }

  async function handleUntagDeal(eventId) {
    const tag = dealTags[eventId];
    if (!tag?.docId) return;
    await deleteDoc(doc(db, "dealCalendarEvents", tag.docId));
    setDealTags(prev => { const n = { ...prev }; delete n[eventId]; return n; });
  }

  if (connected === null) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-faint)", fontSize: 13 }}>Loading...</div>;
  }
  if (!connected) return <ConnectBanner uid={uid} />;

  // ─── Week View ────────────────────────────────────────────────────────────
  const weekDays = getWeekDays(currentDate);
  const weekTitle = `${MONTH_NAMES[weekDays[0].getMonth()]} ${weekDays[0].getDate()} – ${weekDays[0].getMonth() !== weekDays[6].getMonth() ? MONTH_NAMES[weekDays[6].getMonth()] + " " : ""}${weekDays[6].getDate()}, ${weekDays[6].getFullYear()}`;

  function getEventPosition(evt) {
    const start = new Date(evt.start?.dateTime || evt.start?.date);
    const end = new Date(evt.end?.dateTime || evt.end?.date);
    const startHour = start.getHours() + start.getMinutes() / 60;
    const endHour = end.getHours() + end.getMinutes() / 60;
    const top = (startHour - 6) * HOUR_HEIGHT;
    const height = Math.max((endHour - startHour) * HOUR_HEIGHT, 20);
    return { top, height };
  }

  function renderWeekView() {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Day headers */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ width: 60, flexShrink: 0 }} />
          {weekDays.map((day, i) => {
            const isToday = isSameDay(day, today);
            return (
              <div key={i} style={{
                flex: 1, padding: "10px 4px", textAlign: "center",
                borderLeft: "1px solid var(--border)",
              }}>
                <div style={{ fontSize: 10, color: "var(--text-faint)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {DAY_NAMES[i]}
                </div>
                <div style={{
                  fontSize: 18, fontWeight: 600, marginTop: 2,
                  color: isToday ? "#14b8a6" : "var(--text)",
                  ...(isToday ? { background: "rgba(20,184,166,0.15)", borderRadius: "50%", width: 32, height: 32, lineHeight: "32px", margin: "2px auto 0" } : {}),
                }}>
                  {day.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Time grid */}
        <div style={{ flex: 1, overflow: "auto", display: "flex" }}>
          {/* Time labels */}
          <div style={{ width: 60, flexShrink: 0 }}>
            {HOURS.map(h => (
              <div key={h} style={{
                height: HOUR_HEIGHT, display: "flex", alignItems: "flex-start", justifyContent: "flex-end",
                paddingRight: 8, paddingTop: 0,
              }}>
                <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "'DM Mono',monospace", transform: "translateY(-6px)" }}>
                  {formatHour(h)}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map((day, dayIdx) => {
            const dayEvents = events.filter(e => {
              const start = new Date(e.start?.dateTime || e.start?.date);
              return isSameDay(start, day);
            });
            const isToday = isSameDay(day, today);

            return (
              <div
                key={dayIdx}
                style={{
                  flex: 1, position: "relative", borderLeft: "1px solid var(--border)",
                  background: isToday ? "rgba(20,184,166,0.03)" : "transparent",
                  cursor: "pointer",
                }}
                onClick={(e) => {
                  if (e.target === e.currentTarget || e.target.closest("[data-grid-cell]")) {
                    setEditEvent({ start: { dateTime: `${day.toISOString().slice(0, 10)}T09:00:00` }, end: { dateTime: `${day.toISOString().slice(0, 10)}T10:00:00` } });
                    setShowEventModal(true);
                  }
                }}
              >
                {/* Hour lines */}
                {HOURS.map(h => (
                  <div key={h} data-grid-cell style={{
                    height: HOUR_HEIGHT, borderBottom: "1px solid var(--border)",
                    opacity: 0.5,
                  }} />
                ))}

                {/* Events */}
                {dayEvents.map(evt => {
                  if (!evt.start?.dateTime) return null; // skip all-day for now
                  const pos = getEventPosition(evt);
                  const tag = dealTags[evt.id];
                  return (
                    <div
                      key={evt.id}
                      onClick={(e) => { e.stopPropagation(); setSelectedEvent(evt); }}
                      style={{
                        position: "absolute", left: 2, right: 2, top: pos.top, height: pos.height,
                        background: tag ? "rgba(99,102,241,0.2)" : "rgba(20,184,166,0.15)",
                        borderLeft: `3px solid ${tag ? "#6366f1" : "#14b8a6"}`,
                        borderRadius: 4, padding: "3px 6px", cursor: "pointer",
                        overflow: "hidden", fontSize: 11, color: "var(--text)",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = tag ? "rgba(99,102,241,0.3)" : "rgba(20,184,166,0.25)"}
                      onMouseLeave={e => e.currentTarget.style.background = tag ? "rgba(99,102,241,0.2)" : "rgba(20,184,166,0.15)"}
                    >
                      <div style={{ fontWeight: 600, fontSize: 11, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {evt.summary || "(no title)"}
                      </div>
                      {pos.height > 30 && (
                        <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 1, fontFamily: "'DM Mono',monospace" }}>
                          {new Date(evt.start.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </div>
                      )}
                      {tag && pos.height > 45 && (
                        <span style={{
                          fontSize: 8, fontWeight: 700, background: "rgba(99,102,241,0.3)",
                          color: "#a5b4fc", borderRadius: 3, padding: "1px 4px", marginTop: 2,
                          display: "inline-block",
                        }}>
                          {tag.dealName}
                        </span>
                      )}
                    </div>
                  );
                })}

                {/* All-day events at top */}
                {dayEvents.filter(e => e.start?.date && !e.start?.dateTime).map(evt => {
                  const tag = dealTags[evt.id];
                  return (
                    <div
                      key={evt.id}
                      onClick={(e) => { e.stopPropagation(); setSelectedEvent(evt); }}
                      style={{
                        position: "absolute", left: 2, right: 2, top: 0, height: 22,
                        background: tag ? "rgba(99,102,241,0.25)" : "rgba(20,184,166,0.2)",
                        borderRadius: 3, padding: "2px 6px", cursor: "pointer",
                        fontSize: 10, fontWeight: 600, color: "var(--text)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {evt.summary || "(no title)"}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── Month View ───────────────────────────────────────────────────────────
  function renderMonthView() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const startDay = firstDay.getDay();
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - (startDay === 0 ? 6 : startDay - 1));

    const weeks = [];
    const d = new Date(startDate);
    for (let w = 0; w < 6; w++) {
      const week = [];
      for (let day = 0; day < 7; day++) {
        week.push(new Date(d));
        d.setDate(d.getDate() + 1);
      }
      weeks.push(week);
      // Stop if we've gone past this month and have at least 4 weeks
      if (w >= 3 && week[6].getMonth() !== month) break;
    }

    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Day headers */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
          {DAY_NAMES.map(name => (
            <div key={name} style={{
              flex: 1, padding: "8px 4px", textAlign: "center",
              fontSize: 10, fontWeight: 600, color: "var(--text-faint)",
              textTransform: "uppercase", letterSpacing: "0.05em",
            }}>
              {name}
            </div>
          ))}
        </div>

        {/* Weeks */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ flex: 1, display: "flex", borderBottom: "1px solid var(--border)", minHeight: 80 }}>
              {week.map((day, di) => {
                const isCurrentMonth = day.getMonth() === month;
                const isToday = isSameDay(day, today);
                const dayEvents = events.filter(e => {
                  const start = new Date(e.start?.dateTime || e.start?.date);
                  return isSameDay(start, day);
                });

                return (
                  <div
                    key={di}
                    style={{
                      flex: 1, padding: 4, borderLeft: di > 0 ? "1px solid var(--border)" : "none",
                      opacity: isCurrentMonth ? 1 : 0.4, cursor: "pointer",
                      background: isToday ? "rgba(20,184,166,0.05)" : "transparent",
                    }}
                    onClick={() => {
                      setEditEvent({ start: { dateTime: `${day.toISOString().slice(0, 10)}T09:00:00` }, end: { dateTime: `${day.toISOString().slice(0, 10)}T10:00:00` } });
                      setShowEventModal(true);
                    }}
                  >
                    <div style={{
                      fontSize: 12, fontWeight: 600, marginBottom: 2,
                      color: isToday ? "#14b8a6" : "var(--text)",
                      ...(isToday ? { background: "rgba(20,184,166,0.2)", borderRadius: "50%", width: 22, height: 22, lineHeight: "22px", textAlign: "center" } : { paddingLeft: 2 }),
                    }}>
                      {day.getDate()}
                    </div>
                    {dayEvents.slice(0, 3).map(evt => (
                      <div
                        key={evt.id}
                        onClick={(e) => { e.stopPropagation(); setSelectedEvent(evt); }}
                        style={{
                          fontSize: 10, padding: "1px 4px", marginBottom: 1,
                          background: dealTags[evt.id] ? "rgba(99,102,241,0.2)" : "rgba(20,184,166,0.15)",
                          borderRadius: 3, overflow: "hidden", textOverflow: "ellipsis",
                          whiteSpace: "nowrap", color: "var(--text)", cursor: "pointer",
                        }}
                      >
                        {evt.summary || "(no title)"}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div style={{ fontSize: 9, color: "var(--text-faint)", paddingLeft: 4 }}>
                        +{dayEvents.length - 3} more
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "12px 20px",
        borderBottom: "1px solid var(--border)", flexShrink: 0,
      }}>
        <button onClick={() => navigate(-1)} style={{
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
          width: 30, height: 30, cursor: "pointer", color: "var(--text-faint)", fontSize: 14,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          &lsaquo;
        </button>
        <button onClick={() => navigate(1)} style={{
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
          width: 30, height: 30, cursor: "pointer", color: "var(--text-faint)", fontSize: 14,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          &rsaquo;
        </button>
        <button onClick={goToday} style={{
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
          padding: "5px 12px", fontSize: 12, color: "var(--text-secondary)", cursor: "pointer",
          fontFamily: "'DM Sans',sans-serif", fontWeight: 500,
        }}>
          Today
        </button>

        <h2 style={{ fontSize: 17, fontWeight: 600, color: "var(--text)", margin: 0, flex: 1 }}>
          {viewMode === "week" ? weekTitle : `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`}
        </h2>

        {/* View toggle */}
        <div style={{ display: "flex", gap: 2, background: "var(--surface)", borderRadius: 6, border: "1px solid var(--border)", padding: 2 }}>
          {["week", "month"].map(v => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              style={{
                padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "none",
                borderRadius: 4, cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
                background: viewMode === v ? "rgba(20,184,166,0.15)" : "transparent",
                color: viewMode === v ? "#14b8a6" : "var(--text-faint)",
              }}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        <button
          onClick={() => { setEditEvent(null); setShowEventModal(true); }}
          style={{
            background: "#14b8a6", color: "#fff", border: "none", borderRadius: 8,
            padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
            fontFamily: "'DM Sans',sans-serif",
          }}
        >
          + Event
        </button>
      </div>

      {loading && events.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-faint)", fontSize: 13 }}>
          Loading events...
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Calendar */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {viewMode === "week" ? renderWeekView() : renderMonthView()}
          </div>

          {/* Event detail side panel */}
          {selectedEvent && (
            <div style={{
              width: 320, flexShrink: 0, borderLeft: "1px solid var(--border)",
              background: "var(--surface)", display: "flex", flexDirection: "column",
              overflow: "auto",
            }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 16px", borderBottom: "1px solid var(--border)",
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Event Details</span>
                <button onClick={() => setSelectedEvent(null)} style={{
                  background: "none", border: "none", color: "var(--text-faint)", cursor: "pointer", fontSize: 16,
                }}>&times;</button>
              </div>

              <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", margin: 0 }}>
                  {selectedEvent.summary || "(no title)"}
                </h3>

                {/* Time */}
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {selectedEvent.start?.dateTime ? (
                    <>
                      {new Date(selectedEvent.start.dateTime).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
                      <br />
                      {new Date(selectedEvent.start.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      {" – "}
                      {new Date(selectedEvent.end.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </>
                  ) : (
                    <>{new Date(selectedEvent.start.date).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} (All day)</>
                  )}
                </div>

                {selectedEvent.location && (
                  <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                    <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>Location:</span> {selectedEvent.location}
                  </div>
                )}

                {selectedEvent.description && (
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    {selectedEvent.description}
                  </div>
                )}

                {selectedEvent.attendees?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-faint)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Attendees</div>
                    {selectedEvent.attendees.map((a, i) => (
                      <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)", padding: "2px 0" }}>
                        {a.displayName || a.email}
                        {a.responseStatus === "accepted" && <span style={{ color: "#4ade80", marginLeft: 4 }}>&#10003;</span>}
                        {a.responseStatus === "declined" && <span style={{ color: "#f87171", marginLeft: 4 }}>&#10007;</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Deal tag */}
                <div style={{ position: "relative" }}>
                  {dealTags[selectedEvent.id] ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, background: "rgba(99,102,241,0.15)",
                        color: "#a5b4fc", borderRadius: 4, padding: "4px 8px",
                      }}>
                        {dealTags[selectedEvent.id].dealName}
                      </span>
                      <button onClick={() => handleUntagDeal(selectedEvent.id)} style={{
                        background: "none", border: "none", color: "var(--text-faint)",
                        cursor: "pointer", fontSize: 14, padding: 0,
                      }}>&times;</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowDealPicker(p => !p)}
                      style={{
                        background: "transparent", border: "1px solid var(--border)", borderRadius: 6,
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

                {/* Actions */}
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    onClick={() => { setEditEvent(selectedEvent); setShowEventModal(true); }}
                    style={{
                      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
                      padding: "6px 14px", fontSize: 11, color: "var(--text-secondary)", cursor: "pointer",
                      fontFamily: "'DM Sans',sans-serif", fontWeight: 500,
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteEvent(selectedEvent.id)}
                    style={{
                      background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6,
                      padding: "6px 14px", fontSize: 11, color: "#f87171", cursor: "pointer",
                      fontFamily: "'DM Sans',sans-serif", fontWeight: 500,
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Event modal */}
      {showEventModal && (
        <EventModal
          uid={uid}
          event={editEvent}
          onClose={() => { setShowEventModal(false); setEditEvent(null); }}
          onSaved={fetchEvents}
        />
      )}
    </div>
  );
}
