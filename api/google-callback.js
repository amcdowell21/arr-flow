// Vercel serverless function — handles Google OAuth callback
// Exchanges auth code for tokens, stores in Firestore, redirects back to app
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

export default async function handler(req, res) {
  const { code, state: uid, error } = req.query;

  if (error) {
    return res.redirect(302, "/?google_auth=error&reason=" + encodeURIComponent(error));
  }

  if (!code || !uid) {
    return res.status(400).json({ error: "Missing code or state" });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  try {
    // Exchange authorization code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("Token exchange failed:", err);
      return res.redirect(302, "/?google_auth=error&reason=token_exchange_failed");
    }

    const tokens = await tokenRes.json();

    // Get user email from Google
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = profileRes.ok ? await profileRes.json() : {};

    // Store tokens in Firestore
    const db = getDb();
    await db.collection("userGoogleTokens").doc(uid).set({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in * 1000),
      email: profile.email || null,
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.redirect(302, "/?google_auth=success");
  } catch (e) {
    console.error("Google OAuth callback error:", e);
    res.redirect(302, "/?google_auth=error&reason=server_error");
  }
}
