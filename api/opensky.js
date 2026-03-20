// Vercel serverless proxy for OpenSky API
// Node.js runtime with native fetch (Node 18+)

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
  if (!clientId || !clientSecret) return null;

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10000);

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in * 1000);
    return cachedToken;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');

  const { endpoint, ...params } = req.query;

  if (!endpoint || !['states/all', 'flights/aircraft'].includes(endpoint)) {
    return res.status(400).json({ error: 'Invalid or missing endpoint' });
  }

  const queryString = new URLSearchParams(params).toString();
  const url = `${OPENSKY_BASE}/${endpoint}${queryString ? '?' + queryString : ''}`;

  try {
    const token = await getToken();
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 25000);

    const response = await fetch(url, { headers, signal: controller.signal });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `OpenSky returned ${response.status}`,
        authenticated: !!token,
      });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    // Fall back: try without auth
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 15000);
      const fallback = await fetch(url, { signal: controller.signal });
      if (fallback.ok) {
        const data = await fallback.json();
        return res.status(200).json(data);
      }
    } catch {}

    return res.status(500).json({ error: err.message, authenticated: !!cachedToken });
  }
}
