// Vercel serverless function — generates ElevenLabs signed WebSocket URL
// GET → returns { signed_url }

import admin from "firebase-admin";

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }
  return admin.firestore();
}

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

    // Store the userId so the webhook can look it up
    const userId = req.query.userId;
    console.log("[signed-url] userId from query:", userId || "(none)");
    if (userId) {
      try {
        const db = getDb();
        console.log("[signed-url] Writing pendingCalls/latest for userId:", userId);
        await db.collection("pendingCalls").doc("latest").set({ userId, updatedAt: Date.now() });
        console.log("[signed-url] pendingCalls/latest written successfully");
      } catch (e) {
        console.error("[signed-url] FAILED to write pendingCalls/latest:", e.message, e.stack);
      }
    } else {
      console.error("[signed-url] No userId passed — tool calls will fail!");
    }

    return res.status(200).json({
      signed_url: data.signed_url,
      voice_id: process.env.VOICE_ID || null,
    });
  } catch (e) {
    console.error("Signed URL error:", e);
    return res.status(500).json({ error: e.message });
  }
}
