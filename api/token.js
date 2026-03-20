// Token exchange endpoint
// Browser calls this to get an OpenSky bearer token
// Auth server (auth.opensky-network.org) may not block cloud IPs
// even though the data API (opensky-network.org) does

import https from 'https';

let cachedToken = null;
let tokenExpiresAt = 0;

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return res.status(200).json({
      access_token: cachedToken,
      expires_in: Math.floor((tokenExpiresAt - Date.now()) / 1000),
      cached: true,
    });
  }

  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'No OpenSky credentials configured' });
  }

  try {
    const tokenRes = await httpsPost(
      'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
      `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`
    );

    if (tokenRes.status !== 200) {
      return res.status(tokenRes.status).json({
        error: `Auth server returned ${tokenRes.status}`,
        body: tokenRes.body.substring(0, 200),
      });
    }

    const data = JSON.parse(tokenRes.body);
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in * 1000);

    // Cache on CDN for 25 minutes (token lasts 30)
    res.setHeader('Cache-Control', 's-maxage=1500, stale-while-revalidate=300');

    return res.status(200).json({
      access_token: data.access_token,
      expires_in: data.expires_in,
      cached: false,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
