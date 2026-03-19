// Vercel serverless function — proxies Google Calendar API requests
import admin from "firebase-admin";

let _db;
function getDb() {
  if (_db) return _db;
  if (!admin.apps.length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  _db = admin.firestore();
  return _db;
}

async function getAccessToken(uid) {
  const db = getDb();
  const snap = await db.collection("userGoogleTokens").doc(uid).get();
  if (!snap.exists) throw new Error("Google not connected");

  const data = snap.data();
  if (Date.now() < data.expiresAt - 60000) return data.accessToken;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: data.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("Token refresh failed");
  const tokens = await res.json();
  const update = { accessToken: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  if (tokens.refresh_token) update.refreshToken = tokens.refresh_token;
  await db.collection("userGoogleTokens").doc(uid).update(update);
  return tokens.access_token;
}

export default async function handler(req, res) {
  const uid = req.query.uid || req.headers["x-user-id"];
  if (!uid) return res.status(400).json({ error: "Missing uid" });

  const action = req.query._action;
  if (!action) return res.status(400).json({ error: "Missing _action" });

  try {
    const token = await getAccessToken(uid);
    const base = "https://www.googleapis.com/calendar/v3";

    switch (action) {
      case "calendars": {
        const r = await fetch(`${base}/users/me/calendarList`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`Calendar list error (${r.status})`);
        return res.json(await r.json());
      }

      case "list": {
        const calId = req.query.calendarId || "primary";
        const params = new URLSearchParams();
        if (req.query.timeMin) params.set("timeMin", req.query.timeMin);
        if (req.query.timeMax) params.set("timeMax", req.query.timeMax);
        params.set("maxResults", req.query.maxResults || "100");
        params.set("singleEvents", "true");
        params.set("orderBy", "startTime");
        const r = await fetch(`${base}/calendars/${encodeURIComponent(calId)}/events?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`Calendar events list error (${r.status})`);
        return res.json(await r.json());
      }

      case "get": {
        const calId = req.query.calendarId || "primary";
        const eventId = req.query.eventId;
        if (!eventId) return res.status(400).json({ error: "Missing eventId" });
        const r = await fetch(`${base}/calendars/${encodeURIComponent(calId)}/events/${eventId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`Calendar event get error (${r.status})`);
        return res.json(await r.json());
      }

      case "create": {
        const calId = req.query.calendarId || "primary";
        const r = await fetch(`${base}/calendars/${encodeURIComponent(calId)}/events`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
        });
        if (!r.ok) throw new Error(`Calendar event create error (${r.status})`);
        return res.json(await r.json());
      }

      case "update": {
        const calId = req.query.calendarId || "primary";
        const eventId = req.query.eventId;
        if (!eventId) return res.status(400).json({ error: "Missing eventId" });
        const r = await fetch(`${base}/calendars/${encodeURIComponent(calId)}/events/${eventId}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
        });
        if (!r.ok) throw new Error(`Calendar event update error (${r.status})`);
        return res.json(await r.json());
      }

      case "delete": {
        const calId = req.query.calendarId || "primary";
        const eventId = req.query.eventId;
        if (!eventId) return res.status(400).json({ error: "Missing eventId" });
        const r = await fetch(`${base}/calendars/${encodeURIComponent(calId)}/events/${eventId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.status === 204) return res.json({ success: true });
        if (!r.ok) throw new Error(`Calendar event delete error (${r.status})`);
        return res.json({ success: true });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    console.error("Calendar proxy error:", e);
    return res.status(500).json({ error: e.message });
  }
}
