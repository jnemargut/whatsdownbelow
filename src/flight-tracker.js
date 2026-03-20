// OpenSky Network flight tracker with callsign-based lookup

import routesDB from './routes-db.js';

const OPENSKY_BASE = 'https://opensky-network.org/api';

// Common airline ICAO prefixes mapped from IATA codes
const AIRLINE_MAP = {
  'DL': 'DAL', 'AA': 'AAL', 'UA': 'UAL', 'WN': 'SWA',
  'B6': 'JBU', 'AS': 'ASA', 'NK': 'NKS', 'F9': 'FFT',
  'G4': 'AAY', 'HA': 'HAL', 'SY': 'SCX', 'MX': 'MXA',
};

// US Airport coordinates for route drawing -- top 50 busiest US airports
export const AIRPORTS = {
  'ATL': { lat: 33.6407, lng: -84.4277, name: 'Atlanta', state: 'GA' },
  'LAX': { lat: 33.9425, lng: -118.4081, name: 'Los Angeles', state: 'CA' },
  'ORD': { lat: 41.9742, lng: -87.9073, name: 'Chicago', state: 'IL' },
  'DFW': { lat: 32.8998, lng: -97.0403, name: 'Dallas', state: 'TX' },
  'DEN': { lat: 39.8561, lng: -104.6737, name: 'Denver', state: 'CO' },
  'JFK': { lat: 40.6413, lng: -73.7781, name: 'New York', state: 'NY' },
  'SFO': { lat: 37.6213, lng: -122.3790, name: 'San Francisco', state: 'CA' },
  'SEA': { lat: 47.4502, lng: -122.3088, name: 'Seattle', state: 'WA' },
  'LAS': { lat: 36.0840, lng: -115.1537, name: 'Las Vegas', state: 'NV' },
  'MCO': { lat: 28.4312, lng: -81.3081, name: 'Orlando', state: 'FL' },
  'EWR': { lat: 40.6895, lng: -74.1745, name: 'Newark', state: 'NJ' },
  'MIA': { lat: 25.7959, lng: -80.2870, name: 'Miami', state: 'FL' },
  'PHX': { lat: 33.4373, lng: -112.0078, name: 'Phoenix', state: 'AZ' },
  'IAH': { lat: 29.9902, lng: -95.3368, name: 'Houston', state: 'TX' },
  'BOS': { lat: 42.3656, lng: -71.0096, name: 'Boston', state: 'MA' },
  'MSP': { lat: 44.8848, lng: -93.2223, name: 'Minneapolis', state: 'MN' },
  'FLL': { lat: 26.0726, lng: -80.1527, name: 'Fort Lauderdale', state: 'FL' },
  'DTW': { lat: 42.2162, lng: -83.3554, name: 'Detroit', state: 'MI' },
  'CLT': { lat: 35.2140, lng: -80.9431, name: 'Charlotte', state: 'NC' },
  'LGA': { lat: 40.7772, lng: -73.8726, name: 'New York LaGuardia', state: 'NY' },
  'PHL': { lat: 39.8721, lng: -75.2411, name: 'Philadelphia', state: 'PA' },
  'SLC': { lat: 40.7884, lng: -111.9778, name: 'Salt Lake City', state: 'UT' },
  'DCA': { lat: 38.8512, lng: -77.0402, name: 'Washington DC', state: 'DC' },
  'SAN': { lat: 32.7338, lng: -117.1933, name: 'San Diego', state: 'CA' },
  'IAD': { lat: 38.9531, lng: -77.4565, name: 'Washington Dulles', state: 'VA' },
  'TPA': { lat: 27.9755, lng: -82.5332, name: 'Tampa', state: 'FL' },
  'BNA': { lat: 36.1263, lng: -86.6774, name: 'Nashville', state: 'TN' },
  'AUS': { lat: 30.1975, lng: -97.6664, name: 'Austin', state: 'TX' },
  'PDX': { lat: 45.5898, lng: -122.5951, name: 'Portland', state: 'OR' },
  'STL': { lat: 38.7487, lng: -90.3700, name: 'St. Louis', state: 'MO' },
  'MSY': { lat: 29.9934, lng: -90.2580, name: 'New Orleans', state: 'LA' },
  'HNL': { lat: 21.3245, lng: -157.9251, name: 'Honolulu', state: 'HI' },
  'OAK': { lat: 37.7213, lng: -122.2208, name: 'Oakland', state: 'CA' },
  'SAT': { lat: 29.5337, lng: -98.4698, name: 'San Antonio', state: 'TX' },
  'RDU': { lat: 35.8776, lng: -78.7875, name: 'Raleigh', state: 'NC' },
  'SJC': { lat: 37.3626, lng: -121.9291, name: 'San Jose', state: 'CA' },
  'DAL': { lat: 32.8471, lng: -96.8518, name: 'Dallas Love', state: 'TX' },
  'MDW': { lat: 41.7868, lng: -87.7524, name: 'Chicago Midway', state: 'IL' },
  'IND': { lat: 39.7173, lng: -86.2944, name: 'Indianapolis', state: 'IN' },
  'CLE': { lat: 41.4117, lng: -81.8498, name: 'Cleveland', state: 'OH' },
  'PIT': { lat: 40.4915, lng: -80.2329, name: 'Pittsburgh', state: 'PA' },
  'CMH': { lat: 39.9980, lng: -82.8919, name: 'Columbus', state: 'OH' },
  'ABQ': { lat: 35.0402, lng: -106.6090, name: 'Albuquerque', state: 'NM' },
  'BHM': { lat: 33.5629, lng: -86.7535, name: 'Birmingham', state: 'AL' },
  'JAX': { lat: 30.4941, lng: -81.6879, name: 'Jacksonville', state: 'FL' },
  'MKE': { lat: 42.9472, lng: -87.8966, name: 'Milwaukee', state: 'WI' },
  'RNO': { lat: 39.4991, lng: -119.7681, name: 'Reno', state: 'NV' },
  'TUS': { lat: 32.1161, lng: -110.9410, name: 'Tucson', state: 'AZ' },
  'ELP': { lat: 31.8072, lng: -106.3770, name: 'El Paso', state: 'TX' },
  'JAN': { lat: 32.3112, lng: -90.0759, name: 'Jackson', state: 'MS' },
  'BWI': { lat: 39.1754, lng: -76.6683, name: 'Baltimore', state: 'MD' },
  'MCI': { lat: 39.2976, lng: -94.7139, name: 'Kansas City', state: 'MO' },
  'SMF': { lat: 38.6954, lng: -121.5908, name: 'Sacramento', state: 'CA' },
  'RSW': { lat: 26.5362, lng: -81.7552, name: 'Fort Myers', state: 'FL' },
  'BUF': { lat: 42.9405, lng: -78.7322, name: 'Buffalo', state: 'NY' },
  'OMA': { lat: 41.3032, lng: -95.8941, name: 'Omaha', state: 'NE' },
  'MEM': { lat: 35.0424, lng: -89.9767, name: 'Memphis', state: 'TN' },
  'RIC': { lat: 37.5052, lng: -77.3197, name: 'Richmond', state: 'VA' },
  'ONT': { lat: 34.0560, lng: -117.6012, name: 'Ontario', state: 'CA' },
  'BOI': { lat: 43.5644, lng: -116.2228, name: 'Boise', state: 'ID' },
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

/**
 * Fetch all current flights from OpenSky and find ours by callsign
 */
export async function fetchFlightPosition(flightNumber) {
  const callsign = iataToIcaoCallsign(flightNumber);
  const paddedCallsign = callsign.padEnd(8, ' ');

  try {
    // OpenSky allows filtering by callsign via the states/all endpoint
    const url = `${OPENSKY_BASE}/states/all`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`OpenSky API returned ${response.status}`);
    }

    const data = await response.json();
    if (!data.states || data.states.length === 0) {
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

    // Use heading-based guess first (it uses the actual plane position/direction),
    // fall back to known routes DB for well-known flights
    const route = guessRouteFromPosition(flight[6], flight[5], flight[10])
      || routesDB[callsign]
      || KNOWN_ROUTES[callsign];

    return {
      icao24: flight[0],
      callsign: (flight[1] || '').trim(),
      latitude: flight[6],
      longitude: flight[5],
      altitude: flight[7] ? Math.round(flight[7] * 3.28084) : null, // meters to feet
      onGround: flight[8],
      speed: flight[9] ? Math.round(flight[9] * 1.94384) : null, // m/s to knots
      heading: flight[10],
      verticalRate: flight[11],
      origin: route?.origin || null,
      destination: route?.dest || null,
    };
  } catch (err) {
    console.error('OpenSky fetch error:', err);
    throw err;
  }
}

function guessRoute(callsign) {
  return KNOWN_ROUTES[callsign] || null;
}

/**
 * Guess origin and destination airports from position and heading.
 * Scores airports by how well they align with the flight path
 * (combination of angle alignment and distance).
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
    if (dist < 0.3) continue; // skip airports right underneath

    // Bearing from plane to airport
    const bearingToAirport = (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;

    // Angle difference between heading and bearing to airport
    let diff = bearingToAirport - heading;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    // Score: lower is better. Penalize being off-axis heavily.
    // A perfectly aligned airport at moderate distance beats a close but off-axis one.
    const angleWeight = Math.abs(diff) / 45; // 0 = perfect alignment, 1 = 45deg off
    const score = dist * (1 + angleWeight * 2);

    if (Math.abs(diff) < 45) {
      // Airport is ahead (within 45 degrees of heading)
      ahead.push({ code, dist, angleDiff: Math.abs(diff), score });
    } else if (Math.abs(diff) > 135) {
      // Airport is behind (within 45 degrees of opposite heading)
      behind.push({ code, dist, angleDiff: Math.abs(diff), score });
    }
  }

  // Sort by score (best match first)
  behind.sort((a, b) => a.score - b.score);
  ahead.sort((a, b) => a.score - b.score);

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
