// Small geo helpers used when PostGIS is not available (and for privacy
// fuzzing either way).
const R = 6371e3; // metres
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Bounding box around a point, for index-friendly pre-filtering. */
export function boundingBox(lat, lng, radiusM) {
  const dLat = (radiusM / R) * (180 / Math.PI);
  const dLng = dLat / Math.max(Math.cos(rad(lat)), 0.01);
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

/**
 * Public "approximate" centre: a random point up to 60 % of the radius away
 * from the real one, so the real point is always inside the public circle
 * but cannot be recovered from it.
 */
export function approximate(lat, lng, radiusM = 500, random = Math.random) {
  const distance = radiusM * 0.6 * Math.sqrt(random());
  const bearing = random() * 2 * Math.PI;
  const dLat = (distance * Math.cos(bearing)) / R;
  const dLng = (distance * Math.sin(bearing)) / (R * Math.cos(rad(lat)));
  return { lat: lat + (dLat * 180) / Math.PI, lng: lng + (dLng * 180) / Math.PI };
}
