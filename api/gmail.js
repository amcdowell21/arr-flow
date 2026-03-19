// Vercel serverless function — proxies Gmail API requests
// Uses Google OAuth tokens stored in Firestore
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

  // Refresh
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
    const base = "https://gmail.googleapis.com/gmail/v1/users/me";

    switch (action) {
      case "list": {
        const q = req.query.q || "";
        const maxResults = req.query.maxResults || "20";
        const pageToken = req.query.pageToken || "";
        const labelIds = req.query.labelIds || "";
        const params = new URLSearchParams({ maxResults });
        if (q) params.set("q", q);
        if (pageToken) params.set("pageToken", pageToken);
        if (labelIds) params.set("labelIds", labelIds);
        const r = await fetch(`${base}/messages?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`Gmail list error (${r.status})`);
        return res.json(await r.json());
      }

      case "list_with_metadata": {
        // Single call that lists messages AND fetches metadata for each — avoids N round trips from client
        const q = req.query.q || "";
        const maxResults = req.query.maxResults || "20";
        const pageToken = req.query.pageToken || "";
        const params = new URLSearchParams({ maxResults });
        if (q) params.set("q", q);
        if (pageToken) params.set("pageToken", pageToken);
        const listR = await fetch(`${base}/messages?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!listR.ok) throw new Error(`Gmail list error (${listR.status})`);
        const listData = await listR.json();
        const ids = (listData.messages || []).map(m => m.id);

        // Fetch metadata in parallel server-side (fast, no extra network hops)
        const getH = (headers, name) => (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
        const metaPromises = ids.map(async (id) => {
          try {
            const r = await fetch(`${base}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!r.ok) return null;
            const msg = await r.json();
            return {
              id: msg.id,
              threadId: msg.threadId,
              from: getH(msg.payload?.headers, "From"),
              to: getH(msg.payload?.headers, "To"),
              subject: getH(msg.payload?.headers, "Subject"),
              date: getH(msg.payload?.headers, "Date"),
              snippet: msg.snippet,
              labelIds: msg.labelIds,
              isUnread: (msg.labelIds || []).includes("UNREAD"),
            };
          } catch {
            return null;
          }
        });
        const metas = (await Promise.all(metaPromises)).filter(Boolean);
        return res.json({ messages: metas, nextPageToken: listData.nextPageToken || null });
      }

      case "get": {
        const id = req.query.id;
        if (!id) return res.status(400).json({ error: "Missing id" });
        const format = req.query.format || "full";
        const r = await fetch(`${base}/messages/${id}?format=${format}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`Gmail get error (${r.status})`);
        return res.json(await r.json());
      }

      case "send": {
        const { raw } = req.body;
        if (!raw) return res.status(400).json({ error: "Missing raw message" });
        const r = await fetch(`${base}/messages/send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw }),
        });
        if (!r.ok) throw new Error(`Gmail send error (${r.status})`);
        return res.json(await r.json());
      }

      case "draft_create": {
        const { raw: draftRaw } = req.body;
        if (!draftRaw) return res.status(400).json({ error: "Missing raw message" });
        const r = await fetch(`${base}/drafts`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message: { raw: draftRaw } }),
        });
        if (!r.ok) throw new Error(`Gmail draft error (${r.status})`);
        return res.json(await r.json());
      }

      case "draft_send": {
        const { draftId } = req.body;
        if (!draftId) return res.status(400).json({ error: "Missing draftId" });
        const r = await fetch(`${base}/drafts/send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ id: draftId }),
        });
        if (!r.ok) throw new Error(`Gmail draft send error (${r.status})`);
        return res.json(await r.json());
      }

      case "drafts": {
        const maxResults = req.query.maxResults || "20";
        const r = await fetch(`${base}/drafts?maxResults=${maxResults}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`Gmail drafts error (${r.status})`);
        return res.json(await r.json());
      }

      case "labels": {
        const r = await fetch(`${base}/labels`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`Gmail labels error (${r.status})`);
        return res.json(await r.json());
      }

      case "profile": {
        const r = await fetch(`${base}/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`Gmail profile error (${r.status})`);
        return res.json(await r.json());
      }

      case "modify": {
        const { id: msgId, addLabelIds, removeLabelIds } = req.body;
        if (!msgId) return res.status(400).json({ error: "Missing id" });
        const r = await fetch(`${base}/messages/${msgId}/modify`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ addLabelIds, removeLabelIds }),
        });
        if (!r.ok) throw new Error(`Gmail modify error (${r.status})`);
        return res.json(await r.json());
      }

      case "schedule": {
        // Gmail doesn't have native schedule API - we send with a delay header
        // For now, create as draft and return the draft ID
        const { raw: schedRaw, sendAt } = req.body;
        if (!schedRaw) return res.status(400).json({ error: "Missing raw message" });
        const r = await fetch(`${base}/drafts`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message: { raw: schedRaw } }),
        });
        if (!r.ok) throw new Error(`Gmail schedule draft error (${r.status})`);
        const draft = await r.json();
        // Store scheduled send info in Firestore
        const db = getDb();
        await db.collection("scheduledEmails").add({
          userId: uid,
          draftId: draft.id,
          sendAt: sendAt,
          status: "pending",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ ...draft, scheduledFor: sendAt });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (e) {
    console.error("Gmail proxy error:", e);
    return res.status(500).json({ error: e.message });
  }
}
