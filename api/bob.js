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
  {
    name: "list_hubspot_stages",
    description: "List all HubSpot deal pipelines and their stages. Use this to find valid stage IDs before moving a deal.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "move_hubspot_deal",
    description: "Move a HubSpot deal to a different pipeline stage (column). Use list_hubspot_stages first to get valid stage IDs, then search_hubspot_deals to find the deal ID.",
    input_schema: {
      type: "object",
      properties: {
        hubspotDealId: { type: "string", description: "HubSpot deal ID" },
        stageId: { type: "string", description: "Target stage ID (e.g. 'appointmentscheduled', 'closedwon')" },
      },
      required: ["hubspotDealId", "stageId"],
    },
  },
  // ─── Gmail & Calendar tools ──────────────────────────────────────────────
  {
    name: "search_emails",
    description: "Search Gmail inbox by query (supports Gmail search syntax like 'from:name subject:topic'). Returns a list of matching emails with sender, subject, date, and snippet.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query (e.g. 'from:john subject:proposal')" },
        maxResults: { type: "number", description: "Max results to return (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_email",
    description: "Read a specific email by its Gmail message ID. Returns full body, sender, recipients, subject, and date.",
    input_schema: {
      type: "object",
      properties: { messageId: { type: "string", description: "Gmail message ID" } },
      required: ["messageId"],
    },
  },
  {
    name: "send_email",
    description: "Send an email. The body should be plain text or simple HTML.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string" },
        body: { type: "string", description: "Email body (plain text or HTML)" },
        cc: { type: "string", description: "CC recipients (comma-separated)" },
        threadId: { type: "string", description: "Thread ID to reply to" },
        inReplyTo: { type: "string", description: "Message-ID header for threading" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "draft_email",
    description: "Create a draft email without sending it.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        cc: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "list_calendar_events",
    description: "List upcoming Google Calendar events within a date range.",
    input_schema: {
      type: "object",
      properties: {
        timeMin: { type: "string", description: "Start datetime ISO string (e.g. 2026-03-18T00:00:00Z)" },
        timeMax: { type: "string", description: "End datetime ISO string" },
        maxResults: { type: "number", description: "Max events (default 20)" },
      },
      required: [],
    },
  },
  {
    name: "create_calendar_event",
    description: "Create a new Google Calendar event.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Event title" },
        date: { type: "string", description: "Date YYYY-MM-DD" },
        startTime: { type: "string", description: "Start time HH:MM (24h)" },
        endTime: { type: "string", description: "End time HH:MM (24h)" },
        description: { type: "string" },
        location: { type: "string" },
        attendees: { type: "array", items: { type: "string" }, description: "Array of attendee email addresses" },
        allDay: { type: "boolean", description: "If true, create an all-day event" },
      },
      required: ["summary", "date"],
    },
  },
  {
    name: "update_calendar_event",
    description: "Update an existing Google Calendar event.",
    input_schema: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        summary: { type: "string" },
        date: { type: "string" },
        startTime: { type: "string" },
        endTime: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
      },
      required: ["eventId"],
    },
  },
  {
    name: "tag_deal_email",
    description: "Associate a Gmail email with a pipeline deal for tracking.",
    input_schema: {
      type: "object",
      properties: {
        dealId: { type: "string", description: "Firestore pipelineDeals doc ID" },
        messageId: { type: "string", description: "Gmail message ID" },
      },
      required: ["dealId", "messageId"],
    },
  },
  {
    name: "tag_deal_calendar_event",
    description: "Associate a calendar event with a pipeline deal.",
    input_schema: {
      type: "object",
      properties: {
        dealId: { type: "string", description: "Firestore pipelineDeals doc ID" },
        eventId: { type: "string", description: "Google Calendar event ID" },
      },
      required: ["dealId", "eventId"],
    },
  },
  {
    name: "get_deal_activity",
    description: "Get all emails and calendar events linked to a specific deal.",
    input_schema: {
      type: "object",
      properties: { dealId: { type: "string" } },
      required: ["dealId"],
    },
  },
];

// ─── Google token helper ─────────────────────────────────────────────────────
async function getGoogleAccessToken(userId) {
  const db = getDb();
  const snap = await db.collection("userGoogleTokens").doc(userId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (Date.now() < data.expiresAt - 60000) return data.accessToken;
  // Refresh
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: data.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const tokens = await res.json();
  const update = { accessToken: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  if (tokens.refresh_token) update.refreshToken = tokens.refresh_token;
  await db.collection("userGoogleTokens").doc(userId).update(update);
  return tokens.access_token;
}

function encodeRawEmail({ to, subject, body, cc, inReplyTo }) {
  const lines = [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/html; charset=utf-8", "MIME-Version: 1.0"];
  if (cc) lines.splice(1, 0, `Cc: ${cc}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`);
  lines.push("", body);
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

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

    case "list_hubspot_stages": {
      if (!hsToken) return { error: "No HubSpot token available" };
      const data = await hsGet(hsToken, "/crm/v3/pipelines/deals");
      return {
        pipelines: (data.results ?? []).map(p => ({
          id: p.id,
          label: p.label,
          stages: (p.stages ?? [])
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map(s => ({ id: s.id, label: s.label, probability: s.metadata?.probability })),
        })),
      };
    }

    case "move_hubspot_deal": {
      if (!hsToken) return { error: "No HubSpot token available" };
      await hsPatch(hsToken, `/crm/v3/objects/deals/${input.hubspotDealId}`, {
        properties: { dealstage: input.stageId },
      });
      // Also update the Firestore deal if it exists
      const fsSnap = await db.collection("pipelineDeals").where("hubspotId", "==", input.hubspotDealId).get();
      if (!fsSnap.empty) {
        const docRef = fsSnap.docs[0].ref;
        const updateData = {
          hubspotStage: input.stageId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (input.stageId === "closedwon") updateData.closedWon = true;
        await docRef.update(updateData);
      }
      return { success: true, dealId: input.hubspotDealId, newStage: input.stageId };
    }

    // ─── Gmail tools ──────────────────────────────────────────────────────
    case "search_emails": {
      const gToken = await getGoogleAccessToken(userId);
      if (!gToken) return { error: "Google not connected. Ask the user to connect their Google account in the app." };
      const maxR = input.maxResults || 10;
      const params = new URLSearchParams({ q: input.query, maxResults: String(maxR) });
      const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, {
        headers: { Authorization: `Bearer ${gToken}` },
      });
      if (!listRes.ok) return { error: `Gmail search error (${listRes.status})` };
      const listData = await listRes.json();
      const ids = (listData.messages || []).map(m => m.id);
      if (ids.length === 0) return { emails: [], message: "No emails found" };
      // Fetch metadata for each
      const emails = [];
      for (const id of ids.slice(0, maxR)) {
        const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata`, {
          headers: { Authorization: `Bearer ${gToken}` },
        });
        if (r.ok) {
          const msg = await r.json();
          const getH = (name) => (msg.payload?.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
          emails.push({ id: msg.id, threadId: msg.threadId, from: getH("From"), to: getH("To"), subject: getH("Subject"), date: getH("Date"), snippet: msg.snippet });
        }
      }
      return { emails };
    }

    case "read_email": {
      const gToken = await getGoogleAccessToken(userId);
      if (!gToken) return { error: "Google not connected" };
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${input.messageId}?format=full`, {
        headers: { Authorization: `Bearer ${gToken}` },
      });
      if (!r.ok) return { error: `Gmail read error (${r.status})` };
      const msg = await r.json();
      const getH = (name) => (msg.payload?.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
      // Extract body
      function findBody(payload) {
        if (payload.body?.data) return Buffer.from(payload.body.data, "base64url").toString("utf-8");
        for (const part of (payload.parts || [])) {
          if (part.mimeType === "text/plain" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf-8");
          if (part.parts) { const b = findBody(part); if (b) return b; }
        }
        return "";
      }
      const body = findBody(msg.payload).slice(0, 3000); // Truncate for context window
      return { id: msg.id, threadId: msg.threadId, from: getH("From"), to: getH("To"), cc: getH("Cc"), subject: getH("Subject"), date: getH("Date"), messageIdHeader: getH("Message-ID"), body };
    }

    case "send_email": {
      const gToken = await getGoogleAccessToken(userId);
      if (!gToken) return { error: "Google not connected" };
      const raw = encodeRawEmail({ to: input.to, subject: input.subject, body: input.body, cc: input.cc, inReplyTo: input.inReplyTo });
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${gToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      if (!r.ok) return { error: `Gmail send error (${r.status})` };
      const sent = await r.json();
      return { success: true, messageId: sent.id };
    }

    case "draft_email": {
      const gToken = await getGoogleAccessToken(userId);
      if (!gToken) return { error: "Google not connected" };
      const raw = encodeRawEmail({ to: input.to, subject: input.subject, body: input.body, cc: input.cc });
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
        method: "POST",
        headers: { Authorization: `Bearer ${gToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: { raw } }),
      });
      if (!r.ok) return { error: `Gmail draft error (${r.status})` };
      const draft = await r.json();
      return { success: true, draftId: draft.id };
    }

    // ─── Calendar tools ────────────────────────────────────────────────────
    case "list_calendar_events": {
      const gToken = await getGoogleAccessToken(userId);
      if (!gToken) return { error: "Google not connected" };
      const params = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", maxResults: String(input.maxResults || 20) });
      if (input.timeMin) params.set("timeMin", input.timeMin);
      else params.set("timeMin", new Date().toISOString());
      if (input.timeMax) params.set("timeMax", input.timeMax);
      const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
        headers: { Authorization: `Bearer ${gToken}` },
      });
      if (!r.ok) return { error: `Calendar list error (${r.status})` };
      const data = await r.json();
      return { events: (data.items || []).map(e => ({ id: e.id, summary: e.summary, start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, location: e.location, attendees: (e.attendees || []).map(a => a.email) })) };
    }

    case "create_calendar_event": {
      const gToken = await getGoogleAccessToken(userId);
      if (!gToken) return { error: "Google not connected" };
      const tz = ctx.tz || "America/Chicago";
      const body = { summary: input.summary, description: input.description, location: input.location };
      if (input.allDay) {
        body.start = { date: input.date };
        body.end = { date: input.date };
      } else {
        body.start = { dateTime: `${input.date}T${input.startTime || "09:00"}:00`, timeZone: tz };
        body.end = { dateTime: `${input.date}T${input.endTime || "10:00"}:00`, timeZone: tz };
      }
      if (input.attendees?.length) body.attendees = input.attendees.map(e => ({ email: e }));
      const r = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: { Authorization: `Bearer ${gToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) return { error: `Calendar create error (${r.status})` };
      const evt = await r.json();
      return { success: true, eventId: evt.id, summary: evt.summary, start: evt.start };
    }

    case "update_calendar_event": {
      const gToken = await getGoogleAccessToken(userId);
      if (!gToken) return { error: "Google not connected" };
      const tz = ctx.tz || "America/Chicago";
      const body = {};
      if (input.summary) body.summary = input.summary;
      if (input.description) body.description = input.description;
      if (input.location) body.location = input.location;
      if (input.date && input.startTime) body.start = { dateTime: `${input.date}T${input.startTime}:00`, timeZone: tz };
      if (input.date && input.endTime) body.end = { dateTime: `${input.date}T${input.endTime}:00`, timeZone: tz };
      const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${input.eventId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${gToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) return { error: `Calendar update error (${r.status})` };
      return { success: true, eventId: input.eventId };
    }

    // ─── Deal tagging tools ────────────────────────────────────────────────
    case "tag_deal_email": {
      const dealSnap = await db.collection("pipelineDeals").doc(input.dealId).get();
      if (!dealSnap.exists) return { error: "Deal not found" };
      // Get email metadata
      const gToken = await getGoogleAccessToken(userId);
      let emailMeta = {};
      if (gToken) {
        try {
          const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${input.messageId}?format=metadata`, {
            headers: { Authorization: `Bearer ${gToken}` },
          });
          if (r.ok) {
            const msg = await r.json();
            const getH = (n) => (msg.payload?.headers || []).find(h => h.name.toLowerCase() === n.toLowerCase())?.value || "";
            emailMeta = { threadId: msg.threadId, subject: getH("Subject"), from: getH("From"), date: getH("Date") };
          }
        } catch {}
      }
      await db.collection("dealEmails").add({
        dealId: input.dealId, dealName: dealSnap.data().name,
        gmailMessageId: input.messageId, ...emailMeta,
        taggedBy: userId, taggedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { success: true, dealName: dealSnap.data().name };
    }

    case "tag_deal_calendar_event": {
      const dealSnap = await db.collection("pipelineDeals").doc(input.dealId).get();
      if (!dealSnap.exists) return { error: "Deal not found" };
      const gToken = await getGoogleAccessToken(userId);
      let evtMeta = {};
      if (gToken) {
        try {
          const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${input.eventId}`, {
            headers: { Authorization: `Bearer ${gToken}` },
          });
          if (r.ok) {
            const evt = await r.json();
            evtMeta = { title: evt.summary, startTime: evt.start?.dateTime || evt.start?.date, endTime: evt.end?.dateTime || evt.end?.date };
          }
        } catch {}
      }
      await db.collection("dealCalendarEvents").add({
        dealId: input.dealId, dealName: dealSnap.data().name,
        calendarEventId: input.eventId, calendarId: "primary", ...evtMeta,
        taggedBy: userId, taggedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { success: true, dealName: dealSnap.data().name };
    }

    case "get_deal_activity": {
      const emailSnap = await db.collection("dealEmails").where("dealId", "==", input.dealId).get();
      const calSnap = await db.collection("dealCalendarEvents").where("dealId", "==", input.dealId).get();
      return {
        emails: emailSnap.docs.map(d => ({ id: d.id, ...d.data() })),
        calendarEvents: calSnap.docs.map(d => ({ id: d.id, ...d.data() })),
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── System prompt ──────────────────────────────────────────────────────────
// Returns the long weekday name for a YYYY-MM-DD string in the given timezone
function dayOfWeekForISO(isoDate, tz = "America/Chicago") {
  // Parse as local date in the timezone by using noon UTC to avoid DST edge cases
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(date);
}

// Annotate any date strings in follow-ups / deals with their day-of-week
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
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // Resolve date parts in the user's timezone (NOT UTC)
  const partsFor = (d) => {
    const p = {};
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "numeric", day: "numeric", weekday: "short",
    }).formatToParts(d).forEach(({ type, value }) => { p[type] = value; });
    return p;
  };
  const weekdayIdx = (d) => {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(d);
    return days.indexOf(wd);
  };
  const fmt = (d) => {
    const p = partsFor(d);
    return `${days[weekdayIdx(d)]} ${months[parseInt(p.month) - 1]} ${parseInt(p.day)}`;
  };
  const iso = (d) => {
    const p = partsFor(d);
    return `${p.year}-${p.month.padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  };

  const todayISO = iso(now);

  // Build this week (Mon–Sun) and next week
  const dayOfWeek = weekdayIdx(now); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);

  let weekLines = "This week:\n";
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const marker = iso(d) === todayISO ? " ← TODAY" : "";
    weekLines += `  ${fmt(d)} (${iso(d)})${marker}\n`;
  }
  weekLines += "Next week:\n";
  for (let i = 7; i < 14; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    weekLines += `  ${fmt(d)} (${iso(d)})\n`;
  }

  return `Today is ${fmt(now)}, ${partsFor(now).year} (${todayISO})\n\n${weekLines}`;
}

function getSystemPrompt(tz) {
  return `You are Bob, a friendly and concise revenue operations assistant for the arr-flow platform. You help manage pipeline deals, track events, log outbound activity, and organize notes and follow-ups.

${getDateContext(tz)}

You have access to the platform's full data layer through tools. Use them proactively — if a user asks about their deals, call list_deals first. If they want to change something, use the appropriate update tool.

Data model context:
- Pipeline deals have buckets: active, future_q1q2, future_q3q4, renewal, untagged
- Confidence is 0-100 (manual override or algorithmic)
- expectedCloseMonth is YYYY-MM format
- Deals can be linked to HubSpot (hubspotId field) — changes to closedWon and value auto-sync
- You can move HubSpot deals between pipeline stages (columns) using move_hubspot_deal. Always call list_hubspot_stages first to get valid stage IDs, then search_hubspot_deals to find the deal.
- Follow-ups are date-based reminders linked to deals
- Notes use a block editor with types: text, h1, h2, h3, bullet, numbered, todo, quote, code, divider

Gmail & Calendar capabilities:
- You can search, read, send, and draft emails via the user's connected Google account
- You can list, create, and update Google Calendar events
- You can tag emails and calendar events to pipeline deals for tracking (tag_deal_email, tag_deal_calendar_event)
- Use get_deal_activity to see all emails and events linked to a specific deal
- If the user hasn't connected Google yet, tell them to visit the Inbox or Calendar page to connect

CRITICAL DATE RULES — violating these is unacceptable:
1. Dates in tool results are pre-annotated with their correct day-of-week (e.g. "Thursday 2026-03-19"). ALWAYS use the day-of-week exactly as it appears in the data. NEVER recompute or guess the day.
2. For any other date, look it up in the calendar above. Do NOT compute days of the week yourself — you WILL get it wrong.
3. If a date is not in the calendar and not in tool results, say just the date without a day name.

Be concise and action-oriented. When you make changes, confirm what you did. Use markdown formatting for readability. When listing deals, format them in a clear table or list.`;
}

// ─── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { conversationId, messages, userId, hsToken, timezone } = req.body;
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

  const tz = timezone || "America/Chicago";
  const ctx = { userId, hsToken, tz };

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
          system: getSystemPrompt(timezone),
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
            const annotated = annotateDates(result, tz);
            toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: JSON.stringify(annotated) });
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
