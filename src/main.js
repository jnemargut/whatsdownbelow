import mapboxgl from 'mapbox-gl';
import { fetchFlightPosition, getSimulatedPosition, resetSimulation, AIRPORTS, iataToIcaoCallsign, openskyFetch, guessRouteFromPosition } from './flight-tracker.js';
import { findNearbyFacts, greatCircleArc, distanceMiles } from './geo-utils.js';
import factsDB from './facts-db.js';
import routesDB from './routes-db.js';

// --- CONFIG ---
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';
const POLL_INTERVAL = 15000; // 15 seconds -- authenticated via Cloudflare proxy (4000 credits/day)
const FACT_MIN_INTERVAL = 8000; // Show facts more frequently
const FACT_RADIUS_MILES = 80; // Wider radius to catch more facts
const POSTCARD_DISPLAY_TIME = 10000; // Show postcard for 10 seconds
const USE_SIMULATION = true; // Toggle to use simulated flight data

// --- STATE ---
let map = null;
let planeMarker = null;
let flightNumber = '';
let currentPosition = null;
let shownFactIds = new Set();
let factMarkers = [];
let lastFactTime = 0;
let postcardTimeout = null;
let currentFact = null;
let pollTimer = null;
let pinCount = 0;
let useSimulation = USE_SIMULATION;

// --- DOM REFS ---
const inputScreen = document.getElementById('input-screen');
const mapScreen = document.getElementById('map-screen');
const flightInput = document.getElementById('flight-input');
const trackBtn = document.getElementById('track-btn');
const inputError = document.getElementById('input-error');
const postcardContainer = document.getElementById('postcard-container');
const pinCounter = document.getElementById('pin-counter');
const pinCountEl = document.getElementById('pin-count');

// --- INIT ---
flightInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startTracking();
});
trackBtn.addEventListener('click', startTracking);

// Flight chip clicks
document.getElementById('suggested-flights').addEventListener('click', (e) => {
  const chip = e.target.closest('.flight-chip');
  if (chip) {
    flightInput.value = chip.dataset.flight;
    startTracking();
  }
});

// Fetch live flights for suggestions
// Randomize placeholder
const placeholders = ['e.g. AA100', 'e.g. DL401', 'e.g. UA1', 'e.g. WN1724', 'e.g. B6123', 'e.g. AS558'];
flightInput.placeholder = placeholders[Math.floor(Math.random() * placeholders.length)];

fetchLiveFlightSuggestions();

// Postcard click to expand
document.getElementById('postcard').addEventListener('click', (e) => {
  // Don't expand if clicking the close button
  if (e.target.id === 'postcard-close-btn') return;
  if (currentFact) showExpandedPostcard(currentFact);
});

// Close button on mini postcard
document.getElementById('postcard-close-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  postcardContainer.classList.remove('visible');
  if (postcardTimeout) clearTimeout(postcardTimeout);
});

// Expanded close
document.getElementById('expanded-close').addEventListener('click', hideExpandedPostcard);
document.getElementById('postcard-expanded').addEventListener('click', (e) => {
  if (e.target.id === 'postcard-expanded') hideExpandedPostcard();
});

// Tap map to dismiss postcard
document.getElementById('map').addEventListener('click', (e) => {
  // Don't dismiss if clicking a pin (pin clicks are handled separately with stopPropagation)
  if (postcardContainer.classList.contains('visible')) {
    postcardContainer.classList.remove('visible');
    if (postcardTimeout) clearTimeout(postcardTimeout);
  }
});

// Stats panel toggle
document.querySelector('.flight-bar-inner').addEventListener('click', () => {
  const panel = document.getElementById('stats-panel');
  panel.classList.toggle('visible');
});

document.getElementById('stats-panel').addEventListener('click', (e) => {
  if (e.target.id === 'stats-panel') {
    e.target.classList.remove('visible');
  }
});

// --- START TRACKING ---
async function startTracking() {
  const value = flightInput.value.trim().toUpperCase();
  if (!value) {
    inputError.textContent = 'Enter a flight number like DL843';
    return;
  }

  flightNumber = value;
  trackBtn.textContent = 'Looking up...';
  trackBtn.classList.add('loading');
  inputError.textContent = '';

  try {
    // Try real API
    let position = null;
    let apiError = null;
    try {
      position = await fetchFlightPosition(flightNumber);
    } catch (e) {
      apiError = e;
      console.warn('OpenSky error:', e.message);
    }

    if (position && position.latitude) {
      useSimulation = false;
      currentPosition = position;
    } else {
      // Distinguish between "flight not found" and "API unavailable"
      const isRateLimited = apiError && apiError.message && apiError.message.includes('Rate limited');
      if (isRateLimited) {
        inputError.textContent = 'Flight data temporarily unavailable (daily limit reached, resets at midnight UTC). Try again later.';
      } else if (apiError) {
        inputError.textContent = `Could not reach flight data service. Check your connection and try again.`;
      } else {
        inputError.textContent = `Could not find flight ${flightNumber}. Make sure it's currently in the air right now.`;
      }
      trackBtn.textContent = "Let's Fly";
      trackBtn.classList.remove('loading');
      return;
    }

    // Transition to map
    inputScreen.classList.add('leaving');
    setTimeout(() => {
      inputScreen.classList.remove('active');
      mapScreen.classList.add('active');
      initMap();
    }, 600);

  } catch (err) {
    inputError.textContent = `Something went wrong. Try again or use DL843 for a demo.`;
    trackBtn.textContent = "Let's Fly";
    trackBtn.classList.remove('loading');
  }
}

// --- MAP INIT ---
function initMap() {
  mapboxgl.accessToken = MAPBOX_TOKEN;

  const origin = AIRPORTS[currentPosition.origin] || { lat: currentPosition.latitude, lng: currentPosition.longitude };
  const dest = AIRPORTS[currentPosition.destination] || { lat: currentPosition.latitude, lng: currentPosition.longitude };

  map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/outdoors-v12',
    center: [currentPosition.longitude, currentPosition.latitude],
    zoom: 8.2, // Zoomed in close -- see the landscape details
    pitch: 40,
    bearing: 0, // North up -- traditional US map view
    antialias: true,
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');

  map.on('load', () => {
    // Enable 3D terrain
    map.addSource('mapbox-dem', {
      type: 'raster-dem',
      url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512,
      maxzoom: 14,
    });
    map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });

    // Add sky atmosphere
    map.addLayer({
      id: 'sky',
      type: 'sky',
      paint: {
        'sky-type': 'atmosphere',
        'sky-atmosphere-sun': [0.0, 90.0],
        'sky-atmosphere-sun-intensity': 15,
      },
    });

    // --- RETRO ROADSIDE MAP STYLING ---
    // Style existing layers for a warm retro feel
    const style = map.getStyle();
    style.layers.forEach(layer => {
      try {
        // Warm up land/background
        if (layer.id === 'land' || layer.id === 'background') {
          map.setPaintProperty(layer.id, layer.type === 'background' ? 'background-color' : 'fill-color', '#f0e8d0');
        }
        // Warm vintage water
        if (layer.id.includes('water') && layer.type === 'fill') {
          map.setPaintProperty(layer.id, 'fill-color', '#9bc4d4');
        }
        // Warm parks/green areas
        if ((layer.id.includes('park') || layer.id.includes('national')) && layer.type === 'fill') {
          map.setPaintProperty(layer.id, 'fill-color', '#c8d8a0');
          map.setPaintProperty(layer.id, 'fill-opacity', 0.6);
        }
        // Make existing admin borders much bolder
        if (layer.id.includes('admin') && layer.type === 'line') {
          if (layer.id.includes('1') || layer.id.includes('state')) {
            map.setPaintProperty(layer.id, 'line-color', '#bc6c25');
            map.setPaintProperty(layer.id, 'line-width', 2.5);
            map.setPaintProperty(layer.id, 'line-opacity', 0.8);
          } else if (layer.id.includes('0') || layer.id.includes('country')) {
            map.setPaintProperty(layer.id, 'line-color', '#283618');
            map.setPaintProperty(layer.id, 'line-width', 3);
            map.setPaintProperty(layer.id, 'line-opacity', 0.9);
          }
        }
        // Tone down road colors -- muted grey-tan so they don't compete with state borders
        if (layer.id.includes('road') && layer.type === 'line') {
          map.setPaintProperty(layer.id, 'line-color', '#c4b99a');
          map.setPaintProperty(layer.id, 'line-opacity', 0.5);
        }
      } catch(e) { /* layer might not support the property */ }
    });

    // Add explicit state borders using the composite source (already in outdoors-v12)
    // The outdoors style uses source 'composite' with source-layer 'admin'
    try {
      map.addLayer({
        id: 'state-borders-custom',
        type: 'line',
        source: 'composite',
        'source-layer': 'admin',
        filter: ['all',
          ['==', ['get', 'admin_level'], 1],
          ['==', ['get', 'maritime'], 0],
        ],
        paint: {
          'line-color': '#5c3d1a',
          'line-width': 2.5,
          'line-opacity': 0.8,
        },
      });
    } catch(e) {
      console.warn('Could not add state borders:', e.message);
    }

    // Draw flight path (two layers: solid for traveled, dashed for remaining)
    // Use known airports if available, otherwise use plane position as fallback
    const hasOrigin = currentPosition.origin && AIRPORTS[currentPosition.origin];
    const hasDest = currentPosition.destination && AIRPORTS[currentPosition.destination];
    {
      // Fallback: if no origin, use the plane's current position as both start and current
      const effectiveOrigin = hasOrigin ? origin : { lat: currentPosition.latitude, lng: currentPosition.longitude };
      const effectiveDest = hasDest ? dest : null;
      // Always draw the traveled path (origin to current position)
      const traveledCoords = greatCircleArc(
        effectiveOrigin.lat, effectiveOrigin.lng,
        currentPosition.latitude, currentPosition.longitude,
        50
      );

      // Only draw remaining path if we know the destination
      const remainingCoords = effectiveDest
        ? greatCircleArc(
            currentPosition.latitude, currentPosition.longitude,
            effectiveDest.lat, effectiveDest.lng,
            50
          )
        : [[currentPosition.longitude, currentPosition.latitude]];

      // Remaining path -- dashed, lighter
      map.addSource('flight-path-remaining', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: remainingCoords,
          },
        },
      });

      // Remaining path -- white dashed, very visible against map
      map.addLayer({
        id: 'flight-path-remaining-line',
        type: 'line',
        source: 'flight-path-remaining',
        paint: {
          'line-color': '#ffffff',
          'line-width': 3,
          'line-dasharray': [6, 4],
          'line-opacity': 0.8,
        },
      });

      // Remaining path shadow for contrast
      map.addLayer({
        id: 'flight-path-remaining-shadow',
        type: 'line',
        source: 'flight-path-remaining',
        paint: {
          'line-color': '#283618',
          'line-width': 5,
          'line-dasharray': [6, 4],
          'line-opacity': 0.2,
        },
      }, 'flight-path-remaining-line');

      // Traveled path -- deep red/maroon, solid, bold
      map.addSource('flight-path-traveled', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: traveledCoords,
          },
        },
      });

      map.addLayer({
        id: 'flight-path-traveled-line',
        type: 'line',
        source: 'flight-path-traveled',
        paint: {
          'line-color': '#9f1239',
          'line-width': 4,
          'line-opacity': 0.85,
        },
      });
    }

    // Add plane marker
    addPlaneMarker();

    // Update flight bar
    updateFlightBar();

    // Pre-populate pins along the entire route
    prePopulateRouteFacts();

    // Start polling
    startPolling();

    // Show the first nearby fact after a short delay
    setTimeout(() => checkForFacts(), 3000);
  });
}

// --- PLANE MARKER ---
function addPlaneMarker() {
  const el = document.createElement('div');
  el.className = 'plane-marker';
  // Clean plane icon SVG -- points UP (nose at top)
  el.innerHTML = `
    <svg viewBox="0 0 64 64" width="42" height="42" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="plane-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="#283618" flood-opacity="0.4"/>
        </filter>
      </defs>
      <g filter="url(#plane-shadow)">
        <!-- Body -->
        <path d="M32 6 C30 6 28 8 28 12 L28 24 L12 34 L12 38 L28 32 L28 44 L22 48 L22 52 L32 49 L42 52 L42 48 L36 44 L36 32 L52 38 L52 34 L36 24 L36 12 C36 8 34 6 32 6Z" fill="#bc6c25" stroke="#fefae0" stroke-width="1.5" stroke-linejoin="round"/>
        <!-- Window -->
        <ellipse cx="32" cy="14" rx="2.5" ry="3" fill="#fefae0" opacity="0.8"/>
        <!-- Wing stripe left -->
        <line x1="14" y1="35.5" x2="28" y2="30" stroke="#283618" stroke-width="1" opacity="0.3"/>
        <!-- Wing stripe right -->
        <line x1="50" y1="35.5" x2="36" y2="30" stroke="#283618" stroke-width="1" opacity="0.3"/>
      </g>
    </svg>
  `;

  const heading = currentPosition.heading || 270;

  planeMarker = new mapboxgl.Marker({ element: el, anchor: 'center', rotation: heading, rotationAlignment: 'map' })
    .setLngLat([currentPosition.longitude, currentPosition.latitude])
    .addTo(map);
}

function updatePlanePosition(pos) {
  if (!planeMarker || !pos.latitude || !pos.longitude) return;

  planeMarker.setLngLat([pos.longitude, pos.latitude]);

  if (pos.heading != null) {
    planeMarker.setRotation(pos.heading);
  }

  // Update traveled path line
  updateTraveledPath(pos);

  // Smooth camera follow -- keep north up
  map.easeTo({
    center: [pos.longitude, pos.latitude],
    duration: POLL_INTERVAL * 0.8,
    easing: (t) => t,
  });
}

function updateTraveledPath(pos) {
  const originAirport = AIRPORTS[pos.origin || currentPosition.origin];
  const destAirport = AIRPORTS[pos.destination || currentPosition.destination];
  if (!originAirport || !destAirport || !map) return;

  // Update traveled line
  const traveledSource = map.getSource('flight-path-traveled');
  if (traveledSource) {
    const traveledCoords = greatCircleArc(
      originAirport.lat, originAirport.lng,
      pos.latitude, pos.longitude,
      50
    );
    traveledSource.setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: traveledCoords },
    });
  }

  // Update remaining line
  const remainingSource = map.getSource('flight-path-remaining');
  if (remainingSource) {
    const remainingCoords = greatCircleArc(
      pos.latitude, pos.longitude,
      destAirport.lat, destAirport.lng,
      50
    );
    remainingSource.setData({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: remainingCoords },
    });
  }
}

// --- FLIGHT BAR ---
function updateFlightBar() {
  document.getElementById('flight-id').textContent = flightNumber.toUpperCase();
  const originAp = AIRPORTS[currentPosition.origin];
  const destAp = AIRPORTS[currentPosition.destination];
  document.getElementById('flight-origin').textContent = originAp
    ? `${originAp.name}, ${originAp.state} (${currentPosition.origin})` : (currentPosition.origin || '???');
  document.getElementById('flight-dest').textContent = destAp
    ? `${destAp.name}, ${destAp.state} (${currentPosition.destination})` : (currentPosition.destination || '???');
  document.getElementById('flight-alt').textContent = currentPosition.altitude
    ? `${currentPosition.altitude.toLocaleString()} ft`
    : '-- ft';
  document.getElementById('flight-speed').textContent = currentPosition.speed
    ? `${currentPosition.speed} kts`
    : '-- kts';

  // Calculate progress and ETA
  updateFlightProgress();
}

function updateFlightProgress() {
  const originAirport = AIRPORTS[currentPosition.origin];
  const destAirport = AIRPORTS[currentPosition.destination];
  if (!originAirport || !destAirport || !currentPosition.latitude) return;

  const totalDist = distanceMiles(originAirport.lat, originAirport.lng, destAirport.lat, destAirport.lng);
  const flownDist = distanceMiles(originAirport.lat, originAirport.lng, currentPosition.latitude, currentPosition.longitude);
  const remainingDist = distanceMiles(currentPosition.latitude, currentPosition.longitude, destAirport.lat, destAirport.lng);
  const progress = Math.min(Math.max(flownDist / totalDist, 0), 1);

  // Determine if flight is heading west (destination longitude < origin longitude)
  const isWestbound = destAirport.lng < originAirport.lng;
  const progressBar = document.querySelector('.flight-progress');
  if (isWestbound) {
    progressBar.classList.add('westbound');
  } else {
    progressBar.classList.remove('westbound');
  }

  // Update progress bar -- use gradient on track for clean fill
  const pct = Math.round(progress * 100);
  const track = document.querySelector('.progress-track');

  if (isWestbound) {
    // Westbound: fill from RIGHT. Plane position is still left-based but bar is reversed.
    track.style.background = `linear-gradient(to left, #bc6c25 ${pct}%, #606c38 ${pct}%)`;
    document.getElementById('progress-plane').style.left = (100 - pct) + '%';
  } else {
    // Eastbound: fill from LEFT (normal)
    track.style.background = `linear-gradient(to right, #bc6c25 ${pct}%, #606c38 ${pct}%)`;
    document.getElementById('progress-plane').style.left = pct + '%';
  }

  // Estimate times based on speed
  const speedMph = currentPosition.speed ? currentPosition.speed * 1.15078 : 500; // knots to mph, default 500mph
  const remainingHours = remainingDist / speedMph;
  const remainingMin = Math.round(remainingHours * 60);

  // ETA
  const now = new Date();
  const eta = new Date(now.getTime() + remainingMin * 60000);

  // Estimate departure time
  const elapsedHours = flownDist / speedMph;
  const elapsedMin = Math.round(elapsedHours * 60);
  const departTime = new Date(now.getTime() - elapsedMin * 60000);

  // Format times in each airport's local timezone
  const originTz = originAirport.tz || undefined;
  const destTz = destAirport.tz || undefined;
  const tzShort = (tz) => {
    try {
      return new Date().toLocaleTimeString('en-US', { timeZone: tz, timeZoneName: 'short' }).split(' ').pop();
    } catch { return ''; }
  };

  const departStr = departTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: originTz });
  const departTzLabel = originTz ? ' ' + tzShort(originTz) : '';
  const etaStr = eta.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: destTz });
  const etaTzLabel = destTz ? ' ' + tzShort(destTz) : '';

  document.getElementById('flight-eta').textContent = `ETA ${etaStr}`;
  document.getElementById('progress-depart').textContent = departStr + departTzLabel;
  document.getElementById('progress-arrive').textContent = etaStr + etaTzLabel;

  // Remaining time as a stat
  if (remainingMin > 60) {
    const h = Math.floor(remainingMin / 60);
    const m = remainingMin % 60;
    document.getElementById('flight-eta').textContent = `${h}h ${m}m left`;
  } else {
    document.getElementById('flight-eta').textContent = `${remainingMin}m left`;
  }

  // Update expanded stats panel
  document.getElementById('stat-altitude').textContent = currentPosition.altitude
    ? `${currentPosition.altitude.toLocaleString()} ft` : '--';
  document.getElementById('stat-speed').textContent = currentPosition.speed
    ? `${currentPosition.speed} kts (${Math.round(currentPosition.speed * 1.15078)} mph)` : '--';
  document.getElementById('stat-flown').textContent = `${Math.round(flownDist)} mi`;
  document.getElementById('stat-remaining').textContent = `${Math.round(remainingDist)} mi`;
  document.getElementById('stat-departed').textContent = departStr + departTzLabel;
  document.getElementById('stat-arrival').textContent = etaStr + etaTzLabel;
  document.getElementById('stat-heading').textContent = currentPosition.heading
    ? `${Math.round(currentPosition.heading)}deg ${headingToCardinal(currentPosition.heading)}` : '--';
  document.getElementById('stat-position').textContent =
    `${Math.abs(currentPosition.latitude).toFixed(2)}deg${currentPosition.latitude >= 0 ? 'N' : 'S'}, ${Math.abs(currentPosition.longitude).toFixed(2)}deg${currentPosition.longitude >= 0 ? 'E' : 'W'}`;
}

function headingToCardinal(heading) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(heading / 22.5) % 16];
}

// --- POLLING ---
function startPolling() {
  pollTimer = setInterval(async () => {
    try {
      let pos;
      if (useSimulation) {
        pos = getSimulatedPosition();
      } else {
        pos = await fetchFlightPosition(flightNumber);
        if (!pos || !pos.latitude) {
          console.warn('No position data, skipping update');
          return;
        }
      }
      // Check if route info improved (async OpenSky lookup may have completed)
      if (pos.origin && pos.destination &&
          (!currentPosition.origin || !currentPosition.destination ||
           currentPosition.origin !== pos.origin || currentPosition.destination !== pos.destination)) {
        currentPosition = pos;
        updateFlightBar();
        // Redraw flight path with correct route
        updateTraveledPath(pos);
        prePopulateRouteFacts();
      } else {
        if (pos.origin) currentPosition.origin = pos.origin;
        if (pos.destination) currentPosition.destination = pos.destination;
        currentPosition.latitude = pos.latitude;
        currentPosition.longitude = pos.longitude;
        currentPosition.altitude = pos.altitude;
        currentPosition.speed = pos.speed;
        currentPosition.heading = pos.heading;
      }
      updatePlanePosition(currentPosition);
      updateFlightBar();
      checkForFacts();
    } catch (err) {
      console.warn('Poll error:', err);
    }
  }, POLL_INTERVAL);
}

// --- PRE-POPULATE FACTS ALREADY PASSED ---
function prePopulateRouteFacts() {
  if (!currentPosition.origin || !currentPosition.destination) return;
  const originAirport = AIRPORTS[currentPosition.origin];
  const destAirport = AIRPORTS[currentPosition.destination];
  if (!originAirport || !destAirport) return;

  // Only show facts between origin and current position (already flown over)
  const numSamples = 30;
  const totalDist = distanceMiles(originAirport.lat, originAirport.lng, destAirport.lat, destAirport.lng);
  const flownDist = distanceMiles(originAirport.lat, originAirport.lng, currentPosition.latitude, currentPosition.longitude);
  const progress = Math.min(flownDist / totalDist, 1);

  const passedFacts = new Set();
  for (let i = 0; i <= numSamples; i++) {
    const f = (i / numSamples) * progress; // Only up to current position
    const lat = originAirport.lat + (destAirport.lat - originAirport.lat) * f;
    const lng = originAirport.lng + (destAirport.lng - originAirport.lng) * f;
    const nearby = findNearbyFacts(factsDB, lat, lng, FACT_RADIUS_MILES);
    nearby.forEach(fact => passedFacts.add(fact.id));
  }

  // Add pins for already-passed facts (staggered cascade)
  const passedFactArray = factsDB.filter(f => passedFacts.has(f.id));
  passedFactArray.forEach((fact, i) => {
    setTimeout(() => {
      if (!shownFactIds.has(fact.id)) {
        shownFactIds.add(fact.id);
        addFactPin(fact);
        pinCount++;
        pinCountEl.textContent = pinCount;
      }
    }, i * 100);
  });

  if (passedFactArray.length > 0) {
    setTimeout(() => {
      pinCounter.classList.add('bump');
      setTimeout(() => pinCounter.classList.remove('bump'), 300);
    }, passedFactArray.length * 100 + 100);
  }
}

// --- FACT DISCOVERY ---
function checkForFacts() {
  if (!currentPosition || !currentPosition.latitude) return;

  const now = Date.now();
  if (now - lastFactTime < FACT_MIN_INTERVAL) return;

  const nearby = findNearbyFacts(factsDB, currentPosition.latitude, currentPosition.longitude, FACT_RADIUS_MILES);
  const unseen = nearby.filter(f => !shownFactIds.has(f.id));

  if (unseen.length === 0) return;

  // Pick the closest unseen fact
  const fact = unseen[0];
  showFact(fact);
}

function showFact(fact) {
  shownFactIds.add(fact.id);
  lastFactTime = Date.now();
  currentFact = fact;

  // Add pin to map
  addFactPin(fact);

  // Update pin counter
  pinCount++;
  pinCountEl.textContent = pinCount;
  pinCounter.classList.add('bump');
  setTimeout(() => pinCounter.classList.remove('bump'), 300);

  // Show postcard
  showPostcard(fact);
}

// --- FACT PINS ---
function addFactPin(fact) {
  const el = document.createElement('div');
  el.className = `fact-marker category-${fact.category}`;

  const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
    .setLngLat([fact.lng, fact.lat])
    .addTo(map);

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    currentFact = fact;
    showPostcard(fact);
  });

  factMarkers.push({ marker, fact });
}

// --- IMAGE HANDLING ---
// Category-specific search terms for Wikipedia/Unsplash fallback
const CATEGORY_SEARCH_TERMS = {
  landmark: 'monument architecture',
  event: 'historical event',
  weird: 'strange unusual place',
  people: 'historical figure portrait',
  nature: 'landscape nature wilderness',
  sighting: 'mysterious night sky',
  history: 'american history vintage',
  crime: 'crime scene investigation',
  science: 'science laboratory space',
  culture: 'american culture art',
};

const CATEGORY_GRADIENTS = {
  landmark: 'linear-gradient(135deg, #2d6a8f, #1a3a5c)',
  event: 'linear-gradient(135deg, #b45309, #78350f)',
  weird: 'linear-gradient(135deg, #7c3aed, #4c1d95)',
  people: 'linear-gradient(135deg, #059669, #064e3b)',
  nature: 'linear-gradient(135deg, #16a34a, #14532d)',
  sighting: 'linear-gradient(135deg, #dc2626, #7f1d1d)',
  history: 'linear-gradient(135deg, #b45309, #451a03)',
  crime: 'linear-gradient(135deg, #991b1b, #450a0a)',
  science: 'linear-gradient(135deg, #0369a1, #0c4a6e)',
  culture: 'linear-gradient(135deg, #7e22ce, #3b0764)',
};

const imageCache = new Map();

function applyImageToEl(el, url) {
  // Load the image first, then apply with a fade
  const img = new Image();
  img.onload = () => {
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center top';
    el.classList.add('has-image');
  };
  img.onerror = () => {
    // Silently fail -- keep the gradient
  };
  img.src = url;
}

function setFactImage(el, fact) {
  const fallbackGradient = CATEGORY_GRADIENTS[fact.category] || CATEGORY_GRADIENTS.landmark;
  el.style.background = fallbackGradient;
  el.style.backgroundSize = 'cover';
  el.style.backgroundPosition = 'center top';

  // Check cache first
  const cached = imageCache.get(fact.id);
  if (cached) {
    applyImageToEl(el, cached);
    return;
  }

  // Strategy: try sources in order until one works
  resolveImage(fact).then(url => {
    if (url) {
      imageCache.set(fact.id, url);
      applyImageToEl(el, url);
    }
  });
}

async function resolveImage(fact) {
  // 1. Try the provided imageUrl
  if (fact.imageUrl) {
    const works = await testImage(fact.imageUrl);
    if (works) return fact.imageUrl;
  }

  // 2. Try Wikipedia -- one at a time from the browser (won't trigger rate limits
  // like our batch script did). Search by title for the most relevant image.
  try {
    const query = encodeURIComponent(fact.title.replace(/[^\w\s]/g, '').substring(0, 60));
    const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${query}&gsrlimit=3&prop=pageimages&format=json&pithumbsize=600&origin=*`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const pages = data.query?.pages;
      if (pages) {
        for (const p of Object.values(pages)) {
          if (p?.thumbnail?.source) return p.thumbnail.source;
        }
      }
    }
  } catch {}

  return null;
}

function testImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function fetchWikipediaImage(searchTerm) {
  try {
    const query = encodeURIComponent(searchTerm.replace(/[^\w\s]/g, ''));
    // Try exact title match first
    const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${query}&prop=pageimages&format=json&pithumbsize=800&origin=*`;
    const response = await fetch(url);
    const data = await response.json();
    const pages = data.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    if (page?.thumbnail?.source) return page.thumbnail.source;

    // Try search if exact title didn't work
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${query}&gsrlimit=3&prop=pageimages&format=json&pithumbsize=800&origin=*`;
    const searchResponse = await fetch(searchUrl);
    const searchData = await searchResponse.json();
    const searchPages = searchData.query?.pages;
    if (!searchPages) return null;
    // Find the first page with a thumbnail
    for (const p of Object.values(searchPages)) {
      if (p?.thumbnail?.source) return p.thumbnail.source;
    }
    return null;
  } catch {
    return null;
  }
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

// --- POSTCARD ---
function showPostcard(fact) {
  // Clear any existing timeout
  if (postcardTimeout) clearTimeout(postcardTimeout);

  const dist = currentPosition
    ? distanceMiles(currentPosition.latitude, currentPosition.longitude, fact.lat, fact.lng).toFixed(1)
    : '??';

  // Update postcard content
  document.getElementById('postcard-title').textContent = fact.title;
  document.getElementById('postcard-text').textContent = fact.summary;
  const catEl = document.getElementById('postcard-category');
  catEl.textContent = fact.category;
  catEl.className = 'postcard-category cat-' + fact.category;
  document.getElementById('postcard-distance').textContent = `${fact.location} -- ${dist}mi below you`;
  document.getElementById('postcard-era').textContent = fact.year;

  // Set image (reset shimmer state)
  const imgEl = document.getElementById('postcard-image');
  imgEl.classList.remove('has-image');
  imgEl.style.backgroundImage = '';
  setFactImage(imgEl, fact);

  // Random slight rotation for fun
  const rotation = (Math.random() - 0.5) * 4;
  document.getElementById('postcard').style.transform = `rotate(${rotation}deg)`;

  // Show -- stays until user closes it or a new fact appears
  postcardContainer.classList.add('visible');
}

// --- EXPANDED POSTCARD ---
function showExpandedPostcard(fact) {
  // Clear auto-hide
  if (postcardTimeout) clearTimeout(postcardTimeout);
  postcardContainer.classList.remove('visible');

  const dist = currentPosition
    ? distanceMiles(currentPosition.latitude, currentPosition.longitude, fact.lat, fact.lng).toFixed(1)
    : '??';

  document.getElementById('expanded-title').textContent = fact.title;
  const expCatEl = document.getElementById('expanded-category');
  expCatEl.textContent = fact.category;
  expCatEl.className = 'expanded-category cat-' + fact.category;
  document.getElementById('expanded-location').textContent = `${fact.location} -- ${dist}mi below you`;
  document.getElementById('expanded-text').textContent = fact.fullText;

  const imgEl = document.getElementById('expanded-image');
  imgEl.classList.remove('has-image');
  imgEl.style.backgroundImage = '';
  setFactImage(imgEl, fact);

  // Video embed
  const mediaEl = document.getElementById('expanded-media');
  if (fact.videoUrl) {
    mediaEl.innerHTML = `<iframe src="${fact.videoUrl}" allowfullscreen loading="lazy"></iframe>`;
  } else {
    mediaEl.innerHTML = '';
  }

  document.getElementById('postcard-expanded').classList.add('visible');
}

function hideExpandedPostcard() {
  document.getElementById('postcard-expanded').classList.remove('visible');
}

// --- LIVE FLIGHT SUGGESTIONS ---
const ICAO_TO_IATA = { 'DAL': 'DL', 'AAL': 'AA', 'UAL': 'UA', 'SWA': 'WN', 'JBU': 'B6', 'ASA': 'AS', 'NKS': 'NK', 'FFT': 'F9' };

async function fetchLiveFlightSuggestions() {
  const hint = document.getElementById('loading-flights-hint');
  const container = document.getElementById('suggested-flights');

  try {
    // Single query, same one tracking uses -- gets cached for 10s
    const data = await openskyFetch(
      'https://opensky-network.org/api/states/all?lamin=24&lamax=50&lomin=-130&lomax=-65'
    );
    if (!data.states) throw new Error('No data');

    const knownPrefixes = Object.keys(ICAO_TO_IATA);
    const cruiseFlights = data.states.filter(s => {
      const cs = (s[1] || '').trim();
      const alt = s[7] ? s[7] * 3.28084 : 0;
      return cs && !s[8] && alt > 25000 && s[6] && s[5]
        && knownPrefixes.some(p => cs.startsWith(p));
    });

    // Prioritize flights we have route data for
    const withRoutes = [];
    const withoutRoutes = [];

    for (const s of cruiseFlights) {
      const callsign = (s[1] || '').trim();
      const prefix = knownPrefixes.find(p => callsign.startsWith(p));
      const iataAirline = ICAO_TO_IATA[prefix];
      const flightNum = callsign.replace(prefix, '');
      const iataFlight = iataAirline + flightNum;
      // Guess route from the plane's actual position and heading
      const guessed = guessRouteFromPosition(s[6], s[5], s[10]);
      const routeLabel = guessed
        ? `${AIRPORTS[guessed.origin]?.name || guessed.origin} to ${AIRPORTS[guessed.dest]?.name || guessed.dest}`
        : null;

      const entry = {
        iata: iataFlight,
        callsign,
        route: routeLabel,
        lon: s[5],
      };

      if (route) {
        withRoutes.push(entry);
      } else {
        withoutRoutes.push(entry);
      }
    }

    // Shuffle and pick geographically spread flights -- prefer ones with known routes
    const pool = [...withRoutes.sort(() => Math.random() - 0.5), ...withoutRoutes.sort(() => Math.random() - 0.5)];
    const selected = [];
    const usedLons = [];

    for (const f of pool) {
      if (selected.length >= 8) break;
      if (usedLons.some(l => Math.abs(l - f.lon) < 6)) continue;
      usedLons.push(f.lon);
      selected.push(f);
    }

    if (selected.length > 0) {
      selected.forEach(f => {
        const chip = document.createElement('button');
        chip.className = 'flight-chip';
        chip.dataset.flight = f.iata;
        chip.innerHTML = f.route
          ? `${f.iata} <span>${f.route}</span>`
          : `${f.iata} <span>live</span>`;
        container.appendChild(chip);
      });
      hint.textContent = `${cruiseFlights.length} flights in the air -- pick one or enter your own`;
    } else {
      // Fallback if OpenSky is down
      container.innerHTML = `
        <button class="flight-chip" data-flight="DL843">DL843 <span>ATL-SAN</span></button>
        <button class="flight-chip" data-flight="AA100">AA100 <span>JFK-LAX</span></button>
        <button class="flight-chip" data-flight="UA1">UA1 <span>SFO-EWR</span></button>
      `;
      hint.textContent = 'No flights found in this region -- try entering a flight number';
    }
  } catch(e) {
    console.warn('Could not fetch live flights:', e);
    const isRateLimited = e.message && e.message.includes('Rate limited');
    container.innerHTML = `
      <button class="flight-chip" data-flight="DL401">DL401 <span>ATL-LAX</span></button>
      <button class="flight-chip" data-flight="AA100">AA100 <span>JFK-LAX</span></button>
      <button class="flight-chip" data-flight="UA1">UA1 <span>SFO-EWR</span></button>
      <button class="flight-chip" data-flight="WN1234">WN1234 <span>MDW-LAS</span></button>
      <button class="flight-chip" data-flight="B6523">B6523 <span>JFK-MCO</span></button>
      <button class="flight-chip" data-flight="AS1234">AS1234 <span>SEA-LAX</span></button>
    `;
    hint.textContent = isRateLimited
      ? 'Flight data temporarily unavailable (resets at midnight UTC) -- enter a flight number to try'
      : 'Enter your flight number above, or try one of these popular routes';
  }
}
