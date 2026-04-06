import React, { useState, useEffect, useRef } from 'react';

const INTERVAL_STOCK_MS = 2 * 60 * 1000;    // 2 min (stock – fără cooldown în dashboard)

const UPTIME_SERVICES_DEFAULT = [
  { id: 'github', name: 'GitHub', up: true, statusUrl: '' },
  { id: 'jira', name: 'Jira', up: true, statusUrl: '' },
  { id: 'slack', name: 'Slack', up: true, statusUrl: '' },
  { id: 'jenkins', name: 'Jenkins', up: true, statusUrl: '' },
  { id: 'monitor', name: 'Monitor', up: false, statusUrl: '' }
];

const PROJECTS_IN_WORK_DEFAULT = [
  { name: 'Alpha', start: '2025-01-15', end: '2025-06-30', progress: 45, status: 'normal' },
  { name: 'Beta', start: '2025-02-01', end: '2025-08-15', progress: 28, status: 'task_force' },
  { name: 'Gamma', start: '2024-11-01', end: '2025-02-28', progress: 100, status: 'maintenance' },
  { name: 'Delta', start: '2025-03-01', end: '2025-09-30', progress: 12, status: 'normal' }
];

const MEETING_ROOMS_DEFAULT = [
  { name: 'Room A', slots: ['08:00–09:00', '09:30–10:30', '11:00–12:00'] },
  { name: 'Room B', slots: ['08:30–10:00', '10:30–12:00'] },
  { name: 'Room C', slots: ['09:00–10:00', '10:30–11:30', '12:00–13:00'] }
];

// Field 2 – Stock: last 4 months, price in EUR, trend
const STOCK_HISTORY = [
  { month: 'Nov', value: 42 },
  { month: 'Dec', value: 45 },
  { month: 'Jan', value: 43 },
  { month: 'Feb', value: 48 }
];

function GitHubIcon({ className = 'w-5 h-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function ServiceIcon({ serviceId, className = 'w-5 h-5' }) {
  if (serviceId === 'github') return <GitHubIcon className={className} />;
  return (
    <div className={`${className} rounded bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500`}>
      {serviceId.slice(0, 2).toUpperCase()}
    </div>
  );
}

function CarIcon({ className = 'w-8 h-8' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 17h14v-5H5v5zm2-6h2v2H7v-2zm8 0h2v2h-2v-2zm-4-6l2-3h4l2 3" />
      <path d="M3 12h18v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5z" />
      <circle cx="7.5" cy="17" r="1.5" fill="currentColor" />
      <circle cx="16.5" cy="17" r="1.5" fill="currentColor" />
    </svg>
  );
}

function useCarousel(getPageCounts, getIntervalMs) {
  const [categoryIndex, setCategoryIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const [lastTick, setLastTick] = useState(() => Date.now());
  const lastTickRef = useRef(lastTick);
  lastTickRef.current = lastTick;
  const ref = useRef({ categoryIndex: 0, itemIndex: 0 });
  ref.current = { categoryIndex, itemIndex };
  const getPagesRef = useRef(getPageCounts);
  getPagesRef.current = getPageCounts;
  const getIntervalRef = useRef(getIntervalMs);
  getIntervalRef.current = getIntervalMs;

  useEffect(() => {
    const id = setInterval(() => {
      try {
        const now = Date.now();
        const { categoryIndex: cat, itemIndex: item } = ref.current;
        const safeCat = Number.isFinite(cat) ? cat : 0;
        const intervalMs = getIntervalRef.current(safeCat);
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
        if (now - lastTickRef.current >= intervalMs) {
          lastTickRef.current = now;
          setLastTick(now);
          const pageCounts = getPagesRef.current();
          const arr = Array.isArray(pageCounts) ? pageCounts : [1];
          const len = Math.max(1, arr.length);
          const pages = Number.isFinite(arr[safeCat]) ? arr[safeCat] : 0;
          if (pages > 0 && item + 1 < pages) {
            setItemIndex(item + 1);
          } else {
            setCategoryIndex((c) => {
              const next = (Number.isFinite(c) ? c : 0) + 1;
              return next % len;
            });
            setItemIndex(0);
          }
        }
      } catch (err) {
        console.error('[StatusDashboard] useCarousel tick error:', err);
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return [categoryIndex, itemIndex, lastTick];
}

function formatDate(s) {
  const d = new Date(s);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function useCountdown(lastTick, intervalMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);
  const safeInterval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 60000;
  const remaining = Math.max(0, Math.ceil((lastTick + safeInterval - now) / 1000));
  return Number.isFinite(remaining) ? remaining : 0;
}

function secToMs(sec, defaultSec) {
  const s = Math.max(5, Math.min(3600, Number(sec) || defaultSec));
  return s * 1000;
}

const UPTIME_CHECK_MS = 15 * 60 * 1000; // 15 minute

export default function StatusDashboard({ sections = {} }) {
  const UPTIME_SERVICES = (sections.uptime_services?.services && Array.isArray(sections.uptime_services.services)) ? sections.uptime_services.services : UPTIME_SERVICES_DEFAULT;
  const PROJECTS_IN_WORK = (sections.projects_info?.projects && Array.isArray(sections.projects_info.projects)) ? sections.projects_info.projects : PROJECTS_IN_WORK_DEFAULT;
  const MEETING_ROOMS = (sections.meeting_rooms?.rooms && Array.isArray(sections.meeting_rooms.rooms)) ? sections.meeting_rooms.rooms : MEETING_ROOMS_DEFAULT;

  const [serviceStatus, setServiceStatus] = useState({});

  useEffect(() => {
    const services = (sections.uptime_services?.services && Array.isArray(sections.uptime_services.services))
      ? sections.uptime_services.services
      : UPTIME_SERVICES_DEFAULT;
    const getUrl = (s) => (s && typeof s.statusUrl === 'string') ? s.statusUrl.trim() : '';
    function check() {
      const checkUrl = typeof window.api?.checkUptimeUrl === 'function'
        ? (url) => window.api.checkUptimeUrl(url).then((r) => r?.ok === true)
        : (url) => fetch(url, { method: 'GET', cache: 'no-store' }).then((res) => res.ok);
      services.forEach((s) => {
        const statusUrl = getUrl(s);
        if (!statusUrl) {
          setServiceStatus((prev) => ({ ...prev, [s.id]: 'no_url' }));
          return;
        }
        checkUrl(statusUrl)
          .then((ok) => setServiceStatus((prev) => ({ ...prev, [s.id]: ok ? 'up' : 'down' })))
          .catch(() => setServiceStatus((prev) => ({ ...prev, [s.id]: 'down' })));
      });
    }
    check();
    const id = setInterval(check, UPTIME_CHECK_MS);
    return () => clearInterval(id);
  }, [sections.uptime_services]);

  const INTERVAL_UPTIME_MS = secToMs(sections.uptime_services?.cooldownSeconds, 120);
  const INTERVAL_PROJECT_MS = secToMs(sections.projects_info?.cooldownSeconds, 120);
  const INTERVAL_ROOMS_MS = secToMs(sections.meeting_rooms?.cooldownSeconds, 60);

  const field1Categories = ['uptime', 'projects'];
  const field2Categories = ['rooms', 'stock'];

  const [cat1, item1, lastTick1] = useCarousel(
    () => [1, PROJECTS_IN_WORK.length],
    (cat) => (cat === 0 ? INTERVAL_UPTIME_MS : INTERVAL_PROJECT_MS)
  );
  const hasMeetingImage = !!(sections.meeting_rooms?.image && String(sections.meeting_rooms.image).trim());
  const [cat2, item2, lastTick2] = useCarousel(
    () => [hasMeetingImage ? 1 : MEETING_ROOMS.length, 1],
    (cat) => (cat === 0 ? INTERVAL_ROOMS_MS : INTERVAL_STOCK_MS)
  );

  const interval1Ms = cat1 === 0 ? INTERVAL_UPTIME_MS : INTERVAL_PROJECT_MS;
  const interval2Ms = cat2 === 0 ? INTERVAL_ROOMS_MS : INTERVAL_STOCK_MS;
  const countdown1 = useCountdown(lastTick1, interval1Ms);
  const countdown2 = useCountdown(lastTick2, interval2Ms);

  const safeCat1 = Number.isFinite(cat1) ? Math.max(0, Math.min(cat1, 1)) : 0;
  const safeCat2 = Number.isFinite(cat2) ? Math.max(0, Math.min(cat2, 1)) : 0;
  const field1Label = field1Categories[safeCat1] === 'uptime' ? 'Uptime services' : 'Project in work';
  const field2Label = field2Categories[safeCat2] === 'rooms' ? 'Meeting rooms' : 'Aumovio - Share Price';

  return (
    <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-2 w-full h-full flex-1 min-h-0 overflow-hidden">
      {/* Field 1 */}
      <div className="rounded-xl bg-surface border border-gray-200 shadow-sm px-3 py-2 flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center justify-between mb-1 shrink-0">
          <span className="text-xs uppercase tracking-[0.15em] text-gray-500 truncate">{field1Label}</span>
          <span className="text-[0.65rem] text-gray-400 tabular-nums">{countdown1}s</span>
        </div>
        {field1Categories[safeCat1] === 'uptime' && (() => {
          const n = UPTIME_SERVICES.length;
          const compact = n > 4;
          return (
            <div className="flex flex-wrap gap-2 items-center justify-start flex-1 min-h-0 overflow-auto content-start pt-2.5">
              {UPTIME_SERVICES.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-2 shrink-0 rounded-lg bg-gray-50 border border-gray-100 ${
                    compact ? 'py-1 px-2' : 'py-2 px-3'
                  }`}
                >
                  <ServiceIcon serviceId={s.id} className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
                  <span className={compact ? 'text-xs font-semibold text-gray-800' : 'text-sm font-semibold text-gray-800'}>
                    {s.name}
                  </span>
                  <span
                    className={`shrink-0 rounded-full ${
                      serviceStatus[s.id] === 'no_url' ? 'bg-gray-600' : serviceStatus[s.id] === 'up' ? 'bg-emerald-500' : 'bg-red-500'
                    } ${compact ? 'h-1.5 w-1.5' : 'h-2 w-2'}`}
                    title={serviceStatus[s.id] === 'no_url' ? 'No URL' : serviceStatus[s.id] === 'up' ? 'Up' : 'Down'}
                  />
                </div>
              ))}
            </div>
          );
        })()}
        {field1Categories[safeCat1] === 'projects' && (() => {
          const p = PROJECTS_IN_WORK[item1];
          if (!p) return null;
          const startMs = p.start ? new Date(p.start).getTime() : 0;
          const endMs = p.end ? new Date(p.end).getTime() : 0;
          const now = Date.now();
          const computedProgress = (startMs && endMs && endMs > startMs)
            ? Math.min(100, Math.max(0, Math.round(((now - startMs) / (endMs - startMs)) * 100)))
            : (p.progress ?? 0);
          const progress = typeof p.progress === 'number' ? p.progress : computedProgress;
          const displayStatus = progress >= 100 ? 'maintenance' : (p.status || 'normal');
          const statusStyles = {
            normal: 'bg-emerald-100 text-emerald-800 border-emerald-200',
            task_force: 'bg-red-100/80 text-red-800 border-red-200',
            maintenance: 'bg-amber-100 text-amber-800 border-amber-200',
            change_request: 'bg-amber-100 text-amber-800 border-amber-200'
          };
          const statusLabels = {
            normal: 'Normal work',
            task_force: 'Task Force',
            maintenance: 'Maintenance/Change Request',
            change_request: 'Maintenance/Change Request'
          };
          const statusDot = {
            normal: 'bg-emerald-500',
            task_force: 'bg-red-500',
            maintenance: 'bg-amber-500',
            change_request: 'bg-amber-500'
          };
          const iconSrc = p.icon ? (p.icon.startsWith('http') || p.icon.startsWith('workspace://') ? p.icon : 'workspace://./' + p.icon.replace(/^\.\/+/, '')) : null;
          return (
            <div className="pt-1 flex gap-2 flex-1 min-w-0 min-h-0 overflow-hidden">
              <div className="shrink-0 text-gray-400 w-6 h-6 flex items-center justify-center rounded bg-gray-100 overflow-hidden">
                {iconSrc ? (
                  <img src={iconSrc} alt="" className="w-full h-full object-cover" />
                ) : (
                  <CarIcon className="w-4 h-4" />
                )}
              </div>
              <div className="min-w-0 flex-1 min-h-0 overflow-hidden">
                <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                <p className="text-xs text-gray-500 mt-0 truncate">{formatDate(p.start)} → {formatDate(p.end)}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden min-w-0">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.min(100, progress)}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium text-gray-700 tabular-nums shrink-0">{progress}%</span>
                </div>
                <div className="mt-1">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${statusStyles[displayStatus] || statusStyles.normal}`}>
                    <span className={`h-1 w-1 rounded-full ${statusDot[displayStatus] || statusDot.normal}`} />
                    {statusLabels[displayStatus] || statusLabels.normal}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Field 2 */}
      {field2Categories[safeCat2] === 'rooms' && (sections.meeting_rooms?.image && String(sections.meeting_rooms.image).trim()) ? (
        <div className="rounded-xl border border-gray-200 shadow-sm min-h-0 overflow-hidden relative h-full">
          <img
            src={(sections.meeting_rooms.image.startsWith('http') || sections.meeting_rooms.image.startsWith('workspace://'))
              ? sections.meeting_rooms.image
              : 'workspace://./' + sections.meeting_rooms.image.replace(/^\.\/+/, '')}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          <span className="absolute top-2 right-2 text-[0.65rem] font-medium tabular-nums text-white bg-black/50 backdrop-blur-sm px-2 py-1 rounded">
            {countdown2}s
          </span>
        </div>
      ) : (
      <div className="rounded-xl bg-surface border border-gray-200 shadow-sm px-3 py-2 flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center justify-between mb-1 shrink-0">
          <span className="text-xs uppercase tracking-[0.15em] text-gray-500 truncate">{field2Label}</span>
          {field2Categories[safeCat2] === 'rooms' && (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">Live</span>
              <span className="text-[0.65rem] text-gray-400 tabular-nums">{countdown2}s</span>
            </span>
          )}
          {field2Categories[safeCat2] === 'stock' && (
            <span className="text-[0.65rem] text-gray-400 tabular-nums">{countdown2}s</span>
          )}
        </div>
        {field2Categories[safeCat2] === 'rooms' && (() => {
          const room = MEETING_ROOMS[item2];
          if (!room) return null;
          return (
            <div className="flex-1 min-h-0 overflow-hidden">
              <p className="text-sm font-semibold text-gray-900 truncate">{room.name}</p>
              <p className="text-xs text-gray-500 mt-0 mb-1">Availability today</p>
              <div className="flex flex-wrap gap-1.5 overflow-hidden content-start">
                {(room.slots || []).map((slot) => (
                  <span key={slot} className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                    {slot}
                  </span>
                ))}
              </div>
            </div>
          );
        })()}
        {field2Categories[safeCat2] === 'stock' && (() => {
          const values = STOCK_HISTORY.map((d) => d.value);
          const min = Math.min(...values);
          const max = Math.max(...values);
          const range = max - min || 1;
          const last = values[values.length - 1];
          const prev = values[values.length - 2];
          const trendUp = last >= prev;
          const barMinHeightPct = 15;
          return (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-baseline gap-2 mb-1 shrink-0">
                <span className="text-base font-semibold text-gray-900">{last} €</span>
                <span className={`text-xs font-medium ${trendUp ? 'text-emerald-600' : 'text-red-600'}`}>
                  {trendUp ? '↑' : '↓'} {Math.abs(last - prev)} €
                </span>
              </div>
              <div className="flex items-end gap-1 flex-1 min-h-[4rem] max-h-20">
                {STOCK_HISTORY.map((d) => {
                  const pct = range > 0 ? ((d.value - min) / range) * (100 - barMinHeightPct) + barMinHeightPct : barMinHeightPct;
                  return (
                    <div key={d.month} className="flex-1 flex flex-col items-center justify-end gap-0.5 h-full min-h-0">
                      <div
                        className="w-full rounded-t bg-accent min-h-[6px]"
                        style={{ height: `${pct}%` }}
                      />
                      <span className="text-[0.6rem] text-gray-500 shrink-0">{d.month}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[0.6rem] text-gray-500 mt-1 shrink-0">Last quarter (EUR)</p>
            </div>
          );
        })()}
      </div>
      )}
    </div>
  );
}
