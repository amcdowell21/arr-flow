export const getFirefliesToken = () => localStorage.getItem("ff_token") || "";
export const setFirefliesToken = (t) =>
  t ? localStorage.setItem("ff_token", t) : localStorage.removeItem("ff_token");

const TRANSCRIPTS_QUERY = `
  query {
    transcripts(limit: 50) {
      id
      title
      date
      duration
      summary {
        action_items
      }
      organizer_email
      participants
    }
  }
`;

export async function fetchTranscripts() {
  const token = getFirefliesToken();
  if (!token) throw new Error("NO_TOKEN");

  const res = await fetch("/api/fireflies", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: TRANSCRIPTS_QUERY }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data?.transcripts || [];
}

// Parses Fireflies action_items string (bullet lines) into an array of strings.
export function parseActionItems(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((s) => s.trim()).filter(Boolean);
  return raw
    .split(/\n/)
    .map((l) => l.replace(/^[\-•*\d.]+\s*/, "").trim())
    .filter(Boolean);
}

// Words too generic to use for domain matching in school districts.
const STOP_WORDS = new Set([
  "school", "schools", "district", "unified", "elementary", "high",
  "middle", "charter", "academy", "county", "city", "public", "education",
  "learning", "institute", "college", "university",
]);

// Matches a deal by extracting the first segment of each participant's email
// domain and checking if it contains a meaningful word from the deal name.
function matchDealByDomain(participants, deals) {
  if (!participants?.length || !deals?.length) return null;

  // Extract first domain segment from email participants (ignore non-emails)
  const domainParts = participants
    .filter((p) => typeof p === "string" && p.includes("@"))
    .map((p) => p.split("@")[1]?.toLowerCase().split(".")[0])
    .filter((p) => p && p.length > 3);

  if (!domainParts.length) return null;

  for (const deal of deals) {
    const dn = (deal.name || "").toLowerCase();
    if (!dn) continue;
    const dealWords = dn.split(/\s+/).filter((w) => w.length > 3 && !STOP_WORDS.has(w));
    for (const seg of domainParts) {
      if (dealWords.some((w) => seg.includes(w) || w.includes(seg))) return deal;
    }
  }
  return null;
}

// Matches a transcript to a pipeline deal.
// Tries participant email domain first (more reliable), then title text matching.
// Returns the matched deal object or null.
export function matchDeal(transcriptTitle, participants, deals) {
  if (!deals?.length) return null;

  // 1 — Email domain match (high confidence)
  const byDomain = matchDealByDomain(participants, deals);
  if (byDomain) return byDomain;

  // 2 — Exact substring match on title
  if (transcriptTitle) {
    const t = transcriptTitle.toLowerCase();
    for (const d of deals) {
      const dn = (d.name || "").toLowerCase();
      if (!dn) continue;
      if (t.includes(dn) || dn.includes(t)) return d;
    }

    // 3 — Word-level match (words > 3 chars, not stop words)
    const words = t.split(/\s+/).filter((w) => w.length > 3 && !STOP_WORDS.has(w));
    for (const d of deals) {
      const dn = (d.name || "").toLowerCase();
      if (words.some((w) => dn.includes(w))) return d;
    }
  }

  return null;
}
