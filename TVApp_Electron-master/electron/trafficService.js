/**
 * Traffic data from office (Strada Salzburg, Sibiu) to destinations in Sibiu.
 * Uses Google Distance Matrix API when GOOGLE_MAPS_API_KEY is set.
 * Returns mock data otherwise or on error.
 */

const ORIGIN = 'Aumovio Sibiu - Strada Salzburg';
const ORIGIN_ADDRESS = 'Strada Salzburg, Sibiu, Romania'; // for API
const DESTINATIONS = [
  { id: 'centru', name: 'Centru Sibiu', address: 'Centru, Sibiu, Romania' },
  { id: 'doamna-stanca', name: 'Doamna Stanca Sibiu', address: 'Strada Doamna Stanca, Sibiu, Romania' },
  { id: 'vasile-aron', name: 'Vasile Aron Sibiu', address: 'Strada Vasile Aron, Sibiu, Romania' }
];

const CACHE_MS = 20 * 60 * 1000; // 20 min
let cached = null;
let cachedAt = 0;

function statusFromRatio(ratio) {
  if (ratio >= 1.4) return 'very_busy';
  if (ratio >= 1.15) return 'busy';
  return 'normal';
}

async function fetchFromGoogle(apiKey) {
  const now = Math.floor(Date.now() / 1000);
  const origins = encodeURIComponent(ORIGIN_ADDRESS);
  const dests = DESTINATIONS.map((d) => d.address).join('|');
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origins}&destinations=${encodeURIComponent(dests)}&departure_time=${now}&traffic_model=best_guess&mode=driving&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.rows?.[0]?.elements) {
    throw new Error(data.error_message || data.status || 'Invalid response');
  }
  const elements = data.rows[0].elements;
  return DESTINATIONS.map((dest, i) => {
    const el = elements[i];
    if (!el || el.status !== 'OK') {
      return { destination: dest.name, minutes: null, status: 'unknown' };
    }
    const durationInTraffic = el.duration_in_traffic?.value ?? el.duration?.value;
    const durationNormal = el.duration?.value;
    const minutes = durationInTraffic ? Math.round(durationInTraffic / 60) : null;
    const ratio = durationNormal && durationInTraffic ? durationInTraffic / durationNormal : 1;
    const status = statusFromRatio(ratio);
    return { destination: dest.name, minutes, status };
  });
}

function getMockData() {
  return DESTINATIONS.map((d, i) => {
    const minutes = [12, 8, 15][i] + Math.floor(Math.random() * 5);
    const statuses = ['normal', 'busy', 'very_busy'];
    const status = statuses[i % 3];
    return { destination: d.name, minutes, status };
  });
}

async function getTrafficData() {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_MS) {
    return cached;
  }
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  try {
    if (apiKey) {
      const data = await fetchFromGoogle(apiKey);
      cached = { origin: ORIGIN, routes: data, isLive: true, updatedAt: now };
      cachedAt = now;
      return cached;
    }
  } catch (err) {
    console.warn('Traffic API error, using mock:', err.message);
  }
  cached = { origin: ORIGIN, routes: getMockData(), isLive: false, updatedAt: now };
  cachedAt = now;
  return cached;
}

module.exports = { getTrafficData, ORIGIN, ORIGIN_ADDRESS };
