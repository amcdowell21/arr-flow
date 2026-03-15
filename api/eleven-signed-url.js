// Vercel serverless function — generates ElevenLabs signed WebSocket URL
// GET → returns { signed_url }

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;

  if (!apiKey || !agentId) {
    return res.status(500).json({ error: "ElevenLabs agent not configured" });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
      { headers: { "xi-api-key": apiKey } }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error("Signed URL error:", response.status, err);
      return res.status(response.status).json({ error: `ElevenLabs error: ${response.status}` });
    }

    const data = await response.json();
    return res.status(200).json({
      signed_url: data.signed_url,
      voice_id: process.env.VOICE_ID || null,
    });
  } catch (e) {
    console.error("Signed URL error:", e);
    return res.status(500).json({ error: e.message });
  }
}
