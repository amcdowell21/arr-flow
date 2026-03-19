// ─── Gmail API client helpers ───────────────────────────────────────────────
// Mirrors the hubspot.js pattern — dev uses Vercel serverless proxy

async function gmailGet(uid, action, params = {}) {
  const qs = new URLSearchParams({ uid, _action: action, ...params });
  const res = await fetch(`/api/gmail?${qs}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Gmail error (${res.status})`);
  }
  return res.json();
}

async function gmailPost(uid, action, body = {}, params = {}) {
  const qs = new URLSearchParams({ uid, _action: action, ...params });
  const res = await fetch(`/api/gmail?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Gmail error (${res.status})`);
  }
  return res.json();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function encodeMessage({ to, subject, body, cc, bcc, inReplyTo, references }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/html; charset=utf-8",
    "MIME-Version: 1.0",
  ];
  if (cc) lines.splice(1, 0, `Cc: ${cc}`);
  if (bcc) lines.splice(1, 0, `Bcc: ${bcc}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push("", body);

  const raw = btoa(unescape(encodeURIComponent(lines.join("\r\n"))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return raw;
}

function getHeader(message, name) {
  const h = message.payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  );
  return h?.value || "";
}

function getMessageBody(message) {
  const payload = message.payload;
  if (!payload) return "";

  // Simple message
  if (payload.body?.data) {
    return decodeBase64(payload.body.data);
  }

  // Multipart — find text/html or text/plain
  const parts = payload.parts || [];
  const htmlPart = findPart(parts, "text/html");
  if (htmlPart?.body?.data) return decodeBase64(htmlPart.body.data);

  const textPart = findPart(parts, "text/plain");
  if (textPart?.body?.data) return decodeBase64(textPart.body.data).replace(/\n/g, "<br>");

  return "";
}

function findPart(parts, mimeType) {
  for (const part of parts) {
    if (part.mimeType === mimeType) return part;
    if (part.parts) {
      const found = findPart(part.parts, mimeType);
      if (found) return found;
    }
  }
  return null;
}

function decodeBase64(data) {
  try {
    return decodeURIComponent(escape(atob(data.replace(/-/g, "+").replace(/_/g, "/"))));
  } catch {
    return atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function listMessages(uid, q = "", maxResults = 20, pageToken = "") {
  const params = { maxResults: String(maxResults) };
  if (q) params.q = q;
  if (pageToken) params.pageToken = pageToken;
  return gmailGet(uid, "list", params);
}

export async function listMessagesWithMetadata(uid, q = "", maxResults = 20, pageToken = "") {
  const params = { maxResults: String(maxResults) };
  if (q) params.q = q;
  if (pageToken) params.pageToken = pageToken;
  return gmailGet(uid, "list_with_metadata", params);
}

export async function getMessage(uid, messageId) {
  const msg = await gmailGet(uid, "get", { id: messageId });
  return {
    ...msg,
    from: getHeader(msg, "From"),
    to: getHeader(msg, "To"),
    cc: getHeader(msg, "Cc"),
    subject: getHeader(msg, "Subject"),
    date: getHeader(msg, "Date"),
    messageId: getHeader(msg, "Message-ID"),
    body: getMessageBody(msg),
    isUnread: (msg.labelIds || []).includes("UNREAD"),
  };
}

export async function getMessageMetadata(uid, messageId) {
  const msg = await gmailGet(uid, "get", { id: messageId, format: "metadata" });
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: getHeader(msg, "From"),
    to: getHeader(msg, "To"),
    subject: getHeader(msg, "Subject"),
    date: getHeader(msg, "Date"),
    snippet: msg.snippet,
    labelIds: msg.labelIds,
    isUnread: (msg.labelIds || []).includes("UNREAD"),
  };
}

export async function sendMessage(uid, { to, subject, body, cc, bcc, inReplyTo, references }) {
  const raw = encodeMessage({ to, subject, body, cc, bcc, inReplyTo, references });
  return gmailPost(uid, "send", { raw });
}

export async function createDraft(uid, { to, subject, body, cc, bcc }) {
  const raw = encodeMessage({ to, subject, body, cc, bcc });
  return gmailPost(uid, "draft_create", { raw });
}

export async function sendDraft(uid, draftId) {
  return gmailPost(uid, "draft_send", { draftId });
}

export async function listDrafts(uid, maxResults = 20) {
  return gmailGet(uid, "drafts", { maxResults: String(maxResults) });
}

export async function getProfile(uid) {
  return gmailGet(uid, "profile");
}

export async function modifyMessage(uid, messageId, addLabelIds = [], removeLabelIds = []) {
  return gmailPost(uid, "modify", { id: messageId, addLabelIds, removeLabelIds });
}

export { getHeader, getMessageBody, encodeMessage };
