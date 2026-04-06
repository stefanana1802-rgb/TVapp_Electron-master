import React, { useState, useEffect } from 'react';

const TRAFFIC_ORIGIN = 'Aumovio Sibiu - Strada Salzburg';
const TRAFFIC_DESTINATIONS_MOCK = [
  { destination: 'Centru Sibiu', minutes: 12, status: 'normal' },
  { destination: 'Doamna Stanca Sibiu', minutes: 8, status: 'busy' },
  { destination: 'Vasile Aron Sibiu', minutes: 15, status: 'very_busy' }
];

/** Only between 15:00 and 18:00 show traffic; outside this window show canteen & restaurant and no API call.
 * Overridable via .env: CANTEEN_ALWAYS_SHOW=1 (always canteen) or TRAFFIC_ALWAYS_SHOW=1 (always traffic).
 * If both 1, canteen wins. If both 0 or missing, use time window. */
function useShowTraffic() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(id);
  }, []);
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = 15 * 60;   // 15:00
  const end = 18 * 60;     // 18:00
  return mins >= start && mins < end;
}

const CANTEEN_SLOTS_DEFAULT = [
  { time: '10:30', duration: '15 min' },
  { time: '11:30', duration: '15 min' }
];

const STATUS_LABELS = { normal: 'Normal', busy: 'Busy', very_busy: 'Very busy' };
const STATUS_STYLES = {
  normal: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  busy: 'bg-amber-100 text-amber-800 border-amber-200',
  very_busy: 'bg-red-100 text-red-800 border-red-200',
  unknown: 'bg-gray-100 text-gray-600 border-gray-200'
};

function TrafficView({ trafficFallback }) {
  const fallbackRoutes = trafficFallback?.destinations && Array.isArray(trafficFallback.destinations)
    ? trafficFallback.destinations
    : TRAFFIC_DESTINATIONS_MOCK;
  const fallbackOrigin = trafficFallback?.origin || TRAFFIC_ORIGIN;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const result = window.api?.getTrafficData
          ? await window.api.getTrafficData()
          : { origin: fallbackOrigin, routes: fallbackRoutes };
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setData({ origin: fallbackOrigin, routes: fallbackRoutes });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 20 * 60 * 1000); // refresh every 20 min
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="p-2 rounded-lg bg-gray-50 border border-gray-100">
        <p className="text-xs text-gray-500">Loading traffic…</p>
      </div>
    );
  }
  const routes = data?.routes ?? fallbackRoutes;
  const origin = data?.origin ?? fallbackOrigin;
  const isLive = data?.isLive ?? false;

  return (
    <div className="w-full flex flex-col gap-2">
      <span className="text-xs uppercase tracking-[0.15em] text-gray-500 truncate">
        Traffic to city
      </span>
      <div className="p-2 rounded-md bg-gray-50 border border-gray-100">
        <p className="text-[0.65rem] text-gray-500 mt-0 mb-1">From {origin}</p>
        <div className="space-y-1.5">
          {routes.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-1.5">
              <span className="text-sm font-semibold text-gray-900 truncate">{r.destination}</span>
              <span className="shrink-0 text-xs tabular-nums text-gray-600">
                {r.minutes != null ? `${r.minutes} min` : '—'}
              </span>
              <span className={`shrink-0 px-2 py-0.5 rounded border text-xs font-medium ${STATUS_STYLES[r.status] ?? STATUS_STYLES.unknown}`}>
                {STATUS_LABELS[r.status] ?? '—'}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[0.65rem] text-gray-400 mt-1">
          {isLive ? 'Live' : 'Info'} · updates every 20 min
        </p>
      </div>
    </div>
  );
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function CanteenRestaurantBlock({ canteenMenu: canteenFromWorkspace, traffic: trafficFromWorkspace, menuLoadFailed }) {
  const showTrafficByTime = useShowTraffic();
  const [envFlags, setEnvFlags] = useState({ canteenAlwaysShow: false, trafficAlwaysShow: false });
  useEffect(() => {
    if (window.api?.getAppEnvFlags) {
      window.api.getAppEnvFlags().then((flags) => {
        if (flags && typeof flags === 'object') setEnvFlags(flags);
      }).catch(() => {});
    }
  }, []);
  const showTraffic = envFlags.canteenAlwaysShow ? false : (envFlags.trafficAlwaysShow ? true : showTrafficByTime);
  if (showTraffic) {
    return <TrafficView trafficFallback={trafficFromWorkspace} />;
  }
  const slots = (canteenFromWorkspace?.slots && Array.isArray(canteenFromWorkspace.slots)) ? canteenFromWorkspace.slots : CANTEEN_SLOTS_DEFAULT;
  const feedbackText = (canteenFromWorkspace?.feedbackText || '').trim() ||
    'Spune-ne ce părere ai despre conținutul de pe ecran și ce ai vrea să vezi în plus.';
  const feedbackUrl = (canteenFromWorkspace?.feedbackUrl || '').trim();
  const feedbackQrPath = (canteenFromWorkspace?.feedbackQrPath || '').trim();
  const feedbackQrSrc = feedbackQrPath
    ? (feedbackQrPath.startsWith('workspace://') ? feedbackQrPath : 'workspace://./' + feedbackQrPath.replace(/^\.\/+/, ''))
    : null;

  return (
    <div className="w-full flex flex-col gap-1.5 min-h-0 overflow-hidden">
      <div className="flex items-start justify-between gap-2 shrink-0">
        <span className="text-xs uppercase tracking-[0.15em] text-gray-500 truncate min-w-0">
          Canteen & Feedback
        </span>
      </div>
      <div className="p-2 rounded-md bg-gray-50 border border-gray-100 shrink-0">
        <p className="text-sm font-semibold text-gray-900 mb-0 flex items-center gap-1.5 flex-wrap">
          Canteen Menu
          {menuLoadFailed && (
            <span className="text-xs font-medium text-red-600" title="Meniul PDF nu s-a putut încărca la ora programată.">
              Fail loading
            </span>
          )}
        </p>
        <p className="text-[0.65rem] text-gray-500 mt-0 mb-1 leading-snug">
          {slots.map((s) => `${s.time} (${typeof s.duration === 'number' ? s.duration + ' min' : (s.duration || '15 min')})`).join(' · ')}
        </p>
      </div>
      <div className="p-2 rounded-md bg-amber-50 border border-amber-100 flex items-center gap-2 shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900">Feedback</p>
          <p className="text-[0.65rem] text-gray-700 mt-0 mb-0 leading-snug">
            {feedbackText}
            {feedbackUrl && (
              <>
                <br />
                <span className="underline break-all">{feedbackUrl}</span>
              </>
            )}
          </p>
        </div>
        {feedbackQrSrc && (
          <div className="shrink-0 flex items-center justify-center">
            <img
              src={feedbackQrSrc}
              alt="Feedback QR"
              className="w-14 h-14 object-contain"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default CanteenRestaurantBlock;
