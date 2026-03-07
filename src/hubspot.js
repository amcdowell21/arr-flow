// ─── HubSpot CRM integration ──────────────────────────────────────────────────
// Uses a Private App token (stored in localStorage) to query the CRM v3 API.
//
// In development the Vite dev server proxies /hubspot-api → api.hubapi.com,
// bypassing browser CORS restrictions.  In production a Vercel serverless
// function at /api/hs/... proxies requests server-side.
//
// To create a token: HubSpot → Settings → Integrations → Private Apps
// Required scopes: crm.objects.deals.read, crm.schemas.deals.read

async function hsGet(token, path) {
  // Dev: Vite proxy rewrites /hubspot-api/... → https://api.hubapi.com/...
  // Prod: Vercel serverless function at /api/hubspot?_path=...
  let url;
  if (import.meta.env.DEV) {
    url = `/hubspot-api${path}`;
  } else {
    const [pathOnly, qs] = path.split("?");
    url = `/api/hubspot?_path=${encodeURIComponent(pathOnly)}${qs ? "&" + qs : ""}`;
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HubSpot error (${res.status})`);
  }
  return res.json();
}

/**
 * Fetch ALL deals (all stages, all pipelines), paginating automatically.
 * Properties fetched: dealname, amount, closedate, dealstage, pipeline
 *
 * @param {string} token  HubSpot Private App token
 * @returns {Promise<Array>} raw deal objects
 */
export async function fetchAllDeals(token) {
  let allDeals = [];
  let after;

  do {
    const params = new URLSearchParams({
      properties: [
        "dealname","amount","closedate","dealstage","pipeline",
        "description","createdate","hs_lastmodifieddate",
        "dealtype","hubspot_owner_id","hs_deal_stage_probability",
        "num_associated_contacts","notes_last_updated",
      ].join(","),
      limit: 100,
    });
    if (after) params.set("after", after);

    const data = await hsGet(token, `/crm/v3/objects/deals?${params}`);
    allDeals = [...allDeals, ...data.results];
    after = data.paging?.next?.after;
  } while (after);

  return allDeals;
}

/**
 * Fetch all deal pipelines and their stages.
 * @param {string} token  HubSpot Private App token
 * @returns {Promise<Array>} pipeline objects with .stages array
 */
export async function fetchPipelines(token) {
  const data = await hsGet(token, "/crm/v3/pipelines/deals");
  return data.results ?? [];
}

async function hsPatch(token, path, body) {
  let url;
  if (import.meta.env.DEV) {
    url = `/hubspot-api${path}`;
  } else {
    url = `/api/hubspot?_path=${encodeURIComponent(path)}`;
  }
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HubSpot error (${res.status})`);
  }
  return res.json();
}

/**
 * Update the dealstage of a single deal.
 * @param {string} token   HubSpot Private App token
 * @param {string} dealId  HubSpot deal ID
 * @param {string} stageId target stage ID
 */
export async function updateDealStage(token, dealId, stageId) {
  return hsPatch(token, `/crm/v3/objects/deals/${dealId}`, {
    properties: { dealstage: stageId },
  });
}

async function hsPost(token, path, body) {
  let url;
  if (import.meta.env.DEV) {
    url = `/hubspot-api${path}`;
  } else {
    url = `/api/hubspot?_path=${encodeURIComponent(path)}`;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `HubSpot error (${res.status})`);
  }
  return res.json();
}

/**
 * Fetch contacts associated with a deal.
 * @param {string} token   HubSpot Private App token
 * @param {string} dealId  HubSpot deal ID
 * @returns {Promise<Array>} contact objects with firstname, lastname, email, phone, jobtitle
 */
export async function fetchDealContacts(token, dealId) {
  const assoc = await hsGet(token, `/crm/v3/objects/deals/${dealId}/associations/contacts`);
  const ids = (assoc.results ?? []).map(r => r.id);
  if (ids.length === 0) return [];
  const data = await hsPost(token, "/crm/v3/objects/contacts/batch/read", {
    properties: ["firstname", "lastname", "email", "phone", "jobtitle"],
    inputs: ids.map(id => ({ id })),
  });
  return data.results ?? [];
}

/**
 * Fetch notes associated with a deal, sorted newest first.
 * @param {string} token   HubSpot Private App token
 * @param {string} dealId  HubSpot deal ID
 * @returns {Promise<Array>} note objects with hs_note_body, hs_timestamp
 */
export async function fetchDealNotes(token, dealId) {
  const assoc = await hsGet(token, `/crm/v3/objects/deals/${dealId}/associations/notes`);
  const ids = (assoc.results ?? []).map(r => r.id);
  if (ids.length === 0) return [];
  const data = await hsPost(token, "/crm/v3/objects/notes/batch/read", {
    properties: ["hs_note_body", "hs_timestamp", "hs_lastmodifieddate"],
    inputs: ids.map(id => ({ id })),
  });
  return (data.results ?? []).sort(
    (a, b) => new Date(b.properties?.hs_timestamp) - new Date(a.properties?.hs_timestamp)
  );
}

/**
 * Sum the `amount` for closed-won deals in the given calendar year.
 * @param {Array}  deals  raw deal objects from fetchAllDeals
 * @param {number} year   defaults to current year
 */
export function closedArrForYear(deals, year = new Date().getFullYear()) {
  return deals
    .filter((d) => {
      if (d.properties?.dealstage !== "closedwon") return false;
      const dt = d.properties?.closedate;
      return dt && new Date(dt).getFullYear() === year;
    })
    .reduce((sum, d) => sum + (parseFloat(d.properties?.amount) || 0), 0);
}
