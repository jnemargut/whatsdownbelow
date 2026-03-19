/**
 * Calculate distance between two lat/lng points in miles using Haversine formula
 */
export function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * Math.PI / 180;
}

/**
 * Generate a great circle arc between two points for drawing flight paths
 * Returns array of [lng, lat] coordinate pairs (GeoJSON format)
 */
export function greatCircleArc(lat1, lng1, lat2, lng2, numPoints = 100) {
  const points = [];
  for (let i = 0; i <= numPoints; i++) {
    const f = i / numPoints;
    const lat = lat1 + (lat2 - lat1) * f;
    const lng = lng1 + (lng2 - lng1) * f;
    points.push([lng, lat]);
  }
  return points;
}

/**
 * Find nearby facts within a given radius
 */
export function findNearbyFacts(facts, lat, lng, radiusMiles = 60) {
  return facts
    .filter(fact => {
      const dist = distanceMiles(lat, lng, fact.lat, fact.lng);
      return dist <= radiusMiles;
    })
    .map(fact => ({
      ...fact,
      distance: distanceMiles(lat, lng, fact.lat, fact.lng),
    }))
    .sort((a, b) => a.distance - b.distance);
}
