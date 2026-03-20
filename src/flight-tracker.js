// OpenSky Network flight tracker
// Routes through Cloudflare Worker proxy for authenticated access (4000 credits/day)
// Cloudflare is NOT blocked by OpenSky (unlike Vercel/AWS)

import routesDB from './routes-db.js';

const OPENSKY_BASE = 'https://opensky-network.org/api';
const PROXY_BASE = 'https://opensky-proxy.jontomato.workers.dev';

// Cache responses
const statesCache = { data: null, timestamp: 0 };
const CACHE_TTL = 10000; // 10 seconds

export async function openskyFetch(url) {
  // Check cache
  if (url.includes('/states/all')) {
    if (statesCache.data && Date.now() - statesCache.timestamp < CACHE_TTL) {
      return statesCache.data;
    }
  }

  // Route through Cloudflare proxy for authenticated access
  let fetchUrl = url;
  if (url.includes('opensky-network.org')) {
    const parsed = new URL(url);
    const endpoint = parsed.pathname.replace('/api/', '');
    const params = new URLSearchParams(parsed.searchParams);
    params.set('endpoint', endpoint);
    fetchUrl = `${PROXY_BASE}/?${params.toString()}`;
  }

  const response = await fetch(fetchUrl);
  if (response.status === 429) {
    throw new Error('Rate limited -- try again in a moment');
  }
  if (!response.ok) throw new Error(`OpenSky API returned ${response.status}`);
  const data = await response.json();

  if (url.includes('/states/all')) {
    statesCache.data = data;
    statesCache.timestamp = Date.now();
  }

  return data;
}

// Common airline ICAO prefixes mapped from IATA codes
const AIRLINE_MAP = {
  'DL': 'DAL', 'AA': 'AAL', 'UA': 'UAL', 'WN': 'SWA',
  'B6': 'JBU', 'AS': 'ASA', 'NK': 'NKS', 'F9': 'FFT',
  'G4': 'AAY', 'HA': 'HAL', 'SY': 'SCX', 'MX': 'MXA',
};

// US Airport coordinates for route drawing -- top 60 busiest US airports
export const AIRPORTS = {
  'ATL': { lat: 33.6407, lng: -84.4277, name: 'Atlanta', state: 'GA', tz: 'America/New_York' },
  'LAX': { lat: 33.9425, lng: -118.4081, name: 'Los Angeles', state: 'CA', tz: 'America/Los_Angeles' },
  'ORD': { lat: 41.9742, lng: -87.9073, name: 'Chicago', state: 'IL', tz: 'America/Chicago' },
  'DFW': { lat: 32.8998, lng: -97.0403, name: 'Dallas', state: 'TX', tz: 'America/Chicago' },
  'DEN': { lat: 39.8561, lng: -104.6737, name: 'Denver', state: 'CO', tz: 'America/Denver' },
  'JFK': { lat: 40.6413, lng: -73.7781, name: 'New York', state: 'NY', tz: 'America/New_York' },
  'SFO': { lat: 37.6213, lng: -122.3790, name: 'San Francisco', state: 'CA', tz: 'America/Los_Angeles' },
  'SEA': { lat: 47.4502, lng: -122.3088, name: 'Seattle', state: 'WA', tz: 'America/Los_Angeles' },
  'LAS': { lat: 36.0840, lng: -115.1537, name: 'Las Vegas', state: 'NV', tz: 'America/Los_Angeles' },
  'MCO': { lat: 28.4312, lng: -81.3081, name: 'Orlando', state: 'FL', tz: 'America/New_York' },
  'EWR': { lat: 40.6895, lng: -74.1745, name: 'Newark', state: 'NJ', tz: 'America/New_York' },
  'MIA': { lat: 25.7959, lng: -80.2870, name: 'Miami', state: 'FL', tz: 'America/New_York' },
  'PHX': { lat: 33.4373, lng: -112.0078, name: 'Phoenix', state: 'AZ', tz: 'America/Phoenix' },
  'IAH': { lat: 29.9902, lng: -95.3368, name: 'Houston', state: 'TX', tz: 'America/Chicago' },
  'BOS': { lat: 42.3656, lng: -71.0096, name: 'Boston', state: 'MA', tz: 'America/New_York' },
  'MSP': { lat: 44.8848, lng: -93.2223, name: 'Minneapolis', state: 'MN', tz: 'America/Chicago' },
  'FLL': { lat: 26.0726, lng: -80.1527, name: 'Fort Lauderdale', state: 'FL', tz: 'America/New_York' },
  'DTW': { lat: 42.2162, lng: -83.3554, name: 'Detroit', state: 'MI', tz: 'America/Detroit' },
  'CLT': { lat: 35.2140, lng: -80.9431, name: 'Charlotte', state: 'NC', tz: 'America/New_York' },
  'LGA': { lat: 40.7772, lng: -73.8726, name: 'New York LaGuardia', state: 'NY', tz: 'America/New_York' },
  'PHL': { lat: 39.8721, lng: -75.2411, name: 'Philadelphia', state: 'PA', tz: 'America/New_York' },
  'SLC': { lat: 40.7884, lng: -111.9778, name: 'Salt Lake City', state: 'UT', tz: 'America/Denver' },
  'DCA': { lat: 38.8512, lng: -77.0402, name: 'Washington DC', state: 'DC', tz: 'America/New_York' },
  'SAN': { lat: 32.7338, lng: -117.1933, name: 'San Diego', state: 'CA', tz: 'America/Los_Angeles' },
  'IAD': { lat: 38.9531, lng: -77.4565, name: 'Washington Dulles', state: 'VA', tz: 'America/New_York' },
  'TPA': { lat: 27.9755, lng: -82.5332, name: 'Tampa', state: 'FL', tz: 'America/New_York' },
  'BNA': { lat: 36.1263, lng: -86.6774, name: 'Nashville', state: 'TN', tz: 'America/Chicago' },
  'AUS': { lat: 30.1975, lng: -97.6664, name: 'Austin', state: 'TX', tz: 'America/Chicago' },
  'PDX': { lat: 45.5898, lng: -122.5951, name: 'Portland', state: 'OR', tz: 'America/Los_Angeles' },
  'STL': { lat: 38.7487, lng: -90.3700, name: 'St. Louis', state: 'MO', tz: 'America/Chicago' },
  'MSY': { lat: 29.9934, lng: -90.2580, name: 'New Orleans', state: 'LA', tz: 'America/Chicago' },
  'HNL': { lat: 21.3245, lng: -157.9251, name: 'Honolulu', state: 'HI', tz: 'Pacific/Honolulu' },
  'OAK': { lat: 37.7213, lng: -122.2208, name: 'Oakland', state: 'CA', tz: 'America/Los_Angeles' },
  'SAT': { lat: 29.5337, lng: -98.4698, name: 'San Antonio', state: 'TX', tz: 'America/Chicago' },
  'RDU': { lat: 35.8776, lng: -78.7875, name: 'Raleigh', state: 'NC', tz: 'America/New_York' },
  'SJC': { lat: 37.3626, lng: -121.9291, name: 'San Jose', state: 'CA', tz: 'America/Los_Angeles' },
  'DAL': { lat: 32.8471, lng: -96.8518, name: 'Dallas Love', state: 'TX', tz: 'America/Chicago' },
  'MDW': { lat: 41.7868, lng: -87.7524, name: 'Chicago Midway', state: 'IL', tz: 'America/Chicago' },
  'IND': { lat: 39.7173, lng: -86.2944, name: 'Indianapolis', state: 'IN', tz: 'America/Indiana/Indianapolis' },
  'CLE': { lat: 41.4117, lng: -81.8498, name: 'Cleveland', state: 'OH', tz: 'America/New_York' },
  'PIT': { lat: 40.4915, lng: -80.2329, name: 'Pittsburgh', state: 'PA', tz: 'America/New_York' },
  'CMH': { lat: 39.9980, lng: -82.8919, name: 'Columbus', state: 'OH', tz: 'America/New_York' },
  'ABQ': { lat: 35.0402, lng: -106.6090, name: 'Albuquerque', state: 'NM', tz: 'America/Denver' },
  'BHM': { lat: 33.5629, lng: -86.7535, name: 'Birmingham', state: 'AL', tz: 'America/Chicago' },
  'JAX': { lat: 30.4941, lng: -81.6879, name: 'Jacksonville', state: 'FL', tz: 'America/New_York' },
  'MKE': { lat: 42.9472, lng: -87.8966, name: 'Milwaukee', state: 'WI', tz: 'America/Chicago' },
  'RNO': { lat: 39.4991, lng: -119.7681, name: 'Reno', state: 'NV', tz: 'America/Los_Angeles' },
  'TUS': { lat: 32.1161, lng: -110.9410, name: 'Tucson', state: 'AZ', tz: 'America/Phoenix' },
  'ELP': { lat: 31.8072, lng: -106.3770, name: 'El Paso', state: 'TX', tz: 'America/Denver' },
  'JAN': { lat: 32.3112, lng: -90.0759, name: 'Jackson', state: 'MS', tz: 'America/Chicago' },
  'BWI': { lat: 39.1754, lng: -76.6683, name: 'Baltimore', state: 'MD', tz: 'America/New_York' },
  'MCI': { lat: 39.2976, lng: -94.7139, name: 'Kansas City', state: 'MO', tz: 'America/Chicago' },
  'SMF': { lat: 38.6954, lng: -121.5908, name: 'Sacramento', state: 'CA', tz: 'America/Los_Angeles' },
  'RSW': { lat: 26.5362, lng: -81.7552, name: 'Fort Myers', state: 'FL', tz: 'America/New_York' },
  'BUF': { lat: 42.9405, lng: -78.7322, name: 'Buffalo', state: 'NY', tz: 'America/New_York' },
  'OMA': { lat: 41.3032, lng: -95.8941, name: 'Omaha', state: 'NE', tz: 'America/Chicago' },
  'MEM': { lat: 35.0424, lng: -89.9767, name: 'Memphis', state: 'TN', tz: 'America/Chicago' },
  'RIC': { lat: 37.5052, lng: -77.3197, name: 'Richmond', state: 'VA', tz: 'America/New_York' },
  'ONT': { lat: 34.0560, lng: -117.6012, name: 'Ontario', state: 'CA', tz: 'America/Los_Angeles' },
  'BOI': { lat: 43.5644, lng: -116.2228, name: 'Boise', state: 'ID', tz: 'America/Boise' },
};

// Known routes for common flights (origin -> destination IATA codes)
const KNOWN_ROUTES = {
  'DAL843': { origin: 'ATL', dest: 'SAN' },
  'DAL123': { origin: 'ATL', dest: 'LAX' },
  'AAL1977': { origin: 'ATL', dest: 'PHX' },
  'AAL1403': { origin: 'CLT', dest: 'DFW' },
  'AAL1309': { origin: 'CLT', dest: 'DFW' },
  'SWA1724': { origin: 'AUS', dest: 'SAN' },
  'DAL484': { origin: 'ATL', dest: 'IAH' },
  'SWA1741': { origin: 'AUS', dest: 'SAN' },
  'AAL1716': { origin: 'CLT', dest: 'DFW' },
  'DAL399': { origin: 'ATL', dest: 'MSP' },
  'UAL1254': { origin: 'EWR', dest: 'DEN' },
  'SWA983': { origin: 'BNA', dest: 'DEN' },
};

/**
 * Convert IATA flight number (like "DL843") to ICAO callsign (like "DAL843")
 */
export function iataToIcaoCallsign(flightNumber) {
  const clean = flightNumber.toUpperCase().replace(/\s+/g, '');
  // Extract airline code (2 letters) and number
  const match = clean.match(/^([A-Z]{2})(\d+)$/);
  if (!match) return clean; // Already ICAO or unknown format
  const [, airline, num] = match;
  const icao = AIRLINE_MAP[airline];
  if (!icao) return clean;
  return icao + num;
}

// Track last known position so we can make tiny queries after the first one
let lastKnownLat = null;
let lastKnownLng = null;

/**
 * Fetch all current flights from OpenSky and find ours by callsign
 */
export async function fetchFlightPosition(flightNumber) {
  const callsign = iataToIcaoCallsign(flightNumber);
  const paddedCallsign = callsign.padEnd(8, ' ');

  try {
    // If we know where the plane is, query a tiny box around it (1 credit)
    // Otherwise query the full US (4 credits) for the initial lookup
    let queryUrl;
    if (lastKnownLat && lastKnownLng) {
      // 5-degree box around last known position = ~25 sq degrees = 1 credit
      const pad = 2.5;
      queryUrl = `${OPENSKY_BASE}/states/all?lamin=${lastKnownLat-pad}&lamax=${lastKnownLat+pad}&lomin=${lastKnownLng-pad}&lomax=${lastKnownLng+pad}`;
    } else {
      queryUrl = `${OPENSKY_BASE}/states/all?lamin=24&lamax=50&lomin=-130&lomax=-65`;
    }
    const data = await openskyFetch(queryUrl);
    if (!data || !data.states || data.states.length === 0) {
      return null;
    }

    // Find our flight by callsign match
    // OpenSky state vector indices:
    // 0: icao24, 1: callsign, 2: origin_country, 3: time_position,
    // 4: last_contact, 5: longitude, 6: latitude, 7: baro_altitude,
    // 8: on_ground, 9: velocity, 10: true_track, 11: vertical_rate,
    // 12: sensors, 13: geo_altitude, 14: squawk, 15: spi, 16: position_source
    const flight = data.states.find(s => {
      const cs = (s[1] || '').trim().toUpperCase();
      return cs === callsign || cs === paddedCallsign.trim();
    });

    if (!flight) return null;

    // Cache position for smaller subsequent queries
    if (flight[6] && flight[5]) {
      lastKnownLat = flight[6];
      lastKnownLng = flight[5];
    }

    // Route priority:
    // 1. Real route from OpenSky flights/aircraft (cached after first fetch)
    // 2. Heading-based guess from current position
    // 3. Static routes DB (least reliable -- flight numbers change routes daily)
    const cachedRealRoute = KNOWN_ROUTES['_real_' + callsign];
    const guessedRoute = guessRouteFromPosition(flight[6], flight[5], flight[10]);
    const staticRoute = routesDB[callsign] || KNOWN_ROUTES[callsign];
    const route = cachedRealRoute || guessedRoute || staticRoute;

    const result = {
      icao24: flight[0],
      callsign: (flight[1] || '').trim(),
      latitude: flight[6],
      longitude: flight[5],
      altitude: flight[7] ? Math.round(flight[7] * 3.28084) : null,
      onGround: flight[8],
      speed: flight[9] ? Math.round(flight[9] * 1.94384) : null,
      heading: flight[10],
      verticalRate: flight[11],
      origin: route?.origin || null,
      destination: route?.dest || null,
    };

    // Always try to get real route from flights/aircraft endpoint
    // This is the most accurate source -- actual ADS-B departure/arrival data
    if (!cachedRealRoute && flight[0]) {
      fetchRealRoute(flight[0]).then(realRoute => {
        if (realRoute) {
          result.origin = realRoute.origin;
          result.destination = realRoute.dest;
          KNOWN_ROUTES['_real_' + callsign] = realRoute;
        }
      }).catch(() => {});
    }

    return result;
  } catch (err) {
    console.error('OpenSky fetch error:', err);
    throw err;
  }
}

function guessRoute(callsign) {
  return KNOWN_ROUTES[callsign] || null;
}

/**
 * Fetch the real route for a flight using OpenSky's flights/aircraft endpoint.
 * This gives us estDepartureAirport and estArrivalAirport from actual ADS-B data.
 */
const routeCache = new Map();

async function fetchRealRoute(icao24) {
  if (routeCache.has(icao24)) return routeCache.get(icao24);

  try {
    const now = Math.floor(Date.now() / 1000);
    const begin = now - 43200; // 12 hours ago
    const url = `${OPENSKY_BASE}/flights/aircraft?icao24=${icao24}&begin=${begin}&end=${now}`;
    const flights = await openskyFetch(url);
    if (!flights || flights.length === 0) return null;

    // Find the CURRENT flight -- the one most recently seen and still in progress.
    // Sort by lastSeen descending, prefer flights without an arrival (still flying).
    // OpenSky returns flights where lastSeen is recent for in-progress flights.
    const sorted = [...flights].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));

    // The current flight is the one with the most recent lastSeen
    // that was seen within the last 10 minutes
    const currentFlight = sorted.find(f => {
      return f.estDepartureAirport && (now - (f.lastSeen || 0)) < 600;
    }) || sorted[0];

    if (!currentFlight || !currentFlight.estDepartureAirport) return null;

    const depIcao = currentFlight.estDepartureAirport;
    const arrIcao = currentFlight.estArrivalAirport;

    const origin = icaoAirportToIata(depIcao);
    const dest = arrIcao ? icaoAirportToIata(arrIcao) : null;

    if (origin) {
      const route = { origin, dest };
      routeCache.set(icao24, route);
      return route;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Convert ICAO airport code (KATL) to IATA (ATL).
 * US airports typically have K prefix, then the IATA code.
 */
function icaoAirportToIata(icaoCode) {
  if (!icaoCode) return null;
  // US airports: KATL -> ATL, KJFK -> JFK, etc.
  if (icaoCode.startsWith('K') && icaoCode.length === 4) {
    const iata = icaoCode.substring(1);
    // Check if we know this airport
    if (AIRPORTS[iata]) return iata;
  }
  // Some US airports don't follow K-prefix (PHNL = HNL)
  if (icaoCode.startsWith('PH') && icaoCode.length === 4) {
    const iata = icaoCode.substring(1);
    if (AIRPORTS[iata]) return iata;
  }
  // Try just stripping first char
  const stripped = icaoCode.substring(1);
  if (AIRPORTS[stripped]) return stripped;
  // Try the full code
  if (AIRPORTS[icaoCode]) return icaoCode;
  return icaoCode; // Return as-is, won't match AIRPORTS but at least shows something
}

/**
 * Calculate true bearing between two points using haversine-based formula.
 * Returns degrees 0-360 from north.
 */
function trueBearing(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const dLng = toRad(lng2 - lng1);
  const lat1R = toRad(lat1);
  const lat2R = toRad(lat2);
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/**
 * Guess origin and destination airports from position and heading.
 * Uses true bearing (accounts for Earth's curvature) and tight cones.
 */
export function guessRouteFromPosition(lat, lng, heading) {
  if (lat == null || lng == null || heading == null) return null;

  const airportList = Object.entries(AIRPORTS);
  const behind = [];
  const ahead = [];

  for (const [code, airport] of airportList) {
    const dLat = airport.lat - lat;
    const dLng = airport.lng - lng;
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    if (dist < 0.3) continue;

    // Use TRUE bearing (great circle) instead of simple atan2
    const bearing = trueBearing(lat, lng, airport.lat, airport.lng);

    // Angle difference between heading and bearing to airport
    let diff = bearing - heading;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    // Score: prefer airports that are well-aligned AND far away
    // (the destination is usually the farthest well-aligned airport, not the nearest)
    const anglePenalty = (Math.abs(diff) / 30); // 0 = perfect, 1 = 30deg off
    const score = anglePenalty * 3 + (1 / (dist + 0.1)); // Low angle penalty + prefer farther

    if (Math.abs(diff) < 30) {
      // Airport is ahead (tight 30-degree cone)
      ahead.push({ code, dist, angleDiff: Math.abs(diff), score });
    } else if (Math.abs(diff) > 150) {
      // Airport is behind (tight 30-degree cone from reverse heading)
      behind.push({ code, dist, angleDiff: Math.abs(diff), score });
    }
  }

  // For destination: pick the FARTHEST well-aligned airport (that's where the flight is going)
  // For origin: pick the NEAREST well-aligned airport behind (that's where it came from)
  ahead.sort((a, b) => {
    // First by angle (tighter = better), then by distance (farther = more likely destination)
    if (Math.abs(a.angleDiff - b.angleDiff) > 10) return a.angleDiff - b.angleDiff;
    return b.dist - a.dist; // Prefer farther for destination
  });
  behind.sort((a, b) => {
    if (Math.abs(a.angleDiff - b.angleDiff) > 10) return a.angleDiff - b.angleDiff;
    return a.dist - b.dist; // Prefer closer for origin
  });

  const origin = behind.length > 0 ? behind[0].code : null;
  const dest = ahead.length > 0 ? ahead[0].code : null;

  if (origin && dest && origin !== dest) {
    return { origin, dest };
  }
  return null;
}

/**
 * Simulated flight data for demo/testing when OpenSky is unavailable
 * Follows the ATL -> SAN route
 */
const ATL_SAN_WAYPOINTS = [
  { lat: 33.6407, lng: -84.4277 },  // ATL
  { lat: 33.45, lng: -86.80 },      // Birmingham area
  { lat: 33.20, lng: -89.50 },      // Mississippi
  { lat: 32.80, lng: -92.00 },      // Louisiana
  { lat: 32.50, lng: -94.50 },      // East Texas
  { lat: 32.20, lng: -97.00 },      // DFW area
  { lat: 32.00, lng: -100.00 },     // West Texas
  { lat: 31.80, lng: -103.50 },     // Far West Texas
  { lat: 32.00, lng: -106.50 },     // New Mexico
  { lat: 32.20, lng: -109.50 },     // Arizona border
  { lat: 32.50, lng: -112.00 },     // Arizona
  { lat: 32.70, lng: -115.00 },     // Imperial Valley
  { lat: 32.7338, lng: -117.1933 }, // SAN
];

let simIndex = 0;
let simStartTime = null;

export function getSimulatedPosition() {
  if (!simStartTime) simStartTime = Date.now();

  // REAL-TIME simulation: ATL->SAN is ~4 hours. Place the plane about 60% through
  // the route (over west Texas) and move at real speed (~0.13 degrees longitude per minute)
  const FLIGHT_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours in ms
  const START_PROGRESS = 0.55; // Start 55% through the flight (simulating mid-flight join)
  const elapsed = Date.now() - simStartTime;
  const realTimeProgress = START_PROGRESS + (elapsed / FLIGHT_DURATION_MS);
  const totalProgress = Math.min(realTimeProgress, 0.99);

  // Interpolate along the waypoints
  const waypointProgress = totalProgress * (ATL_SAN_WAYPOINTS.length - 1);
  const idx = Math.floor(waypointProgress);
  const frac = waypointProgress - idx;

  if (idx >= ATL_SAN_WAYPOINTS.length - 1) {
    const last = ATL_SAN_WAYPOINTS[ATL_SAN_WAYPOINTS.length - 1];
    return {
      callsign: 'DAL843',
      latitude: last.lat,
      longitude: last.lng,
      altitude: 35000,
      onGround: false,
      speed: 456,
      heading: 270,
      verticalRate: 0,
      origin: 'ATL',
      destination: 'SAN',
    };
  }

  const a = ATL_SAN_WAYPOINTS[idx];
  const b = ATL_SAN_WAYPOINTS[idx + 1];

  return {
    callsign: 'DAL843',
    latitude: a.lat + (b.lat - a.lat) * frac,
    longitude: a.lng + (b.lng - a.lng) * frac,
    altitude: 35000,
    onGround: false,
    speed: 456,
    heading: Math.round(Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180 / Math.PI + 360) % 360,
    verticalRate: 0,
    origin: 'ATL',
    destination: 'SAN',
  };
}

export function resetSimulation() {
  simStartTime = null;
  simIndex = 0;
}
