// Vercel serverless function — initiates Google OAuth flow
// Redirects user to Google consent screen with Gmail + Calendar scopes
export default async function handler(req, res) {
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ error: "Missing uid" });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).json({
      error: "Google OAuth not configured",
      debug: {
        hasClientId: !!clientId,
        hasRedirectUri: !!redirectUri,
        envKeys: Object.keys(process.env).filter(k => k.startsWith("GOOGLE")),
      },
    });
  }

  const scopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
    "openid",
    "email",
  ];

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: uid,
  });

  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
