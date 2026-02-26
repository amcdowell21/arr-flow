// ─── HubSpot CRM integration ──────────────────────────────────────────────────
// Uses a Private App token (stored in localStorage) to query the CRM v3 API.
//
// In development the Vite dev server proxies /hubspot-api → api.hubapi.com,
// bypassing browser CORS restrictions.  In production the request goes direct;
// HubSpot v3 allows CORS for private-app tokens on GET requests.
//
// To create a token: HubSpot → Settings → Integrations → Private Apps
// Required scopes: crm.objects.deals.read, crm.schemas.deals.read

// In dev the Vite proxy rewrites /hubspot-api/... → https://api.hubapi.com/...
const HS_BASE = import.meta.env.DEV ? "/hubspot-api" : "https://api.hubapi.com";

async function hsGet(token, path) {
  const res = await fetch(`${HS_BASE}${path}`, {
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
      properties: "dealname,amount,closedate,dealstage,pipeline",
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
