// ─── HubSpot CRM integration ──────────────────────────────────────────────────
// Uses a Private App token (stored in localStorage) to query the CRM v3 API.
//
// In development the Vite dev server proxies /hubspot-api → api.hubapi.com,
// bypassing browser CORS restrictions.  In production the request goes direct;
// HubSpot v3 allows CORS for private-app tokens on GET requests.
//
// To create a token: HubSpot → Settings → Integrations → Private Apps
// Required scope: crm.objects.deals.read

// In dev the Vite proxy rewrites /hubspot-api/... → https://api.hubapi.com/...
const HS_BASE = import.meta.env.DEV ? "/hubspot-api" : "https://api.hubapi.com";

/**
 * Fetch all Closed Won deals (paginates automatically).
 * Uses the GET /crm/v3/objects/deals endpoint with dealstage as a property
 * so we can filter client-side — avoids the POST search endpoint which has
 * stricter CORS preflight requirements in some browser/network configs.
 *
 * @param {string} token  HubSpot Private App token
 * @returns {Promise<Array>} raw deal objects (closedwon only)
 */
export async function fetchClosedDeals(token) {
  let allDeals = [];
  let after;

  do {
    const params = new URLSearchParams({
      properties: "dealname,amount,closedate,dealstage",
      limit: 100,
    });
    if (after) params.set("after", after);

    const res = await fetch(`${HS_BASE}/crm/v3/objects/deals?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HubSpot error (${res.status})`);
    }

    const data = await res.json();
    const closedWon = data.results.filter(
      (d) => d.properties?.dealstage === "closedwon"
    );
    allDeals = [...allDeals, ...closedWon];
    after = data.paging?.next?.after;
  } while (after);

  return allDeals;
}

/**
 * Sum the `amount` property for deals closed in the given calendar year.
 * @param {Array}  deals  raw deal objects from fetchClosedDeals
 * @param {number} year   defaults to current year
 */
export function closedArrForYear(deals, year = new Date().getFullYear()) {
  return deals
    .filter((d) => {
      const dt = d.properties?.closedate;
      return dt && new Date(dt).getFullYear() === year;
    })
    .reduce((sum, d) => sum + (parseFloat(d.properties?.amount) || 0), 0);
}
