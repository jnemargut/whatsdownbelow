// Vercel serverless proxy for OpenSky API
// Handles OAuth2 token exchange server-side (no CORS issues)
// Browser calls /api/opensky?endpoint=states/all&lamin=30&...
// This function authenticates and proxies to OpenSky

const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_BASE = 'https://opensky-network.org/api';

let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 30000) {
    return cachedToken;
  }

  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
  });

  if (!res.ok) {
    console.error('Token fetch failed:', res.status, await res.text());
    return null;
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in * 1000);
  return cachedToken;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');

  const { endpoint, ...params } = req.query;

  if (!endpoint) {
    return res.status(400).json({ error: 'Missing endpoint parameter' });
  }

  // Whitelist allowed endpoints
  const allowed = ['states/all', 'flights/aircraft'];
  if (!allowed.includes(endpoint)) {
    return res.status(400).json({ error: 'Invalid endpoint' });
  }

  // Build the OpenSky URL
  const queryString = new URLSearchParams(params).toString();
  const url = `${OPENSKY_BASE}/${endpoint}${queryString ? '?' + queryString : ''}`;

  try {
    const token = await getToken();
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    const response = await fetch(url, { headers });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `OpenSky returned ${response.status}`,
        authenticated: !!token,
      });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
