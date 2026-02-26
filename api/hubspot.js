// Vercel serverless function — proxies HubSpot API requests server-side
// to avoid browser CORS restrictions on the static frontend.
export default async function handler(req, res) {
  const { _path, ...queryParams } = req.query;
  if (!_path) return res.status(400).json({ error: "Missing _path" });

  const query = new URLSearchParams(queryParams);
  const url = `https://api.hubapi.com${_path}${query.toString() ? "?" + query : ""}`;

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
