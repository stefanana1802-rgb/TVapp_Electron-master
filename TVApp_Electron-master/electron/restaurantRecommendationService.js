/**
 * Restaurant of the Day: recomandare bazată pe recenzii, prețuri, calitate (Google Places).
 * Rulează o dată pe 24h (noaptea); prima aplicație care vede că nu s-a făcut update azi face pull → API → scrie → push.
 * Folosește GOOGLE_MAPS_API_KEY sau GOOGLE_PLACES_API_KEY din .env.
 */
const path = require('path');
const fs = require('fs').promises;
const workspaceService = require('./workspaceService');
const { doGitSync, doGitPush } = require('./playlistService');

const HISTORY_DAYS = 20;
const HISTORY_MAX_ENTRIES = 20;
const CANTEEN_SECTION = 'canteen_menu';
const HISTORY_FILENAME = 'restaurant_history.json';

function getApiKey() {
  try {
    require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
    return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
  } catch {
    return '';
  }
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function parsePriceLevel(level) {
  if (level == null) return '€€';
  const n = Number(level);
  if (n <= 1) return '€';
  if (n <= 2) return '€€';
  if (n <= 3) return '€€€';
  return '€€€€';
}

function priceLabel(level) {
  const n = Number(level);
  if (n <= 1) return 'cheap';
  if (n <= 2) return 'medium';
  return 'expensive';
}

function hasDelivery(place, details) {
  const types = (details && details.types) ? details.types : (place.types || []);
  return types.some((t) => /delivery|takeaway|take_out/i.test(t));
}

function buildTagline(place, details) {
  const parts = [];
  if (place.rating != null) parts.push(place.rating + ' ⭐');
  const price = (details && details.price_level != null) ? details.price_level : place.price_level;
  const delivery = hasDelivery(place, details);
  parts.push(parsePriceLevel(price) + ' - ' + priceLabel(price) + (delivery ? ' - delivery' : ''));
  const types = (details && details.types) ? details.types : (place.types || []);
  const hints = [];
  if (types.some(t => /terrace|outdoor|garden|rooftop/i.test(t))) hints.push('terrace');
  if (types.some(t => /bar|cafe/i.test(t))) hints.push('bar / cafe');
  if (hints.length) parts.push(hints.join(', '));
  return parts.join(' · ');
}

function displayName(rawName) {
  if (!rawName || typeof rawName !== 'string') return rawName;
  return /restaurant/i.test(rawName.trim()) ? rawName.trim() : 'Restaurant ' + rawName.trim();
}

function scorePlace(place) {
  const rating = Number(place.rating) || 0;
  const reviews = Number(place.user_ratings_total) || 0;
  const price = Number(place.price_level) || 2;
  const ratingScore = rating * Math.log(1 + reviews);
  const pricePenalty = Math.abs(price - 2) * 0.15;
  return ratingScore - pricePenalty;
}

async function loadHistory(teamDir) {
  const p = path.join(teamDir, CANTEEN_SECTION, HISTORY_FILENAME);
  try {
    const raw = await fs.readFile(p, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.history) ? data.history : [];
  } catch {
    return [];
  }
}

async function saveHistory(teamDir, history) {
  const dir = path.join(teamDir, CANTEEN_SECTION);
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, HISTORY_FILENAME);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - HISTORY_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const trimmed = history.filter((e) => e.date >= cutoffStr).slice(-HISTORY_MAX_ENTRIES);
  await fs.writeFile(p, JSON.stringify({ lastUpdated: todayStr(), history: trimmed }, null, 2), 'utf-8');
}

async function searchPlaces(location, apiKey) {
  const query = encodeURIComponent('restaurants in ' + location);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(data.error_message || data.status || 'Places API error');
  }
  return (data.results || []).slice(0, 20);
}

async function getPlaceDetails(placeId, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=name,rating,price_level,types&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') return null;
  return data.result || null;
}

async function runForTeam(team) {
  const workspaceDir = workspaceService.getWorkspaceDir();
  const teamDir = path.join(workspaceDir, team);
  const content = await workspaceService.getSectionContent(team, CANTEEN_SECTION);
  if (!content) return { team, updated: false, reason: 'no_content' };

  const location = (content.restaurantLocation || content.location || 'Sibiu').trim();
  if (!location) return { team, updated: false, reason: 'no_location' };

  const apiKey = getApiKey();
  if (!apiKey) return { team, updated: false, reason: 'no_api_key' };

  const history = await loadHistory(teamDir);
  const usedIds = new Set(history.map((e) => e.placeId));

  let places;
  try {
    places = await searchPlaces(location, apiKey);
  } catch (err) {
    return { team, updated: false, reason: 'api_error', error: String(err.message) };
  }

  const onlyDelivery = !!content.only_delivery;
  let filtered = places.filter((p) => p.place_id && !usedIds.has(p.place_id) && (Number(p.rating) || 0) >= 1);
  if (onlyDelivery) {
    filtered = filtered.filter((p) => hasDelivery(p, null));
  }
  const candidates = filtered
    .map((p) => ({ ...p, score: scorePlace(p) }))
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return { team, updated: false, reason: onlyDelivery ? 'no_delivery_candidates' : 'no_candidates' };

  const chosen = candidates[0];
  let details = null;
  try {
    details = await getPlaceDetails(chosen.place_id, apiKey);
  } catch (_) {}
  if (onlyDelivery && details && !hasDelivery(chosen, details)) {
    return { team, updated: false, reason: 'no_delivery_candidates' };
  }

  const tagline = buildTagline(chosen, details);
  const name = displayName(chosen.name);

  const newHistory = [
    ...history,
    { date: todayStr(), placeId: chosen.place_id, name: chosen.name }
  ].filter((e) => {
    const d = new Date(e.date);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - HISTORY_DAYS);
    return d >= cutoff;
  }).slice(-HISTORY_MAX_ENTRIES);

  await saveHistory(teamDir, newHistory);

  const nextContent = {
    ...content,
    slots: content.slots || [{ time: '10:30', duration: '15 min' }, { time: '11:30', duration: '15 min' }],
    restaurantLocation: location,
    only_delivery: !!content.only_delivery,
    restaurantLastUpdated: todayStr(),
    restaurant: {
      name,
      tagline
    }
  };
  const written = await workspaceService.writeSectionContent(team, CANTEEN_SECTION, nextContent);
  return { team, updated: written, name, tagline };
}

let lastStatus = { ok: false, message: 'Never run', lastRun: null, results: [] };

function getLastStatus() {
  return { ...lastStatus };
}

async function writeStatusFile(status) {
  try {
    const dir = workspaceService.getWorkspaceDir();
    const p = path.join(dir, 'restaurant_api_status.json');
    await fs.writeFile(p, JSON.stringify({
      ok: status.ok,
      message: status.message || '',
      lastRun: status.lastRun || null
    }, null, 2), 'utf-8');
  } catch (_) {}
}

async function runForAllTeams() {
  const teams = await workspaceService.getTeams();
  const results = [];
  for (const team of teams) {
    try {
      const r = await runForTeam(team);
      results.push(r);
    } catch (err) {
      results.push({ team, updated: false, reason: 'error', error: String(err.message) });
    }
  }
  const anyUpdated = results.some((r) => r.updated === true);
  const anyApiError = results.some((r) => r.reason === 'api_error' || r.reason === 'no_api_key');
  const noKey = results.some((r) => r.reason === 'no_api_key');
  if (anyUpdated) {
    lastStatus = { ok: true, message: 'OK', lastRun: new Date().toISOString(), results };
  } else if (noKey) {
    lastStatus = { ok: false, message: 'No API key', lastRun: new Date().toISOString(), results };
  } else if (anyApiError) {
    const firstErr = results.find((r) => r.reason === 'api_error');
    lastStatus = { ok: false, message: firstErr?.error || 'API error', lastRun: new Date().toISOString(), results };
  } else if (results.length === 0) {
    lastStatus = { ok: false, message: 'No teams', lastRun: new Date().toISOString(), results };
  } else {
    lastStatus = { ok: false, message: 'No candidate updated', lastRun: new Date().toISOString(), results };
  }
  await writeStatusFile(lastStatus);
  return results;
}

/**
 * Rulează o dată pe 24h: pull → dacă restaurantLastUpdated !== azi pentru vreo echipă, rulează API și push.
 * Orice TV poate fi cel care face update-ul; celelalte la pull văd data și nu mai rulează.
 */
async function runOncePerDayIfNeeded() {
  await doGitSync();
  const today = todayStr();
  const teams = await workspaceService.getTeams();
  const teamsToUpdate = [];
  for (const team of teams) {
    const content = await workspaceService.getSectionContent(team, CANTEEN_SECTION);
    if (!content || (content.restaurantLastUpdated || '') !== today) {
      teamsToUpdate.push(team);
    }
  }
  if (teamsToUpdate.length === 0) {
    return [];
  }
  const results = [];
  const pushedPaths = [];
  for (const team of teamsToUpdate) {
    try {
      const r = await runForTeam(team);
      results.push(r);
      if (r.updated) {
        pushedPaths.push(`WORKSPACE/${team}/${CANTEEN_SECTION}/content.json`, `WORKSPACE/${team}/${CANTEEN_SECTION}/${HISTORY_FILENAME}`);
      }
    } catch (err) {
      results.push({ team, updated: false, reason: 'error', error: String(err.message) });
    }
  }
  if (pushedPaths.length > 0) {
    const pushed = await doGitPush(pushedPaths);
    if (!pushed) {
      console.warn('[RestaurantRecommendation] Git push failed (e.g. another TV pushed first); pulling to sync.');
      await doGitSync();
    }
  }
  const anyUpdated = results.some((r) => r.updated === true);
  const anyApiError = results.some((r) => r.reason === 'api_error' || r.reason === 'no_api_key');
  const noKey = results.some((r) => r.reason === 'no_api_key');
  if (anyUpdated) {
    lastStatus = { ok: true, message: 'OK', lastRun: new Date().toISOString(), results };
  } else if (noKey) {
    lastStatus = { ok: false, message: 'No API key', lastRun: new Date().toISOString(), results };
  } else if (anyApiError) {
    const firstErr = results.find((r) => r.reason === 'api_error');
    lastStatus = { ok: false, message: firstErr?.error || 'API error', lastRun: new Date().toISOString(), results };
  } else {
    lastStatus = { ok: false, message: 'No candidate updated', lastRun: new Date().toISOString(), results };
  }
  await writeStatusFile(lastStatus);
  return results;
}

module.exports = { runForTeam, runForAllTeams, runOncePerDayIfNeeded, getApiKey, getLastStatus };
