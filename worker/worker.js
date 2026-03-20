// Cloudflare Worker proxy for OpenSky API

const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_BASE = 'https://opensky-network.org/api';

let cachedToken = null;
let tokenExpiresAt = 0;

export default {
  async fetch(request, env) {
    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': '*' },
      });
    }

    const url = new URL(request.url);
    const endpoint = url.searchParams.get('endpoint');

    // Debug endpoint
    if (!endpoint || endpoint === 'debug') {
      let tokenResult = 'not attempted';
      let apiResult = 'not attempted';

      // Try getting token
      try {
        const body = `grant_type=client_credentials&client_id=${env.OPENSKY_CLIENT_ID}&client_secret=${env.OPENSKY_CLIENT_SECRET}`;
        const authRes = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body,
        });
        const authText = await authRes.text();
        tokenResult = { status: authRes.status, bodyPreview: authText.substring(0, 100) };

        if (authRes.status === 200) {
          const tokenData = JSON.parse(authText);
          // Try data API
          const apiRes = await fetch('https://opensky-network.org/api/states/all?lamin=39&lamax=40&lomin=-87&lomax=-86', {
            headers: { 'Authorization': 'Bearer ' + tokenData.access_token },
          });
          const apiText = await apiRes.text();
          apiResult = { status: apiRes.status, bodyPreview: apiText.substring(0, 100) };
        }
      } catch (e) {
        tokenResult = { error: e.message };
      }

      return jsonResponse({
        hasClientId: !!env.OPENSKY_CLIENT_ID,
        hasClientSecret: !!env.OPENSKY_CLIENT_SECRET,
        clientIdPreview: env.OPENSKY_CLIENT_ID ? env.OPENSKY_CLIENT_ID.substring(0, 5) + '...' : null,
        tokenResult,
        apiResult,
      });
    }

    // Proxy request
    if (!['states/all', 'flights/aircraft'].includes(endpoint)) {
      return jsonResponse({ error: 'Invalid endpoint' }, 400);
    }

    const params = new URLSearchParams(url.searchParams);
    params.delete('endpoint');
    const openskyUrl = `${OPENSKY_BASE}/${endpoint}${params.toString() ? '?' + params.toString() : ''}`;

    try {
      // Get token
      let token = cachedToken;
      if (!token || Date.now() > tokenExpiresAt - 60000) {
        const authRes = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `grant_type=client_credentials&client_id=${env.OPENSKY_CLIENT_ID}&client_secret=${env.OPENSKY_CLIENT_SECRET}`,
        });
        if (authRes.ok) {
          const d = await authRes.json();
          token = d.access_token;
          cachedToken = token;
          tokenExpiresAt = Date.now() + (d.expires_in * 1000);
        }
      }

      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      const response = await fetch(openskyUrl, { headers });

      if (!response.ok) {
        return jsonResponse({ error: `OpenSky ${response.status}`, authenticated: !!token }, response.status);
      }

      return new Response(response.body, {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=8',
        },
      });
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
