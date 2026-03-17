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
async function hsPost(token, path, body) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HubSpot POST error (${res.status})`);
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
    name: "delete_deal",
    description: "Delete a pipeline deal by its Firestore document ID.",
    input_schema: { type: "object", properties: { dealId: { type: "string" } }, required: ["dealId"] },
  },
  {
    name: "list_events",
    description: "List all conference/event entries.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_event",
    description: "Create a new conference/event entry.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" },
        peopleMet: { type: "number" }, convertedToMeeting: { type: "number" },
      },
      required: ["name", "date"],
    },
  },
  {
    name: "list_outbound",
    description: "List all weekly outbound activity log entries.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_outbound",
    description: "Log a new weekly outbound activity entry.",
    input_schema: {
      type: "object",
      properties: {
        weekOf: { type: "string", description: "YYYY-MM-DD (Monday of the week)" },
        touches: { type: "number" }, bookings: { type: "number" },
        held: { type: "number" }, deals: { type: "number" },
      },
      required: ["weekOf"],
    },
  },
  {
    name: "read_notes",
    description: "Read the user's notes and todos.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "update_notes",
    description: "Update the user's notes blocks. Provide the full blocks array or specific fields to merge.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Notes document title" },
        blocks: { type: "array", description: "Array of block objects: {id, type, content, checked}", items: { type: "object" } },
      },
      required: [],
    },
  },
  {
    name: "add_follow_up",
    description: "Schedule a follow-up reminder for a deal.",
    input_schema: {
      type: "object",
      properties: {
        dealId: { type: "string" }, dealName: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        todoText: { type: "string", description: "What to follow up on" },
      },
      required: ["dealName", "date", "todoText"],
    },
  },
  {
    name: "complete_follow_up",
    description: "Mark a follow-up as completed.",
    input_schema: {
      type: "object",
      properties: { followUpKey: { type: "string", description: "The key of the follow-up in the followUps object" } },
      required: ["followUpKey"],
    },
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
    name: "get_deal_contacts",
    description: "Get contacts associated with a HubSpot deal.",
    input_schema: {
      type: "object",
      properties: { hubspotDealId: { type: "string", description: "HubSpot deal ID" } },
      required: ["hubspotDealId"],
    },
  },
  {
    name: "get_deal_notes",
    description: "Get notes associated with a HubSpot deal.",
    input_schema: {
      type: "object",
      properties: { hubspotDealId: { type: "string", description: "HubSpot deal ID" } },
      required: ["hubspotDealId"],
    },
  },
  {
    name: "sync_hubspot",
    description: "Sync new deals from HubSpot into the pipeline tracker.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

// ─── Tool execution ─────────────────────────────────────────────────────────
async function executeTool(name, input, ctx) {
  const db = getDb();
  const { userId, hsToken } = ctx;

  switch (name) {
    case "list_deals": {
      const snap = await db.collection("pipelineDeals").get();
      let deals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (input.bucket) deals = deals.filter(d => d.bucket === input.bucket);
      return { deals: deals.map(d => ({ id: d.id, name: d.name, value: d.value, bucket: d.bucket, expectedCloseMonth: d.expectedCloseMonth, confidence: d.manualConfidence ?? d.confidence, closedWon: d.closedWon || false, notes: d.notes, hubspotId: d.hubspotId, funnelType: d.funnelType, meetingBooked: d.meetingBooked, lastActivityDate: d.lastActivityDate })) };
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
        source: "bob", name: input.name, value: input.value || 0,
        bucket: input.bucket || "untagged", expectedCloseMonth: input.expectedCloseMonth || "",
        notes: input.notes || "", funnelType: input.funnelType || "outbound",
        manualConfidence: 30, useAlgoConfidence: false, closedWon: false, meetingBooked: false,
        hubspotId: null, funnelEventId: null, lastActivityDate: null, touchCount: 0,
        hubspotStage: null, hubspotPipeline: null, hubspotStageProbability: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { success: true, dealId: ref.id };
    }
    case "delete_deal": {
      await db.collection("pipelineDeals").doc(input.dealId).delete();
      return { success: true };
    }
    case "list_events": {
      const snap = await db.collection("pipelineEvents").get();
      return { events: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    }
    case "create_event": {
      const ref = await db.collection("pipelineEvents").add({
        name: input.name, date: input.date,
        peopleMet: input.peopleMet || 0, convertedToMeeting: input.convertedToMeeting || 0,
        dealsWon: 0, dealValue: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { success: true, eventId: ref.id };
    }
    case "list_outbound": {
      const snap = await db.collection("outboundActuals").get();
      return { entries: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    }
    case "create_outbound": {
      const ref = await db.collection("outboundActuals").add({
        weekOf: input.weekOf, touches: input.touches || 0,
        bookings: input.bookings || 0, held: input.held || 0, deals: input.deals || 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { success: true, entryId: ref.id };
    }
    case "read_notes": {
      if (!userId) return { error: "No userId" };
      const snap = await db.collection("userNotes").doc(userId).get();
      if (!snap.exists) return { notes: null };
      const data = snap.data();
      return { title: data.title, blocks: data.blocks, followUps: data.followUps, meetingChecked: data.meetingChecked };
    }
    case "update_notes": {
      if (!userId) return { error: "No userId" };
      const updates = { updatedAt: Date.now() };
      if (input.title !== undefined) updates.title = input.title;
      if (input.blocks !== undefined) updates.blocks = input.blocks;
      await db.collection("userNotes").doc(userId).set(updates, { merge: true });
      return { success: true };
    }
    case "add_follow_up": {
      if (!userId) return { error: "No userId" };
      const snap = await db.collection("userNotes").doc(userId).get();
      const followUps = snap.exists ? (snap.data().followUps || {}) : {};
      const key = `${input.dealName.replace(/\s+/g, "_")}_${Date.now()}`;
      followUps[key] = {
        dealId: input.dealId || null, dealName: input.dealName,
        date: input.date, todoText: input.todoText, completed: false,
      };
      await db.collection("userNotes").doc(userId).set({ followUps }, { merge: true });
      return { success: true, followUpKey: key };
    }
    case "complete_follow_up": {
      if (!userId) return { error: "No userId" };
      const snap = await db.collection("userNotes").doc(userId).get();
      if (!snap.exists) return { error: "No notes document found" };
      const followUps = snap.data().followUps || {};
      if (!followUps[input.followUpKey]) return { error: "Follow-up not found" };
      followUps[input.followUpKey].completed = true;
      await db.collection("userNotes").doc(userId).set({ followUps }, { merge: true });
      return { success: true };
    }
    case "search_hubspot_deals": {
      if (!hsToken) return { error: "No HubSpot token" };
      const props = ["dealname", "amount", "closedate", "dealstage", "pipeline", "hs_deal_stage_probability"];
      let allDeals = [], after;
      do {
        const params = new URLSearchParams({ properties: props.join(","), limit: "100" });
        if (after) params.set("after", after);
        const data = await hsGet(hsToken, `/crm/v3/objects/deals?${params}`);
        allDeals = [...allDeals, ...data.results];
        after = data.paging?.next?.after;
      } while (after);
      const term = input.searchTerm.toLowerCase();
      const filtered = allDeals.filter(d => (d.properties?.dealname || "").toLowerCase().includes(term));
      return { deals: filtered.slice(0, 20).map(d => ({ id: d.id, name: d.properties.dealname, amount: d.properties.amount, stage: d.properties.dealstage, pipeline: d.properties.pipeline, closedate: d.properties.closedate })) };
    }
    case "get_deal_contacts": {
      if (!hsToken) return { error: "No HubSpot token" };
      const assoc = await hsGet(hsToken, `/crm/v3/objects/deals/${input.hubspotDealId}/associations/contacts`);
      const ids = (assoc.results ?? []).map(r => r.id);
      if (ids.length === 0) return { contacts: [] };
      const data = await hsPost(hsToken, "/crm/v3/objects/contacts/batch/read", {
        properties: ["firstname", "lastname", "email", "phone", "jobtitle"],
        inputs: ids.map(id => ({ id })),
      });
      return { contacts: (data.results ?? []).map(c => c.properties) };
    }
    case "get_deal_notes": {
      if (!hsToken) return { error: "No HubSpot token" };
      const assoc = await hsGet(hsToken, `/crm/v3/objects/deals/${input.hubspotDealId}/associations/notes`);
      const ids = (assoc.results ?? []).map(r => r.id);
      if (ids.length === 0) return { notes: [] };
      const data = await hsPost(hsToken, "/crm/v3/objects/notes/batch/read", {
        properties: ["hs_note_body", "hs_timestamp", "hs_lastmodifieddate"],
        inputs: ids.map(id => ({ id })),
      });
      return { notes: (data.results ?? []).map(n => n.properties) };
    }
    case "sync_hubspot": {
      if (!hsToken) return { error: "No HubSpot token" };
      const props = ["dealname", "amount", "closedate", "dealstage", "pipeline", "hs_deal_stage_probability"];
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
          manualConfidence: 30, useAlgoConfidence: true, closedWon: d.properties.dealstage === "closedwon",
          funnelType: "outbound", funnelEventId: null, meetingBooked: false,
          lastActivityDate: null, touchCount: 0, notes: "",
          hubspotStage: d.properties.dealstage, hubspotPipeline: d.properties.pipeline,
          hubspotStageProbability: parseFloat(d.properties.hs_deal_stage_probability) || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        count++;
        if (count % 500 === 0) { await batch.commit(); }
      }
      if (count % 500 !== 0) await batch.commit();
      return { success: true, imported: count, total: allDeals.length };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Date helpers ───────────────────────────────────────────────────────────
function dayOfWeekForISO(isoDate, tz = "America/Chicago") {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(date);
}

function annotateDates(obj, tz) {
  if (!obj || typeof obj !== "object") return obj;
  const result = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const key of Object.keys(result)) {
    const val = result[key];
    if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
      result[key] = `${dayOfWeekForISO(val, tz)} ${val}`;
    } else if (val && typeof val === "object") {
      result[key] = annotateDates(val, tz);
    }
  }
  return result;
}

function getDateContext(tz = "America/Chicago") {
  const now = new Date();
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(now);
  const p = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(now).forEach(({ type, value }) => { p[type] = value; });
  return `Today is ${wd}, ${months[parseInt(p.month) - 1]} ${parseInt(p.day)}, ${p.year}.`;
}


function getSystemPrompt(tz) {
  return `You are Bob, a friendly and concise revenue operations assistant for the arr-flow platform.

${getDateContext(tz)}

You are in a LIVE VOICE CALL. Keep responses SHORT and conversational — 1-3 sentences max. No markdown, no lists, no tables. Summarize data verbally. Be warm and natural.

You have access to the platform's full data layer through tools. Use them proactively — if a user asks about their deals, call list_deals first. If they want to schedule a follow-up, use add_follow_up. If they want to change something, use the appropriate update tool.

Data model context:
- Pipeline deals have buckets: active, future_q1q2, future_q3q4, renewal, untagged
- Confidence is 0-100 (manual override or algorithmic)
- expectedCloseMonth is YYYY-MM format
- Deals can be linked to HubSpot (hubspotId field) — changes to closedWon and value auto-sync
- Follow-ups are date-based reminders linked to deals
- Notes use a block editor with types: text, h1, h2, h3, bullet, numbered, todo, quote, code, divider

CRITICAL DATE RULES — violating these is unacceptable:
1. Dates in tool results are pre-annotated with their correct day-of-week (e.g. "Thursday 2026-03-19"). ALWAYS use the day-of-week exactly as it appears in the data. NEVER recompute or guess the day.
2. For any other date, look it up in the calendar above. Do NOT compute days of the week yourself — you WILL get it wrong.
3. If a date is not in the calendar and not in tool results, say just the date without a day name.

Be concise and action-oriented. When you make changes, confirm what you did briefly.`;
}

// ─── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Log the full request for debugging
  console.log("[eleven-webhook] Headers:", JSON.stringify(req.headers));
  console.log("[eleven-webhook] Body keys:", Object.keys(req.body || {}));
  console.log("[eleven-webhook] Messages count:", req.body?.messages?.length);

  const { messages } = req.body || {};

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[eleven-webhook] No ANTHROPIC_API_KEY");
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  if (!messages || !Array.isArray(messages)) {
    console.error("[eleven-webhook] No messages array in body:", JSON.stringify(req.body).slice(0, 500));
    // Return a valid OpenAI-format response even on error
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Sorry, I didn't catch that." } }] })}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }

  const userId = req.headers["x-user-id"] || "";
  const timezone = req.headers["x-timezone"] || "America/Chicago";
  const tz = timezone || "America/Chicago";

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

  const hsToken = req.headers["x-hs-token"] || process.env.HUBSPOT_TOKEN || "";
  const ctx = { userId, hsToken, tz };

  try {
    // Convert OpenAI messages to Claude format
    let claudeMessages = [];
    for (const msg of messages) {
      if (msg.role === "system") continue;
      claudeMessages.push({ role: msg.role, content: msg.content });
    }
    if (claudeMessages.length === 0 || claudeMessages[0].role !== "user") {
      claudeMessages = [{ role: "user", content: "Hello" }, ...claudeMessages];
    }

    console.log("[eleven-webhook] Calling Claude with", claudeMessages.length, "messages");

    // Agentic loop — Claude may call tools multiple times
    let maxLoops = 10;
    while (maxLoops-- > 0) {
      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2048,
          system: getSystemPrompt(tz),
          tools: TOOLS,
          messages: claudeMessages,
          stream: true,
        }),
      });

      if (!claudeRes.ok) {
        const errBody = await claudeRes.text();
        console.error("[eleven-webhook] Claude API error:", claudeRes.status, errBody);
        sendChunk("Sorry, I'm having trouble right now.");
        break;
      }

      // Parse Claude's SSE stream
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
                currentToolUse = { id: event.content_block.id, name: event.content_block.name, input: "" };
                inputJsonBuf = "";
              }
              break;

            case "content_block_delta":
              if (event.delta?.type === "text_delta") {
                textContent += event.delta.text;
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

      // If Claude wants to use tools, execute them and continue the loop
      if (stopReason === "tool_use" && toolUseBlocks.length > 0) {
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
            const annotated = annotateDates(result, tz);
            toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: JSON.stringify(annotated) });
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

      // Final text response — done
      break;
    }
  } catch (e) {
    console.error("[eleven-webhook] Error:", e?.message, e?.stack);
    sendChunk("Sorry, something went wrong.");
  }

  res.write("data: [DONE]\n\n");
  res.end();
}
