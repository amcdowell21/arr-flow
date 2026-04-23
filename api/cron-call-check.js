// Vercel cron — fires every 5 min (see vercel.json).
// For each connected Google user, looks for calendar events whose *start* time
// was between 30 and 35 min ago, matches external attendees to a pipeline deal,
// and DMs a Slack prompt asking whether to update the deal.
//
// Dedupe is keyed on the Google event ID (`processedCalendarEvents` collection).

import admin from "firebase-admin";

const INTERNAL_DOMAINS = ["uniqlearn.co"];
const MINUTES_AFTER_START = 30;
const WINDOW_MINUTES = 10; // look at events whose start lies in a 10-min window ending MINUTES_AFTER_START ago

// ─── Firestore admin init ───────────────────────────────────────────────────
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

// ─── Google token refresh (matches pattern used in api/gcal.js) ─────────────
async function getGoogleAccessToken(db, uid, data) {
  if (Date.now() < (data.expiresAt || 0) - 60_000) return data.accessToken;

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
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const tokens = await res.json();

  const update = { accessToken: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
  if (tokens.refresh_token) update.refreshToken = tokens.refresh_token;
  await db.collection("userGoogleTokens").doc(uid).update(update);
  return tokens.access_token;
}

// ─── Calendar fetch ─────────────────────────────────────────────────────────
async function listRecentEvents(accessToken, windowStart, windowEnd) {
  // Fetch events whose start is within the window. We widen timeMin a little
  // because Google Calendar's `timeMin` is a ceiling on `end`, not `start`.
  const params = new URLSearchParams({
    timeMin: new Date(windowStart.getTime() - 60 * 60_000).toISOString(),
    timeMax: new Date(windowEnd.getTime() + 60_000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`Calendar list failed: ${r.status}`);
  const data = await r.json();
  return (data.items || []).filter(ev => {
    const start = ev.start?.dateTime || ev.start?.date;
    if (!start) return false;
    const t = new Date(start).getTime();
    return t >= windowStart.getTime() && t < windowEnd.getTime();
  });
}

// ─── Attendee classification ────────────────────────────────────────────────
function splitAttendees(event, userEmail) {
  const all = (event.attendees || []).filter(a => a.email && !a.resource);
  const userDomains = new Set(INTERNAL_DOMAINS.map(d => d.toLowerCase()));
  const external = [];
  for (const a of all) {
    const email = a.email.toLowerCase();
    if (email === (userEmail || "").toLowerCase()) continue;
    const domain = email.split("@")[1];
    if (!domain) continue;
    if (userDomains.has(domain)) continue;
    external.push({ email, domain, displayName: a.displayName || "" });
  }
  return external;
}

// ─── Deal matching ──────────────────────────────────────────────────────────
// Fuzzy: extract the brand from `acmeschools.edu` → `acmeschools`, then look
// for substring (≥4 chars) match against deal names.
function brandFromDomain(domain) {
  if (!domain) return "";
  const parts = domain.split(".");
  const brand = parts.length > 2 ? parts[parts.length - 2] : parts[0];
  return (brand || "").toLowerCase();
}

async function matchByCalendarEventTag(db, eventId) {
  const snap = await db.collection("dealCalendarEvents").where("calendarEventId", "==", eventId).limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].data().dealId || null;
}

async function matchByHubSpotContact(externalEmails) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token || externalEmails.length === 0) return [];

  const dealIds = new Set();
  for (const email of externalEmails) {
    try {
      const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
          properties: ["email"],
          limit: 1,
        }),
      });
      if (!searchRes.ok) continue;
      const data = await searchRes.json();
      const contactId = data.results?.[0]?.id;
      if (!contactId) continue;

      const assocRes = await fetch(
        `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}/associations/deals`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!assocRes.ok) continue;
      const assoc = await assocRes.json();
      for (const r of assoc.results || []) dealIds.add(r.id);
    } catch (e) {
      console.error("[cron] HubSpot contact lookup failed:", e.message);
    }
  }
  return [...dealIds];
}

async function matchByDealNameFuzzy(db, externals) {
  const brands = externals
    .map(e => brandFromDomain(e.domain))
    .filter(b => b && b.length >= 4);
  if (brands.length === 0) return [];

  const snap = await db.collection("pipelineDeals").get();
  const hits = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    const name = (data.name || "").toLowerCase();
    if (!name) continue;
    for (const b of brands) {
      if (name.includes(b)) {
        hits.push({ id: doc.id, ...data });
        break;
      }
    }
  }
  return hits;
}

async function resolveDeals(db, event, externals) {
  // Tier 1: explicit calendar-event → deal tag set by user in CalendarPage.
  const tagged = await matchByCalendarEventTag(db, event.id);
  if (tagged) {
    const snap = await db.collection("pipelineDeals").doc(tagged).get();
    if (snap.exists) return { primary: { id: tagged, ...snap.data() }, candidates: [] };
  }

  // Tier 2: HubSpot contact → associated deals → filter to pipelineDeals we have.
  const hsDealIds = await matchByHubSpotContact(externals.map(e => e.email));
  if (hsDealIds.length) {
    const candidates = [];
    for (const hsId of hsDealIds) {
      const q = await db.collection("pipelineDeals").where("hubspotId", "==", hsId).limit(1).get();
      q.forEach(d => candidates.push({ id: d.id, ...d.data() }));
    }
    if (candidates.length === 1) return { primary: candidates[0], candidates: [] };
    if (candidates.length > 1) return { primary: null, candidates };
  }

  // Tier 3: fuzzy name match on pipelineDeals.
  const fuzzy = await matchByDealNameFuzzy(db, externals);
  if (fuzzy.length === 1) return { primary: fuzzy[0], candidates: [] };
  if (fuzzy.length > 1) return { primary: null, candidates: fuzzy };

  return { primary: null, candidates: [] };
}

// ─── Slack helpers ──────────────────────────────────────────────────────────
function monthLabelFromIso(iso) {
  if (!iso) return "—";
  const [y, m] = iso.split("-");
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
}

function buildInitialBlocks({ eventTitle, deal, candidates, promptId }) {
  const dealLine = deal
    ? `*Deal:* ${deal.name} · $${Math.round((deal.value || 0) / 1000)}k · ${deal.manualConfidence ?? deal.confidence ?? "—"}% · close: ${monthLabelFromIso(deal.expectedCloseMonth)}`
    : candidates?.length
      ? `*${candidates.length} possible deals* — pick which one.`
      : `*No deal matched* — pick one or skip.`;

  // promptId is stuffed into every button's `value` so the interactive handler
  // can find the callPrompt doc without relying on Slack message metadata
  // (which requires a separate app-level opt-in).
  const elements = [];
  if (!deal) {
    elements.push({
      type: "button",
      text: { type: "plain_text", text: "Pick deal" },
      action_id: "pick_deal",
      value: promptId,
      style: "primary",
    });
  } else {
    elements.push(
      { type: "button", text: { type: "plain_text", text: "Confidence" }, action_id: "update_confidence", value: promptId },
      { type: "button", text: { type: "plain_text", text: "Close month" }, action_id: "update_close_month", value: promptId },
      { type: "button", text: { type: "plain_text", text: "Value" }, action_id: "update_value", value: promptId },
      { type: "button", text: { type: "plain_text", text: "Add note" }, action_id: "add_note", value: promptId },
    );
  }
  elements.push({ type: "button", text: { type: "plain_text", text: "Skip" }, action_id: "skip", value: promptId });

  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: `:telephone_receiver: *Call ended:* ${eventTitle}\n${dealLine}` },
    },
    { type: "actions", block_id: "deal_actions", elements },
  ];
}

async function slackDm({ channel, text, blocks }) {
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ channel, text, blocks, unfurl_links: false }),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(`Slack postMessage failed: ${data.error}`);
  return data; // { ok, ts, channel, ... }
}

// ─── Per-user processing ────────────────────────────────────────────────────
async function processUser(db, uid, userDoc) {
  const now = new Date();
  const windowEnd = new Date(now.getTime() - MINUTES_AFTER_START * 60_000);
  const windowStart = new Date(windowEnd.getTime() - WINDOW_MINUTES * 60_000);

  const accessToken = await getGoogleAccessToken(db, uid, userDoc);
  const events = await listRecentEvents(accessToken, windowStart, windowEnd);

  const results = [];
  for (const event of events) {
    try {
      const result = await processEvent(db, uid, userDoc, event);
      results.push({ eventId: event.id, ...result });
    } catch (e) {
      console.error(`[cron] processEvent ${event.id} failed:`, e);
      results.push({ eventId: event.id, error: e.message });
    }
  }
  return results;
}

async function processEvent(db, uid, userDoc, event) {
  // Dedupe.
  const processedRef = db.collection("processedCalendarEvents").doc(event.id);
  const processed = await processedRef.get();
  if (processed.exists) return { skipped: "already_processed" };

  const externals = splitAttendees(event, userDoc.email);
  if (externals.length === 0) {
    await processedRef.set({ reason: "internal_only", processedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { skipped: "internal_only" };
  }

  const { primary, candidates } = await resolveDeals(db, event, externals);

  // Build the prompt doc up front; we need its ID in the Slack message metadata
  // so button clicks can find it.
  const promptRef = db.collection("callPrompts").doc();
  const promptId = promptRef.id;

  const blocks = buildInitialBlocks({
    eventTitle: event.summary || "(untitled meeting)",
    deal: primary,
    candidates,
    promptId,
  });

  const slackRes = await slackDm({
    channel: process.env.SLACK_USER_ID,
    text: `Call ended: ${event.summary || "(untitled)"}`,
    blocks,
  });

  await promptRef.set({
    userId: uid,
    eventId: event.id,
    eventTitle: event.summary || "(untitled meeting)",
    eventStart: event.start?.dateTime || event.start?.date || null,
    externalAttendees: externals,
    matchedDealId: primary?.id || null,
    candidateDeals: candidates.map(c => ({ id: c.id, name: c.name, value: c.value || 0 })),
    slackChannel: slackRes.channel,
    slackMessageTs: slackRes.ts,
    status: "pending",
    updates: {},
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await processedRef.set({
    reason: primary ? "prompted" : candidates.length ? "prompted_multi" : "prompted_no_match",
    promptId,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { prompted: true, promptId, dealId: primary?.id || null, candidateCount: candidates.length };
}

// ─── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Vercel cron sends `authorization: Bearer ${CRON_SECRET}`.
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    const db = getDb();
    const usersSnap = await db.collection("userGoogleTokens").get();

    const summary = [];
    for (const doc of usersSnap.docs) {
      try {
        const results = await processUser(db, doc.id, doc.data());
        summary.push({ uid: doc.id, results });
      } catch (e) {
        console.error(`[cron] user ${doc.id} failed:`, e);
        summary.push({ uid: doc.id, error: e.message });
      }
    }
    console.log("[cron] summary:", JSON.stringify(summary));
    return res.status(200).json({ ok: true, summary });
  } catch (e) {
    console.error("[cron] fatal:", e);
    return res.status(500).json({ error: e.message });
  }
}
