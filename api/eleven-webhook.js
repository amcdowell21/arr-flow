// Vercel serverless function — ElevenLabs Conversational AI custom LLM webhook
// Receives OpenAI-format chat completion requests, proxies to Claude with tools,
// returns OpenAI-format SSE stream back to ElevenLabs.

import admin from "firebase-admin";

// ─── Firebase Admin init (lazy singleton) ───────────────────────────────────
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

// ─── HubSpot helpers ────────────────────────────────────────────────────────
async function hsGet(token, path) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HubSpot GET error (${res.status})`);
  return res.json();
}
async function hsPatch(token, path, body) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HubSpot PATCH error (${res.status})`);
  return res.json();
}

// ─── Tool definitions (Claude format) ───────────────────────────────────────
const TOOLS = [
  {
    name: "list_deals",
    description: "List all pipeline deals. Returns deal name, value, bucket, expectedCloseMonth, confidence, closedWon status, notes.",
    input_schema: { type: "object", properties: { bucket: { type: "string", description: "Optional filter: active, future_q1q2, future_q3q4, renewal, untagged" } }, required: [] },
  },
  {
    name: "update_deal",
    description: "Update a pipeline deal's fields.",
    input_schema: {
      type: "object",
      properties: {
        dealId: { type: "string", description: "Firestore document ID" },
        updates: { type: "object", description: "Fields to update: name, value, bucket, expectedCloseMonth, manualConfidence, closedWon, notes, meetingBooked, lastActivityDate, touchCount, funnelType" },
      },
      required: ["dealId", "updates"],
    },
  },
  {
    name: "create_deal",
    description: "Create a new pipeline deal.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" }, value: { type: "number" },
        bucket: { type: "string" }, expectedCloseMonth: { type: "string" },
        notes: { type: "string" }, funnelType: { type: "string" },
      },
      required: ["name", "value"],
    },
  },
  {
    name: "list_events",
    description: "List all conference/event entries.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_outbound",
    description: "List all weekly outbound activity log entries.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "read_notes",
    description: "Read the user's notes and todos.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "search_hubspot_deals",
    description: "Search HubSpot CRM deals by name.",
    input_schema: {
      type: "object",
      properties: { searchTerm: { type: "string" } },
      required: ["searchTerm"],
    },
  },
  {
    name: "sync_hubspot",
    description: "Sync new deals from HubSpot into the pipeline tracker.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

// ─── Tool execution (subset — voice calls don't need all tools) ─────────────
async function executeTool(name, input, ctx) {
  const db = getDb();
  const { userId, hsToken } = ctx;

  switch (name) {
    case "list_deals": {
      const snap = await db.collection("pipelineDeals").get();
      let deals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (input.bucket) deals = deals.filter(d => d.bucket === input.bucket);
      return { deals: deals.map(d => ({ id: d.id, name: d.name, value: d.value, bucket: d.bucket, expectedCloseMonth: d.expectedCloseMonth, confidence: d.manualConfidence ?? d.confidence, closedWon: d.closedWon || false, notes: d.notes, funnelType: d.funnelType })) };
    }
    case "update_deal": {
      const ref = db.collection("pipelineDeals").doc(input.dealId);
      const snap = await ref.get();
      if (!snap.exists) return { error: "Deal not found" };
      const prev = snap.data();
      await ref.update({ ...input.updates, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      if (hsToken && prev.hubspotId) {
        if (input.updates.closedWon === true && !prev.closedWon) {
          try { await hsPatch(hsToken, `/crm/v3/objects/deals/${prev.hubspotId}`, { properties: { dealstage: "closedwon" } }); } catch (e) { /* ignore */ }
        }
        if (input.updates.value !== undefined && input.updates.value !== prev.value) {
          try { await hsPatch(hsToken, `/crm/v3/objects/deals/${prev.hubspotId}`, { properties: { amount: String(input.updates.value) } }); } catch (e) { /* ignore */ }
        }
      }
      return { success: true, updated: input.dealId };
    }
    case "create_deal": {
      const ref = await db.collection("pipelineDeals").add({
        source: "manual", name: input.name, value: input.value,
        bucket: input.bucket || "untagged", expectedCloseMonth: input.expectedCloseMonth || "",
        notes: input.notes || "", funnelType: input.funnelType || "outbound",
        manualConfidence: 30, closedWon: false, meetingBooked: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { success: true, dealId: ref.id };
    }
    case "list_events": {
      const snap = await db.collection("pipelineEvents").get();
      return { events: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    }
    case "list_outbound": {
      const snap = await db.collection("outboundActuals").get();
      return { entries: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    }
    case "read_notes": {
      if (!userId) return { error: "No userId" };
      const snap = await db.collection("userNotes").doc(userId).get();
      return snap.exists ? snap.data() : { title: "", blocks: [] };
    }
    case "search_hubspot_deals": {
      if (!hsToken) return { error: "No HubSpot token" };
      const data = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${hsToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "dealname", operator: "CONTAINS_TOKEN", value: input.searchTerm }] }],
          properties: ["dealname", "amount", "dealstage", "closedate"],
          limit: 10,
        }),
      }).then(r => r.json());
      return { deals: (data.results || []).map(d => d.properties) };
    }
    case "sync_hubspot": {
      if (!hsToken) return { error: "No HubSpot token" };
      const props = ["dealname", "amount", "closedate", "dealstage", "pipeline"];
      let allDeals = [], after;
      do {
        const params = new URLSearchParams({ properties: props.join(","), limit: "100" });
        if (after) params.set("after", after);
        const data = await hsGet(hsToken, `/crm/v3/objects/deals?${params}`);
        allDeals = [...allDeals, ...data.results];
        after = data.paging?.next?.after;
      } while (after);
      const existing = await db.collection("pipelineDeals").get();
      const existingHsIds = new Set(existing.docs.map(d => d.data().hubspotId).filter(Boolean));
      const newDeals = allDeals.filter(d => !existingHsIds.has(d.id));
      const batch = db.batch();
      let count = 0;
      for (const d of newDeals) {
        batch.set(db.collection("pipelineDeals").doc(), {
          source: "hubspot", hubspotId: d.id,
          name: d.properties.dealname || "Unnamed", value: parseFloat(d.properties.amount) || 0,
          bucket: "untagged", expectedCloseMonth: d.properties.closedate ? d.properties.closedate.slice(0, 7) : "",
          manualConfidence: 30, closedWon: d.properties.dealstage === "closedwon",
          funnelType: "outbound", createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        count++;
      }
      if (count > 0) await batch.commit();
      return { success: true, imported: count };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Date context ───────────────────────────────────────────────────────────
function getDateContext() {
  const now = new Date();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `Today is ${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}.`;
}

function getSystemPrompt() {
  return `You are Bob, a friendly and concise revenue operations assistant for the arr-flow platform. You help manage pipeline deals, track events, log outbound activity, and organize notes.

${getDateContext()}

You have tools to access the platform's data. Use them when the user asks about deals, pipeline, events, outbound, or notes.

Keep responses SHORT and conversational — you're in a live voice call. Avoid long lists or markdown. Summarize data verbally. Be warm and natural.

Data model:
- Pipeline deals have buckets: active, future_q1q2, future_q3q4, renewal, untagged
- Confidence is 0-100
- expectedCloseMonth is YYYY-MM format`;
}

// ─── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { messages } = req.body;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  // Extract userId and hsToken from custom headers or the system message
  // ElevenLabs passes dynamic variables we set during conversation init
  const userId = req.headers["x-user-id"] || "";
  const hsToken = req.headers["x-hs-token"] || "";
  const ctx = { userId, hsToken };

  // Set up SSE streaming (OpenAI format)
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const sendChunk = (text) => {
    const chunk = { choices: [{ delta: { content: text } }] };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  };

  try {
    // Convert OpenAI messages to Claude format
    // ElevenLabs sends: system message + user/assistant alternation
    let claudeMessages = [];
    for (const msg of messages) {
      if (msg.role === "system") continue; // We use our own system prompt
      claudeMessages.push({ role: msg.role, content: msg.content });
    }

    // Ensure messages start with user role
    if (claudeMessages.length === 0 || claudeMessages[0].role !== "user") {
      claudeMessages = [{ role: "user", content: "Hello" }, ...claudeMessages];
    }

    // Agentic loop — Claude may call tools
    let maxLoops = 5; // Fewer loops for voice (latency matters)
    while (maxLoops-- > 0) {
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024, // Shorter for voice
          system: getSystemPrompt(),
          tools: TOOLS,
          messages: claudeMessages,
          stream: true,
        }),
      });

      if (!claudeRes.ok) {
        sendChunk("Sorry, I'm having trouble connecting right now.");
        break;
      }

      // Parse Claude SSE stream
      const reader = claudeRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentToolUse = null;
      let toolUseBlocks = [];
      let textContent = "";
      let stopReason = null;
      let inputJsonBuf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          let event;
          try { event = JSON.parse(data); } catch { continue; }

          switch (event.type) {
            case "content_block_start":
              if (event.content_block?.type === "tool_use") {
                currentToolUse = { id: event.content_block.id, name: event.content_block.name };
                inputJsonBuf = "";
              }
              break;
            case "content_block_delta":
              if (event.delta?.type === "text_delta") {
                textContent += event.delta.text;
                // Stream text to ElevenLabs in real-time
                sendChunk(event.delta.text);
              } else if (event.delta?.type === "input_json_delta") {
                inputJsonBuf += event.delta.partial_json;
              }
              break;
            case "content_block_stop":
              if (currentToolUse) {
                try { currentToolUse.input = JSON.parse(inputJsonBuf || "{}"); } catch { currentToolUse.input = {}; }
                toolUseBlocks.push(currentToolUse);
                currentToolUse = null;
                inputJsonBuf = "";
              }
              break;
            case "message_delta":
              if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
              break;
          }
        }
      }

      // If Claude wants tools, execute them and continue
      if (stopReason === "tool_use" && toolUseBlocks.length > 0) {
        // Send a buffer phrase while processing tools
        sendChunk("Let me check that... ");

        const assistantContent = [];
        if (textContent) assistantContent.push({ type: "text", text: textContent });
        for (const tb of toolUseBlocks) {
          assistantContent.push({ type: "tool_use", id: tb.id, name: tb.name, input: tb.input });
        }
        claudeMessages.push({ role: "assistant", content: assistantContent });

        const toolResults = [];
        for (const tb of toolUseBlocks) {
          try {
            const result = await executeTool(tb.name, tb.input, ctx);
            toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: JSON.stringify(result) });
          } catch (e) {
            toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: JSON.stringify({ error: e.message }), is_error: true });
          }
        }
        claudeMessages.push({ role: "user", content: toolResults });

        toolUseBlocks = [];
        textContent = "";
        stopReason = null;
        continue;
      }

      break;
    }
  } catch (e) {
    console.error("Webhook error:", e);
    sendChunk("Sorry, something went wrong.");
  }

  res.write("data: [DONE]\n\n");
  res.end();
}
