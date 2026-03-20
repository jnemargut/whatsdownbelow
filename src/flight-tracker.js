// OpenSky Network flight tracker with callsign-based lookup

import routesDB from './routes-db.js';

const OPENSKY_BASE = 'https://opensky-network.org/api';

// Common airline ICAO prefixes mapped from IATA codes
const AIRLINE_MAP = {
  'DL': 'DAL', 'AA': 'AAL', 'UA': 'UAL', 'WN': 'SWA',
  'B6': 'JBU', 'AS': 'ASA', 'NK': 'NKS', 'F9': 'FFT',
  'G4': 'AAY', 'HA': 'HAL', 'SY': 'SCX', 'MX': 'MXA',
};

// US Airport coordinates for route drawing
export const AIRPORTS = {
  'ATL': { lat: 33.6407, lng: -84.4277, name: 'Atlanta' },
  'SAN': { lat: 32.7338, lng: -117.1933, name: 'San Diego' },
  'LAX': { lat: 33.9425, lng: -118.4081, name: 'Los Angeles' },
  'JFK': { lat: 40.6413, lng: -73.7781, name: 'New York JFK' },
  'ORD': { lat: 41.9742, lng: -87.9073, name: 'Chicago O\'Hare' },
  'DFW': { lat: 32.8998, lng: -97.0403, name: 'Dallas/Fort Worth' },
  'DEN': { lat: 39.8561, lng: -104.6737, name: 'Denver' },
  'SFO': { lat: 37.6213, lng: -122.3790, name: 'San Francisco' },
  'SEA': { lat: 47.4502, lng: -122.3088, name: 'Seattle' },
  'MIA': { lat: 25.7959, lng: -80.2870, name: 'Miami' },
  'BOS': { lat: 42.3656, lng: -71.0096, name: 'Boston' },
  'MSP': { lat: 44.8848, lng: -93.2223, name: 'Minneapolis' },
  'DTW': { lat: 42.2162, lng: -83.3554, name: 'Detroit' },
  'PHX': { lat: 33.4373, lng: -112.0078, name: 'Phoenix' },
  'IAH': { lat: 29.9902, lng: -95.3368, name: 'Houston' },
  'EWR': { lat: 40.6895, lng: -74.1745, name: 'Newark' },
  'CLT': { lat: 35.2140, lng: -80.9431, name: 'Charlotte' },
  'LAS': { lat: 36.0840, lng: -115.1537, name: 'Las Vegas' },
  'MCO': { lat: 28.4312, lng: -81.3081, name: 'Orlando' },
  'MSY': { lat: 29.9934, lng: -90.2580, name: 'New Orleans' },
  'AUS': { lat: 30.1975, lng: -97.6664, name: 'Austin' },
  'BNA': { lat: 36.1263, lng: -86.6774, name: 'Nashville' },
  'ABQ': { lat: 35.0402, lng: -106.6090, name: 'Albuquerque' },
  'TUS': { lat: 32.1161, lng: -110.9410, name: 'Tucson' },
  'ELP': { lat: 31.8072, lng: -106.3770, name: 'El Paso' },
  'BHM': { lat: 33.5629, lng: -86.7535, name: 'Birmingham' },
  'JAN': { lat: 32.3112, lng: -90.0759, name: 'Jackson MS' },
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
 * Finds the nearest major airport behind the plane (origin) and
 * the nearest major airport ahead of the plane (destination).
 */
export function guessRouteFromPosition(lat, lng, heading) {
  if (lat == null || lng == null || heading == null) return null;

  const airportList = Object.entries(AIRPORTS);
  const behind = []; // airports roughly behind the plane
  const ahead = [];  // airports roughly ahead of the plane

  for (const [code, airport] of airportList) {
    const dLat = airport.lat - lat;
    const dLng = airport.lng - lng;
    const dist = Math.sqrt(dLat * dLat + dLng * dLng); // rough distance in degrees
    if (dist < 0.5) continue; // skip airports we're right on top of

    // Bearing from plane to airport
    const bearingToAirport = (Math.atan2(dLng, dLat) * 180 / Math.PI + 360) % 360;

    // Angle difference between heading and bearing to this airport
    let diff = bearingToAirport - heading;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    if (Math.abs(diff) < 70) {
      // Airport is roughly ahead
      ahead.push({ code, dist, angleDiff: Math.abs(diff) });
    } else if (Math.abs(diff) > 110) {
      // Airport is roughly behind
      behind.push({ code, dist, angleDiff: Math.abs(diff) });
    }
  }

  // Sort by distance, pick closest
  behind.sort((a, b) => a.dist - b.dist);
  ahead.sort((a, b) => a.dist - b.dist);

  const origin = behind.length > 0 ? behind[0].code : null;
  const dest = ahead.length > 0 ? ahead[0].code : null;

  if (origin && dest) {
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
