// Vercel serverless function — ElevenLabs TTS proxy
// POST { text } → streams back audio/mpeg

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Missing text" });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.VOICE_ID;

  if (!apiKey || !voiceId) {
    return res.status(500).json({ error: "ElevenLabs credentials not configured" });
  }

  try {
    const elResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!elResponse.ok) {
      const err = await elResponse.text();
      console.error("ElevenLabs error:", elResponse.status, err);
      return res.status(elResponse.status).json({ error: `ElevenLabs error: ${elResponse.status}` });
    }

    // Stream audio back to the client
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    });

    const reader = elResponse.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }

    res.end();
  } catch (e) {
    console.error("TTS proxy error:", e);
    res.status(500).json({ error: e.message });
  }
}
