// Vercel serverless function — checks Google connection status and refreshes tokens
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

async function refreshAccessToken(db, uid, data) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: data.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) throw new Error("Token refresh failed");

  const tokens = await res.json();
  const update = {
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in * 1000),
  };
  if (tokens.refresh_token) update.refreshToken = tokens.refresh_token;

  await db.collection("userGoogleTokens").doc(uid).update(update);
  return tokens.access_token;
}

export default async function handler(req, res) {
  const uid = req.query.uid || req.headers["x-user-id"];
  if (!uid) return res.status(400).json({ error: "Missing uid" });

  try {
    const db = getDb();
    const snap = await db.collection("userGoogleTokens").doc(uid).get();

    if (!snap.exists) {
      return res.json({ connected: false });
    }

    const data = snap.data();
    let accessToken = data.accessToken;

    // Refresh if expiring within 60 seconds
    if (Date.now() > data.expiresAt - 60000) {
      try {
        accessToken = await refreshAccessToken(db, uid, data);
      } catch (e) {
        return res.json({ connected: false, error: "refresh_failed" });
      }
    }

    return res.json({
      connected: true,
      email: data.email,
      accessToken,
    });
  } catch (e) {
    console.error("Google token check error:", e);
    return res.status(500).json({ error: e.message });
  }
}
