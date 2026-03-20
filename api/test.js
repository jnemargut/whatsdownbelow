export const config = { runtime: 'edge' };

export default async function handler(req) {
  const start = Date.now();

  // Test 1: Can we reach OpenSky auth?
  try {
    const tokenRes = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${process.env.OPENSKY_CLIENT_ID}&client_secret=${process.env.OPENSKY_CLIENT_SECRET}`,
    });
    const tokenTime = Date.now() - start;
    const tokenData = await tokenRes.json();

    // Test 2: Can we reach OpenSky API with token?
    const apiStart = Date.now();
    const apiRes = await fetch('https://opensky-network.org/api/states/all?lamin=38&lamax=40&lomin=-88&lomax=-86', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
    });
    const apiTime = Date.now() - apiStart;
    const apiStatus = apiRes.status;
    let stateCount = 0;
    if (apiRes.ok) {
      const d = await apiRes.json();
      stateCount = d.states?.length || 0;
    }

    return new Response(JSON.stringify({
      tokenStatus: tokenRes.status,
      tokenTime: tokenTime + 'ms',
      hasToken: !!tokenData.access_token,
      apiStatus,
      apiTime: apiTime + 'ms',
      stateCount,
      totalTime: (Date.now() - start) + 'ms',
      envSet: !!(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET),
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, time: (Date.now() - start) + 'ms' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
