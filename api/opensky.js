// Vercel serverless proxy for OpenSky API
// Uses https module directly (no fetch dependency issues)

import https from 'https';

const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_BASE = 'https://opensky-network.org/api';

let cachedToken = null;
let tokenExpiresAt = 0;

function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 25000,
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });

    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 30000) {
    return cachedToken;
  }

  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await httpsRequest(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
    });
    if (res.status !== 200) return null;
    const data = JSON.parse(res.body);
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

    const response = await httpsRequest(url, { headers });

    if (response.status !== 200) {
      return res.status(response.status).json({
        error: `OpenSky returned ${response.status}`,
        authenticated: !!token,
      });
    }

    // Stream the response directly
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(response.body);
  } catch (err) {
    return res.status(500).json({ error: err.message, authenticated: !!cachedToken });
  }
}
