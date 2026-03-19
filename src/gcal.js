// ─── Google Calendar API client helpers ─────────────────────────────────────

async function gcalGet(uid, action, params = {}) {
  const qs = new URLSearchParams({ uid, _action: action, ...params });
  const res = await fetch(`/api/gcal?${qs}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Calendar error (${res.status})`);
  }
  return res.json();
}

async function gcalPost(uid, action, body = {}, params = {}) {
  const qs = new URLSearchParams({ uid, _action: action, ...params });
  const res = await fetch(`/api/gcal?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Calendar error (${res.status})`);
  }
  return res.json();
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function listCalendars(uid) {
  return gcalGet(uid, "calendars");
}

export async function listEvents(uid, timeMin, timeMax, calendarId = "primary", maxResults = 100) {
  const params = { calendarId, maxResults: String(maxResults) };
  if (timeMin) params.timeMin = timeMin;
  if (timeMax) params.timeMax = timeMax;
  return gcalGet(uid, "list", params);
}

export async function getEvent(uid, eventId, calendarId = "primary") {
  return gcalGet(uid, "get", { calendarId, eventId });
}

export async function createEvent(uid, event, calendarId = "primary") {
  return gcalPost(uid, "create", event, { calendarId });
}

export async function updateEvent(uid, eventId, updates, calendarId = "primary") {
  return gcalPost(uid, "update", updates, { calendarId, eventId });
}

export async function deleteEvent(uid, eventId, calendarId = "primary") {
  const qs = new URLSearchParams({ uid, _action: "delete", calendarId, eventId });
  const res = await fetch(`/api/gcal?${qs}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Calendar delete error (${res.status})`);
  }
  return res.json();
}
