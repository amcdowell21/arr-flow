// Vercel serverless function — AI agent "Bob" chat endpoint
// Calls Claude API with tool_use for platform actions, streams response via SSE
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

// ─── HubSpot helpers (server-side, no Vite proxy) ───────────────────────────
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

// ─── Tool definitions for Claude ────────────────────────────────────────────
const TOOLS = [
  {
    name: "list_deals",
    description: "List all pipeline deals from the platform. Returns deal name, value, bucket, expectedCloseMonth, confidence, closedWon status, notes, and other fields.",
    input_schema: { type: "object", properties: { bucket: { type: "string", description: "Optional filter by bucket: active, future_q1q2, future_q3q4, renewal, untagged" } }, required: [] },
  },
  {
    name: "update_deal",
    description: "Update a pipeline deal's fields. Can change bucket, value, expectedCloseMonth, confidence, closedWon, notes, meetingBooked, lastActivityDate, touchCount, funnelType, name, etc. When closedWon or value changes and the deal has a hubspotId, it auto-syncs to HubSpot.",
    input_schema: {
      type: "object",
      properties: {
        dealId: { type: "string", description: "Firestore document ID of the deal" },
        updates: {
          type: "object",
          description: "Fields to update. Supported: name, value (number), bucket (active/future_q1q2/future_q3q4/renewal/untagged), expectedCloseMonth (YYYY-MM), manualConfidence (0-100), closedWon (boolean), notes (string), meetingBooked (boolean), lastActivityDate (YYYY-MM-DD), touchCount (number), funnelType (outbound/event/podcast), funnelEventId (string)",
        },
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
        name: { type: "string" },
        value: { type: "number" },
        bucket: { type: "string", description: "active, future_q1q2, future_q3q4, renewal, or untagged" },
        expectedCloseMonth: { type: "string", description: "YYYY-MM format" },
        notes: { type: "string" },
        funnelType: { type: "string", description: "outbound, event, or podcast" },
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
    description: "List all conference/event entries from the pipeline tracker.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_event",
    description: "Create a new conference/event entry.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        peopleMet: { type: "number" },
        convertedToMeeting: { type: "number" },
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
        touches: { type: "number" },
        bookings: { type: "number" },
        held: { type: "number" },
        deals: { type: "number" },
      },
      required: ["weekOf"],
    },
  },
  {
    name: "read_notes",
    description: "Read the user's notes, todos, and follow-ups from their personal notes document.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "update_notes",
    description: "Update the user's notes blocks. Provide the full blocks array or specific fields to merge.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Notes document title" },
        blocks: {
          type: "array",
          description: "Array of block objects: {id, type, content, checked}. Types: text, h1, h2, h3, bullet, numbered, todo, quote, code, divider",
          items: { type: "object" },
        },
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
        dealId: { type: "string" },
        dealName: { type: "string" },
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
    description: "Search HubSpot CRM deals by name or other criteria. Returns deal name, amount, stage, pipeline, close date.",
    input_schema: {
      type: "object",
      properties: { searchTerm: { type: "string", description: "Search query for deal name" } },
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
    description: "Trigger a sync from HubSpot — imports any new deals not yet in the pipeline tracker.",
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
      const updates = { ...input.updates, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      await ref.update(updates);

      // Cascade to HubSpot
      if (hsToken && prev.hubspotId) {
        if (input.updates.closedWon === true && !prev.closedWon) {
          try { await hsPatch(hsToken, `/crm/v3/objects/deals/${prev.hubspotId}`, { properties: { dealstage: "closedwon" } }); } catch (e) { /* log */ }
        }
        if (input.updates.value !== undefined && input.updates.value !== prev.value) {
          try { await hsPatch(hsToken, `/crm/v3/objects/deals/${prev.hubspotId}`, { properties: { amount: String(input.updates.value) } }); } catch (e) { /* log */ }
        }
      }

      // Update event counters if deal has funnelType=event
      if (prev.funnelType === "event" || input.updates.funnelType === "event") {
        const eventId = input.updates.funnelEventId || prev.funnelEventId;
        const wasClosedWon = prev.closedWon;
        const isClosedWon = input.updates.closedWon !== undefined ? input.updates.closedWon : prev.closedWon;
        const newValue = input.updates.value !== undefined ? input.updates.value : prev.value;

        if (eventId) {
          const evRef = db.collection("pipelineEvents").doc(eventId);
          const evSnap = await evRef.get();
          if (evSnap.exists) {
            const ev = evSnap.data();
            let dealsWon = ev.dealsWon || 0;
            let dealValue = ev.dealValue || 0;
            if (wasClosedWon && prev.funnelEventId) { dealsWon--; dealValue -= (prev.value || 0); }
            if (isClosedWon) { dealsWon++; dealValue += (newValue || 0); }
            await evRef.update({ dealsWon: Math.max(0, dealsWon), dealValue: Math.max(0, dealValue) });
          }
        }
      }

      return { success: true, dealId: input.dealId };
    }

    case "create_deal": {
      const doc = await db.collection("pipelineDeals").add({
        source: "bob",
        hubspotId: null,
        name: input.name,
        value: input.value || 0,
        bucket: input.bucket || "untagged",
        expectedCloseMonth: input.expectedCloseMonth || "",
        manualConfidence: 30,
        useAlgoConfidence: false,
        closedWon: false,
        funnelType: input.funnelType || "outbound",
        funnelEventId: null,
        meetingBooked: false,
        lastActivityDate: null,
        touchCount: 0,
        notes: input.notes || "",
        hubspotStage: null,
        hubspotPipeline: null,
        hubspotStageProbability: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { success: true, dealId: doc.id };
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
      const doc = await db.collection("pipelineEvents").add({
        name: input.name,
        date: input.date,
        peopleMet: input.peopleMet || 0,
        convertedToMeeting: input.convertedToMeeting || 0,
        dealsWon: 0,
        dealValue: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { success: true, eventId: doc.id };
    }

    case "list_outbound": {
      const snap = await db.collection("outboundActuals").get();
      return { entries: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
    }

    case "create_outbound": {
      const doc = await db.collection("outboundActuals").add({
        weekOf: input.weekOf,
        touches: input.touches || 0,
        bookings: input.bookings || 0,
        held: input.held || 0,
        deals: input.deals || 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { success: true, entryId: doc.id };
    }

    case "read_notes": {
      const snap = await db.collection("userNotes").doc(userId).get();
      if (!snap.exists) return { notes: null };
      const data = snap.data();
      return { title: data.title, blocks: data.blocks, followUps: data.followUps, meetingChecked: data.meetingChecked };
    }

    case "update_notes": {
      const updates = { updatedAt: Date.now() };
      if (input.title !== undefined) updates.title = input.title;
      if (input.blocks !== undefined) updates.blocks = input.blocks;
      await db.collection("userNotes").doc(userId).set(updates, { merge: true });
      return { success: true };
    }

    case "add_follow_up": {
      const snap = await db.collection("userNotes").doc(userId).get();
      const followUps = snap.exists ? (snap.data().followUps || {}) : {};
      const key = `${input.dealName.replace(/\s+/g, "_")}_${Date.now()}`;
      followUps[key] = {
        dealId: input.dealId || null,
        dealName: input.dealName,
        date: input.date,
        todoText: input.todoText,
        completed: false,
      };
      await db.collection("userNotes").doc(userId).set({ followUps }, { merge: true });
      return { success: true, followUpKey: key };
    }

    case "complete_follow_up": {
      const snap = await db.collection("userNotes").doc(userId).get();
      if (!snap.exists) return { error: "No notes document found" };
      const followUps = snap.data().followUps || {};
      if (!followUps[input.followUpKey]) return { error: "Follow-up not found" };
      followUps[input.followUpKey].completed = true;
      await db.collection("userNotes").doc(userId).set({ followUps }, { merge: true });
      return { success: true };
    }

    case "search_hubspot_deals": {
      if (!hsToken) return { error: "No HubSpot token available" };
      const props = ["dealname", "amount", "closedate", "dealstage", "pipeline", "hs_deal_stage_probability"];
      let allDeals = [];
      let after;
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
      if (!hsToken) return { error: "No HubSpot token available" };
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
      if (!hsToken) return { error: "No HubSpot token available" };
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
      if (!hsToken) return { error: "No HubSpot token available" };
      const props = ["dealname", "amount", "closedate", "dealstage", "pipeline", "hs_deal_stage_probability"];
      let allDeals = [];
      let after;
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
        const ref = db.collection("pipelineDeals").doc();
        batch.set(ref, {
          source: "hubspot",
          hubspotId: d.id,
          name: d.properties.dealname || "Unnamed Deal",
          value: parseFloat(d.properties.amount) || 0,
          bucket: "untagged",
          expectedCloseMonth: d.properties.closedate ? d.properties.closedate.slice(0, 7) : "",
          manualConfidence: 30,
          useAlgoConfidence: true,
          closedWon: d.properties.dealstage === "closedwon",
          funnelType: "outbound",
          funnelEventId: null,
          meetingBooked: false,
          lastActivityDate: null,
          touchCount: 0,
          notes: "",
          hubspotStage: d.properties.dealstage,
          hubspotPipeline: d.properties.pipeline,
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

// ─── System prompt ──────────────────────────────────────────────────────────
function getDateContext() {
  const now = new Date();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const fmt = (d) => `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
  const iso = (d) => d.toISOString().split("T")[0];

  // Build this week (Mon–Sun) and next week
  const dayOfWeek = now.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);

  let weekLines = "This week:\n";
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const marker = iso(d) === iso(now) ? " ← TODAY" : "";
    weekLines += `  ${fmt(d)} (${iso(d)})${marker}\n`;
  }
  weekLines += "Next week:\n";
  for (let i = 7; i < 14; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    weekLines += `  ${fmt(d)} (${iso(d)})\n`;
  }

  return `Today is ${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()} (${iso(now)})\n\n${weekLines}`;
}

function getSystemPrompt() {
  return `You are Bob, a friendly and concise revenue operations assistant for the arr-flow platform. You help manage pipeline deals, track events, log outbound activity, and organize notes and follow-ups.

${getDateContext()}

You have access to the platform's full data layer through tools. Use them proactively — if a user asks about their deals, call list_deals first. If they want to change something, use the appropriate update tool.

Data model context:
- Pipeline deals have buckets: active, future_q1q2, future_q3q4, renewal, untagged
- Confidence is 0-100 (manual override or algorithmic)
- expectedCloseMonth is YYYY-MM format
- Deals can be linked to HubSpot (hubspotId field) — changes to closedWon and value auto-sync
- Follow-ups are date-based reminders linked to deals
- Notes use a block editor with types: text, h1, h2, h3, bullet, numbered, todo, quote, code, divider

Be concise and action-oriented. When you make changes, confirm what you did. Use markdown formatting for readability. When listing deals, format them in a clear table or list.`;
}

// ─── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { conversationId, messages, userId, hsToken } = req.body;
  if (!messages || !userId) {
    return res.status(400).json({ error: "Missing messages or userId" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  // Set up SSE streaming
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const ctx = { userId, hsToken };

  // Build Claude messages (only role + content)
  let claudeMessages = messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  let finalTextContent = "";

  try {
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
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: getSystemPrompt(),
          tools: TOOLS,
          messages: claudeMessages,
          stream: true,
        }),
      });

      if (!claudeRes.ok) {
        const err = await claudeRes.text();
        send("error", { message: `Claude API error: ${claudeRes.status}` });
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
                send("tool", { name: event.content_block.name, status: "running" });
              }
              break;

            case "content_block_delta":
              if (event.delta?.type === "text_delta") {
                textContent += event.delta.text;
                send("delta", { text: event.delta.text });
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
        // Build the assistant message with all content blocks
        const assistantContent = [];
        if (textContent) assistantContent.push({ type: "text", text: textContent });
        for (const tb of toolUseBlocks) {
          assistantContent.push({ type: "tool_use", id: tb.id, name: tb.name, input: tb.input });
        }
        claudeMessages.push({ role: "assistant", content: assistantContent });

        // Execute each tool and build tool results
        const toolResults = [];
        for (const tb of toolUseBlocks) {
          try {
            const result = await executeTool(tb.name, tb.input, ctx);
            send("tool", { name: tb.name, status: "done", summary: result.error || `Done` });
            toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: JSON.stringify(result) });
          } catch (e) {
            send("tool", { name: tb.name, status: "error", summary: e.message });
            toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: JSON.stringify({ error: e.message }), is_error: true });
          }
        }
        claudeMessages.push({ role: "user", content: toolResults });

        // Reset for next iteration
        toolUseBlocks = [];
        textContent = "";
        stopReason = null;
        continue;
      }

      // Final text response — done
      finalTextContent = textContent;
      break;
    }

    // Save conversation to Firestore
    try {
      const db = getDb();
      const convData = {
        userId,
        messages: req.body.messages.concat([{ role: "assistant", content: finalTextContent || "", timestamp: Date.now() }]),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (conversationId) {
        await db.collection("bobConversations").doc(conversationId).update(convData);
      } else {
        const firstMsg = req.body.messages.find(m => m.role === "user");
        convData.title = firstMsg ? firstMsg.content.slice(0, 60) : "New conversation";
        convData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        const newDoc = await db.collection("bobConversations").add(convData);
        send("conversation", { id: newDoc.id, title: convData.title });
      }
    } catch (e) {
      console.error("Conversation save error:", e.message);
      send("save_error", { message: e.message });
    }

    send("done", {});
  } catch (e) {
    send("error", { message: e.message });
  }

  res.end();
}
