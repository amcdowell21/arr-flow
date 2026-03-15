// Vercel serverless function — OpenAI Whisper transcription proxy
// POST multipart/form-data with audio file → returns { text }

export const config = {
  api: { bodyParser: false }, // We need raw body for multipart
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OpenAI API key not configured" });
  }

  try {
    // Read raw body
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    // Extract content-type header to forward the multipart boundary
    const contentType = req.headers["content-type"];
    if (!contentType || !contentType.includes("multipart/form-data")) {
      return res.status(400).json({ error: "Expected multipart/form-data" });
    }

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": contentType, // Forward the boundary
      },
      body,
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.text();
      console.error("Whisper error:", whisperRes.status, err);
      return res.status(whisperRes.status).json({ error: `Whisper error: ${whisperRes.status}` });
    }

    const result = await whisperRes.json();
    return res.status(200).json({ text: result.text || "" });
  } catch (e) {
    console.error("Transcribe proxy error:", e);
    return res.status(500).json({ error: e.message });
  }
}
