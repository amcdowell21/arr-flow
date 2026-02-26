// Serverless proxy for HubSpot API — avoids browser CORS restrictions.
// Deployed on Vercel. Forwards requests to api.hubapi.com server-side.
export default async function handler(req, res) {
  const pathParts = req.query.path || [];
  const hsPath = "/" + (Array.isArray(pathParts) ? pathParts.join("/") : pathParts);

  // Forward all query params except 'path' (which is the route param)
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key !== "path") query.append(key, value);
  }

  const url = `https://api.hubapi.com${hsPath}${query.toString() ? "?" + query : ""}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: req.headers.authorization || "" },
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
