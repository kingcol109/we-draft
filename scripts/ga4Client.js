// scripts/lib/ga4Client.js
//
// Talks to the GA4 Data API. Kept separate from the sync script itself so
// the same pattern (a small client module exporting one or more `fetchX()`
// functions, each returning already-shaped data) can be repeated for the
// future sources mentioned — scripts/lib/youtubeClient.js,
// scripts/lib/searchConsoleClient.js, etc. — without the sync script or
// Firestore-writing logic needing to know anything source-specific.

const { GoogleAuth } = require("google-auth-library");
const { loadServiceAccount } = require("./googleAuth");

const GA_PROPERTY_ID = process.env.GA_PROPERTY_ID;

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getAccessToken() {
  // Access tokens are short-lived (~1hr); cache within a single script run
  // or warm serverless invocation rather than re-authenticating per call.
  if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

  const auth = new GoogleAuth({
    credentials: loadServiceAccount(),
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  const client = await auth.getClient();
  const { token, expiry_date: expiryMs } = await client.getAccessToken();
  cachedToken = token;
  cachedTokenExpiry = (expiryMs || Date.now() + 55 * 60 * 1000) - 60 * 1000; // refresh 1 min early
  return token;
}

// ── Fetches page views per pagePath across six windows: 24h/7d/30d/90d/1y/total.
//
// Originally attempted as a single runReport call using GA4's multi-
// dateRange feature with a `dateRange` dimension to distinguish rows per
// window — that's actually only valid inside runPivotReport, not plain
// runReport (confirmed by GA4's own error message: "Field dateRange is not
// a dimension... can be used in a Pivot or OrderBy like a dimension, but
// does not need to be listed in the Dimensions"). Plain runReport does
// support multiple dateRanges and will auto-append a date-range indicator
// per row, but relying on that undocumented-here auto-labeling was more
// fragile than just making four separate simple, well-documented calls —
// so that's what this does instead. Same external contract either way:
// callers still get back one flat `rows` array shaped like
// { dimensionValues: [pagePath, windowName], metricValues: [views] },
// so aggregateBySlug() in syncGoogleAnalytics.js didn't need to change.
//
// Caveat worth knowing: "last24Hours" here is startDate/endDate = "today",
// which GA4 evaluates as the current calendar day in the property's
// timezone — not a rolling 24-hour window. Early in the day this will read
// low relative to a true last-24-hours figure. ──
async function fetchPageViewsByPath() {
  if (!GA_PROPERTY_ID) {
    throw new Error("GA_PROPERTY_ID env var is not set.");
  }

  const token = await getAccessToken();

  const windows = [
    { name: "last24Hours", startDate: "today", endDate: "today" },
    { name: "last7Days", startDate: "6daysAgo", endDate: "today" },
    { name: "last30Days", startDate: "29daysAgo", endDate: "today" },
    { name: "last90Days", startDate: "89daysAgo", endDate: "today" },
    { name: "lastYear", startDate: "364daysAgo", endDate: "today" },
    // GA4's API has no built-in "all time" keyword. This is a stand-in
    // start date early enough to predate the property in practice —
    // adjust if the property is older than this.
    { name: "total", startDate: "2015-08-14", endDate: "today" },
  ];

  const runOneWindow = async (win) => {
    const body = {
      dateRanges: [{ startDate: win.startDate, endDate: win.endDate }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      limit: 100000,
    };

    const response = await fetch(
      "https://analyticsdata.googleapis.com/v1beta/properties/" + GA_PROPERTY_ID + ":runReport",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new Error("GA4 API error for " + win.name + " (" + response.status + "): " + detail);
    }

    const data = await response.json();
    // Reshape into the same { dimensionValues: [pagePath, windowName],
    // metricValues: [views] } row format the old single-call design would
    // have produced, so aggregateBySlug() downstream needs no changes.
    return (data.rows || []).map((row) => ({
      dimensionValues: [row.dimensionValues[0], { value: win.name }],
      metricValues: row.metricValues,
    }));
  };

  const perWindowRows = await Promise.all(windows.map(runOneWindow));
  return perWindowRows.flat();
}

module.exports = { fetchPageViewsByPath };