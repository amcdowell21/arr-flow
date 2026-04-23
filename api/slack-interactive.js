// Vercel serverless function — Slack Interactivity endpoint.
// Receives button clicks + modal submissions, verifies the signature, and
// opens modals / updates pipelineDeals accordingly.
//
// Slack sends the raw body as application/x-www-form-urlencoded. Body parser
// must stay OFF so we can recompute the HMAC signature over the raw bytes.

import admin from "firebase-admin";
import crypto from "crypto";

export const config = { api: { bodyParser: false } };

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

// ─── Raw-body + signature helpers ───────────────────────────────────────────
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function verifySlackSignature(rawBody, timestamp, signature) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;

  // Reject requests older than 5 min (replay protection).
  const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10));
  if (age > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ─── Slack Web API helpers ──────────────────────────────────────────────────
async function slack(method, payload) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`[slack] ${method} failed:`, JSON.stringify(data));
    console.error(`[slack] payload sent:`, JSON.stringify(payload));
    const detail = data.response_metadata?.messages?.join("; ") || data.error;
    throw new Error(`Slack ${method} failed: ${detail}`);
  }
  return data;
}

// ─── Modal builders ─────────────────────────────────────────────────────────
function modalConfidence(promptId, current) {
  return {
    type: "modal",
    callback_id: "submit_confidence",
    private_metadata: promptId,
    title: { type: "plain_text", text: "Update Confidence" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "confidence",
        label: { type: "plain_text", text: "Confidence %" },
        element: {
          type: "number_input",
          action_id: "value",
          is_decimal_allowed: false,
          min_value: "0",
          max_value: "100",
          initial_value: current != null ? String(current) : undefined,
        },
      },
    ],
  };
}

function modalCloseMonth(promptId, currentIso) {
  // Build 18 options: 6 past months through 12 future months.
  const now = new Date();
  const options = [];
  for (let i = -2; i <= 15; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-US", { month: "long", year: "numeric" });
    options.push({ text: { type: "plain_text", text: label }, value: iso });
  }
  const initial = currentIso && options.find(o => o.value === currentIso);
  return {
    type: "modal",
    callback_id: "submit_close_month",
    private_metadata: promptId,
    title: { type: "plain_text", text: "Expected Close Month" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "month",
        label: { type: "plain_text", text: "Month" },
        element: {
          type: "static_select",
          action_id: "value",
          options,
          ...(initial ? { initial_option: initial } : {}),
        },
      },
    ],
  };
}

function modalValue(promptId, current) {
  return {
    type: "modal",
    callback_id: "submit_value",
    private_metadata: promptId,
    title: { type: "plain_text", text: "Update Deal Value" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "amount",
        label: { type: "plain_text", text: "Deal Value ($)" },
        element: {
          type: "number_input",
          action_id: "value",
          is_decimal_allowed: true,
          min_value: "0",
          initial_value: current != null ? String(current) : undefined,
        },
      },
    ],
  };
}

function modalNote(promptId) {
  return {
    type: "modal",
    callback_id: "submit_note",
    private_metadata: promptId,
    title: { type: "plain_text", text: "Add Quick Note" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "note",
        label: { type: "plain_text", text: "Note" },
        element: {
          type: "plain_text_input",
          action_id: "value",
          multiline: true,
          max_length: 2000,
        },
      },
    ],
  };
}

function modalPickDeal(promptId, candidates) {
  if (!candidates || candidates.length === 0) {
    return {
      type: "modal",
      callback_id: "submit_pick_deal_empty",
      private_metadata: promptId,
      title: { type: "plain_text", text: "Pick Deal" },
      close: { type: "plain_text", text: "Close" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "No deals to pick from yet. Add some to the Pipeline Tracker first.",
          },
        },
      ],
    };
  }
  const options = candidates.slice(0, 100).map(d => ({
    text: {
      type: "plain_text",
      // Slack caps option text at 75 chars.
      text: `${d.name}${d.value ? ` · $${Math.round(d.value / 1000)}k` : ""}`.slice(0, 75),
    },
    value: d.id,
  }));
  return {
    type: "modal",
    callback_id: "submit_pick_deal",
    private_metadata: promptId,
    title: { type: "plain_text", text: "Pick Deal" },
    submit: { type: "plain_text", text: "Select" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "deal",
        label: { type: "plain_text", text: "Which deal was this call about?" },
        element: { type: "static_select", action_id: "value", options },
      },
    ],
  };
}

// ─── Message rebuild (after an update) ──────────────────────────────────────
// Re-uses the same block shape as the initial prompt (see cron handler).
function monthLabelFromIso(iso) {
  if (!iso) return "—";
  const [y, m] = iso.split("-");
  const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

function buildPromptBlocks(prompt, deal, promptId) {
  const dealLine = deal
    ? `*Deal:* ${deal.name} · $${Math.round((deal.value || 0) / 1000)}k · ${deal.manualConfidence ?? deal.confidence ?? "—"}% · close: ${monthLabelFromIso(deal.expectedCloseMonth)}`
    : `*No deal matched* — pick one to update.`;

  const updates = prompt.updates || {};
  const updateLines = [];
  if (updates.confidence != null) updateLines.push(`✓ Confidence → ${updates.confidence}%`);
  if (updates.expectedCloseMonth) updateLines.push(`✓ Close month → ${monthLabelFromIso(updates.expectedCloseMonth)}`);
  if (updates.value != null) updateLines.push(`✓ Value → $${Math.round(updates.value / 1000)}k`);
  if (updates.note) updateLines.push(`✓ Note added`);

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:telephone_receiver: *Call ended:* ${prompt.eventTitle}\n${dealLine}`,
      },
    },
  ];

  if (updateLines.length) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: updateLines.join("  •  ") }] });
  }

  if (prompt.status === "skipped") {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "_Skipped._" }] });
  } else {
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
    blocks.push({ type: "actions", block_id: "deal_actions", elements });
  }

  return blocks;
}

async function refreshMessage(prompt, promptId) {
  const db = getDb();
  const deal = prompt.matchedDealId
    ? (await db.collection("pipelineDeals").doc(prompt.matchedDealId).get()).data()
    : null;
  const blocks = buildPromptBlocks(prompt, deal ? { id: prompt.matchedDealId, ...deal } : null, promptId);
  await slack("chat.update", {
    channel: prompt.slackChannel,
    ts: prompt.slackMessageTs,
    text: `Call ended: ${prompt.eventTitle}`,
    blocks,
  });
}

// ─── Handlers ───────────────────────────────────────────────────────────────
async function handleBlockAction(payload) {
  const action = payload.actions?.[0];
  if (!action) return;
  const promptId = action.value;
  if (!promptId) {
    console.error("[slack] block_action with no promptId in button value");
    return;
  }

  const db = getDb();
  const snap = await db.collection("callPrompts").doc(promptId).get();
  if (!snap.exists) return;
  const prompt = snap.data();

  // Skip is terminal and doesn't need a modal.
  if (action.action_id === "skip") {
    await db.collection("callPrompts").doc(promptId).update({
      status: "skipped",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await refreshMessage({ ...prompt, status: "skipped" }, promptId);
    return;
  }

  // Everything else opens a modal.
  let view;
  const deal = prompt.matchedDealId
    ? (await db.collection("pipelineDeals").doc(prompt.matchedDealId).get()).data()
    : null;

  switch (action.action_id) {
    case "update_confidence":
      view = modalConfidence(promptId, deal?.manualConfidence ?? deal?.confidence);
      break;
    case "update_close_month":
      view = modalCloseMonth(promptId, deal?.expectedCloseMonth);
      break;
    case "update_value":
      view = modalValue(promptId, deal?.value);
      break;
    case "add_note":
      view = modalNote(promptId);
      break;
    case "pick_deal": {
      let candidates = prompt.candidateDeals || [];
      if (candidates.length === 0) {
        // No auto-matches — fall back to the 100 most-recently-updated deals
        // so there's always something to pick from.
        const recent = await db.collection("pipelineDeals")
          .orderBy("updatedAt", "desc")
          .limit(100)
          .get();
        candidates = recent.docs.map(d => ({
          id: d.id,
          name: d.data().name || "(unnamed)",
          value: d.data().value || 0,
        }));
      }
      view = modalPickDeal(promptId, candidates);
      break;
    }
    default:
      console.warn("[slack] unknown action:", action.action_id);
      return;
  }

  await slack("views.open", { trigger_id: payload.trigger_id, view });
}

async function handleViewSubmission(payload) {
  const view = payload.view;
  const promptId = view.private_metadata;
  if (!promptId) return { response_action: "errors", errors: {} };

  const db = getDb();
  const promptRef = db.collection("callPrompts").doc(promptId);
  const snap = await promptRef.get();
  if (!snap.exists) return {};
  const prompt = snap.data();

  const values = view.state.values;
  const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  const dealUpdates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };

  switch (view.callback_id) {
    case "submit_confidence": {
      const raw = values.confidence?.value?.value;
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && prompt.matchedDealId) {
        dealUpdates.manualConfidence = n;
        dealUpdates.useAlgoConfidence = false;
        await db.collection("pipelineDeals").doc(prompt.matchedDealId).update(dealUpdates);
        updates["updates.confidence"] = n;
      }
      break;
    }
    case "submit_close_month": {
      const iso = values.month?.value?.selected_option?.value;
      if (iso && prompt.matchedDealId) {
        dealUpdates.expectedCloseMonth = iso;
        await db.collection("pipelineDeals").doc(prompt.matchedDealId).update(dealUpdates);
        updates["updates.expectedCloseMonth"] = iso;
      }
      break;
    }
    case "submit_value": {
      const raw = values.amount?.value?.value;
      const n = parseFloat(raw);
      if (Number.isFinite(n) && prompt.matchedDealId) {
        dealUpdates.value = n;
        await db.collection("pipelineDeals").doc(prompt.matchedDealId).update(dealUpdates);
        updates["updates.value"] = n;
      }
      break;
    }
    case "submit_note": {
      const txt = values.note?.value?.value;
      if (txt && prompt.matchedDealId) {
        // Append to existing notes with a timestamp header.
        const dealSnap = await db.collection("pipelineDeals").doc(prompt.matchedDealId).get();
        const prev = dealSnap.data()?.notes || "";
        const header = `[${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })} — from call "${prompt.eventTitle}"]`;
        const next = prev ? `${prev}\n\n${header}\n${txt}` : `${header}\n${txt}`;
        dealUpdates.notes = next;
        await db.collection("pipelineDeals").doc(prompt.matchedDealId).update(dealUpdates);
        updates["updates.note"] = txt;
      }
      break;
    }
    case "submit_pick_deal": {
      const dealId = values.deal?.value?.selected_option?.value;
      if (dealId) {
        updates.matchedDealId = dealId;
      }
      break;
    }
  }

  await promptRef.update(updates);
  const refreshed = (await promptRef.get()).data();
  await refreshMessage(refreshed, promptId);

  return {}; // Empty body closes the modal.
}

// ─── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const raw = await readRawBody(req);
  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];

  if (!verifySlackSignature(raw, timestamp, signature)) {
    return res.status(401).send("Invalid signature");
  }

  // Body is URL-encoded form with a single `payload` field holding JSON.
  const params = new URLSearchParams(raw);
  const payloadStr = params.get("payload");
  if (!payloadStr) return res.status(400).send("Missing payload");

  let payload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return res.status(400).send("Bad payload");
  }

  try {
    if (payload.type === "block_actions") {
      console.log("[slack-interactive] block_action:", payload.actions?.[0]?.action_id);
      await handleBlockAction(payload);
      res.status(200).send("");
    } else if (payload.type === "view_submission") {
      console.log("[slack-interactive] view_submission:", payload.view?.callback_id);
      const response = await handleViewSubmission(payload);
      res.status(200).json(response);
    } else {
      res.status(200).send("");
    }
  } catch (e) {
    console.error("[slack-interactive] error:", e.message, e.stack);
    if (!res.writableEnded) res.status(500).send("Internal error");
  }
}
