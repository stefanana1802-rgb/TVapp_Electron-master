/**
 * Flightboard: filtrare listă projects, parsare Project/Flavor/Branch, generare URL lastx.php
 */

export const FLIGHTBOARD_PROJECTS_URL_DEFAULT =
  'https://flightboard-query-prod.cmo.aws.automotive.cloud/rest/projects';

export const FLIGHTBOARD_STATUS_BASE_DEFAULT =
  'https://asf42.cmo.aws.automotive.cloud/PublicBuildStatus/lastx.php';

/** Bază hash wpp SimpleView: fragment continuă cu ;projects=…;xHoursBack=… */
export const FLIGHTBOARD_SIMPLEVIEW_BASE_DEFAULT =
  'https://asf42.cmo.aws.automotive.cloud/wpp/#/flightBoard';

/** Scale CSS iframe SimpleView: din .env `VITE_FLIGHTBOARD_SIMPLEVIEW_IFRAME_SCALE` (implicit 0.6). */
function readSimpleViewIframeScale() {
  try {
    const raw = import.meta.env?.VITE_FLIGHTBOARD_SIMPLEVIEW_IFRAME_SCALE;
    if (raw === undefined || raw === null || String(raw).trim() === '') return 0.6;
    const n = Number(String(raw).trim().replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0 || n > 2) return 0.6;
    return n;
  } catch {
    return 0.6;
  }
}

export const FLIGHTBOARD_SIMPLEVIEW_IFRAME_SCALE = readSimpleViewIframeScale();

/** Link SimpleView Flightboard: …/wpp/#/flightBoard… */
export function isFlightboardSimpleViewPlaybackUrl(src) {
  if (!src || typeof src !== 'string') return false;
  const u = src.toLowerCase();
  return u.includes('/wpp/') && u.includes('#/flightboard');
}

export function newFlightboardSection() {
  return {
    id: `fb-sec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    project: '',
    flavor: '',
    branch: '',
    lastX: 4,
    selectedTypes: [],
    generatedUrls: [],
    simpleView: false,
    xHoursBack: 150
  };
}

export function createDefaultFlightboard() {
  return {
    finalized: false,
    projectsUrl: FLIGHTBOARD_PROJECTS_URL_DEFAULT,
    statusBase: FLIGHTBOARD_STATUS_BASE_DEFAULT,
    sections: [newFlightboardSection()],
    urls: []
  };
}

/** Link-uri în ordinea secțiunilor (generate în fiecare secțiune). */
export function collectFlightboardUrlsFromSections(sections) {
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((s) => (Array.isArray(s.generatedUrls) ? s.generatedUrls : []));
}

/**
 * În player: un slide flightboard → mai multe web_url cu durata împărțită.
 * @param {Array} slides
 */
export function expandPlaylistSlidesForPlayback(slides) {
  if (!Array.isArray(slides)) return [];
  return slides.flatMap((s) => {
    const t = (s.type || '').toLowerCase();
    if (t !== 'flightboard') return [s];
    const urls = Array.isArray(s.flightboard?.urls) ? s.flightboard.urls.filter(Boolean) : [];
    if (urls.length === 0) {
      return [{ ...s, type: 'web_url', src: '', duration: Math.max(5, Number(s.duration) || 10) }];
    }
    const total = Math.max(1, Number(s.duration) || 120);
    const per = Math.max(5, Math.floor(total / urls.length));
    const slideTitle = typeof s.title === 'string' ? s.title.trim() : '';
    const slideSubtitle = typeof s.subtitle === 'string' ? s.subtitle.trim() : '';
    return urls.map((src, i) => ({
      ...s,
      id: `${s.id}__fb${i}`,
      type: 'web_url',
      src,
      duration: per,
      title: slideTitle,
      subtitle: slideSubtitle,
      flightboardExpandedFrom: s.id
    }));
  });
}

/** Opțiuni multi-select: steps + buildType (fast/full) */
export const FLIGHTBOARD_STEP_TYPES = [
  'SWCT_fast',
  'SWCT_full',
  'QAC_fast',
  'QAC_full',
  'ECU_fast',
  'ECU_full',
  'CPI_fast',
  'CPI_full',
  'HIL_fast',
  'HIL_full',
  'SIL_fast',
  'SIL_full'
];

/**
 * Include: conține cust-release SAU conține feature/padit-
 * @param {string} entry
 */
export function filterFlightboardProjectEntry(entry) {
  if (!entry || typeof entry !== 'string') return false;
  const s = entry;
  if (s.includes('cust-release')) return true;
  if (s.includes('feature/padit-')) return true;
  return false;
}

/**
 * BEJV_BE3_feature/padit-1876145-... → { project, flavor, branch, raw }
 * @param {string} s
 */
export function parseFlightboardProjectString(s) {
  if (!s || typeof s !== 'string') return null;
  const i1 = s.indexOf('_');
  if (i1 <= 0) return null;
  const i2 = s.indexOf('_', i1 + 1);
  if (i2 <= 0) return null;
  const project = s.slice(0, i1);
  const flavor = s.slice(i1 + 1, i2);
  const branch = s.slice(i2 + 1);
  if (!project || !flavor || !branch) return null;
  return { project, flavor, branch, raw: s };
}

/**
 * Catalog: project → flavor → branch[] (unique, sorted)
 * @param {string[]} projectStrings
 */
export function buildFlightboardCatalog(projectStrings) {
  /** @type {Record<string, Record<string, Set<string>>>} */
  const tree = {};
  for (const raw of projectStrings) {
    const parsed = parseFlightboardProjectString(raw);
    if (!parsed) continue;
    if (!tree[parsed.project]) tree[parsed.project] = {};
    if (!tree[parsed.project][parsed.flavor]) tree[parsed.project][parsed.flavor] = new Set();
    tree[parsed.project][parsed.flavor].add(parsed.branch);
  }
  /** @type {Record<string, Record<string, string[]>>} */
  const out = {};
  for (const p of Object.keys(tree).sort()) {
    out[p] = {};
    for (const f of Object.keys(tree[p]).sort()) {
      out[p][f] = [...tree[p][f]].sort();
    }
  }
  return out;
}

/**
 * SWCT_fast → { steps: 'SWCT', buildType: 'fast' }
 * @param {string} token
 */
export function parseStepTypeToken(token) {
  const t = (token || '').trim();
  const i = t.lastIndexOf('_');
  if (i <= 0) return null;
  const mode = t.slice(i + 1).toLowerCase();
  if (mode !== 'fast' && mode !== 'full') return null;
  const steps = t.slice(0, i).toUpperCase();
  if (!steps) return null;
  return { steps, buildType: mode };
}

/**
 * @param {{ project: string, flavor: string, branch: string, lastX: number, stepType: string }} opts
 * @param {string} [statusBase]
 */
export function buildFlightboardLastxUrl(opts, statusBase = FLIGHTBOARD_STATUS_BASE_DEFAULT) {
  const { project, flavor, branch, lastX, stepType } = opts;
  const parsed = parseStepTypeToken(stepType);
  if (!parsed) return null;
  const projectValue = `${project}_${flavor}_${branch}`;
  const params = new URLSearchParams();
  params.set('project', projectValue);
  params.set('lastx', String(Math.max(1, Math.min(20, Number(lastX) || 4))));
  params.set('steps', parsed.steps);
  params.set('buildType', parsed.buildType);
  const sep = statusBase.includes('?') ? '&' : '?';
  return `${statusBase}${sep}${params.toString()}`;
}

/**
 * SimpleView (wpp): projects = project_flavor_branch cu / → %2F prin encodeURIComponent.
 * @param {{ project: string, flavor: string, branch: string, xHoursBack?: number }} opts
 * @param {string} [simpleViewBase]
 */
export function buildFlightboardSimpleViewUrl(opts, simpleViewBase = FLIGHTBOARD_SIMPLEVIEW_BASE_DEFAULT) {
  const { project, flavor, branch } = opts;
  if (!project || !flavor || !branch) return null;
  const projectValue = `${project}_${flavor}_${branch}`;
  const projectsParam = encodeURIComponent(projectValue);
  const hours = Math.max(1, Math.min(99999, Number(opts.xHoursBack) || 150));
  const base = (simpleViewBase || FLIGHTBOARD_SIMPLEVIEW_BASE_DEFAULT).trim();
  return `${base};projects=${projectsParam};xHoursBack=${hours};isToDateNotNow=false`;
}
