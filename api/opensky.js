// Vercel serverless proxy for OpenSky API
// Handles OAuth2 token exchange server-side (no CORS issues)

export const config = {
  runtime: 'edge',
  maxDuration: 30, // Allow up to 30 seconds for OpenSky response
};

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
    console.log('No OpenSky credentials configured');
    return null;
  }

  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
    });

    if (!res.ok) {
      console.error('Token fetch failed:', res.status);
      return null;
    }

    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in * 1000);
    return cachedToken;
  } catch (e) {
    console.error('Token error:', e.message);
    return null;
  }
}

export default async function handler(req) {
  const url = new URL(req.url);
  const endpoint = url.searchParams.get('endpoint');

  if (!endpoint) {
    return new Response(JSON.stringify({ error: 'Missing endpoint' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Whitelist
  const allowed = ['states/all', 'flights/aircraft'];
  if (!allowed.includes(endpoint)) {
    return new Response(JSON.stringify({ error: 'Invalid endpoint' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Build OpenSky URL -- pass through all params except 'endpoint'
  const params = new URLSearchParams(url.searchParams);
  params.delete('endpoint');
  const openskyUrl = `${OPENSKY_BASE}/${endpoint}${params.toString() ? '?' + params.toString() : ''}`;

  try {
    const token = await getToken();
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

    const response = await fetch(openskyUrl, { headers });

    if (!response.ok) {
      return new Response(JSON.stringify({
        error: `OpenSky returned ${response.status}`,
        authenticated: !!token,
      }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const data = await response.text(); // Pass through as-is
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=10, stale-while-revalidate=5',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
