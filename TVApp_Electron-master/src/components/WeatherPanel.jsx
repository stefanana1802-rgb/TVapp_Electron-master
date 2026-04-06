import React, { useState, useEffect } from 'react';
import { fetchWeather } from '../utils/weather.js';

const ANNOUNCEMENTS_DEFAULT = [
  'Quarterly town hall today at 16:00, Sky Auditorium – all teams invited.',
  'New security badges required from next week. Collect at reception.',
  'Building maintenance: elevators B block on Saturday 08:00–12:00.',
  'Canteen closed Friday 14:00–16:00 for staff event.',
  'Reminder: Please update your project hours in the booking system by EOD.'
];

const REFRESH_MS = 15 * 60 * 1000; // 15 min

function toAnnouncementItem(raw) {
  if (typeof raw === 'string' && raw.trim()) return { text: raw.trim(), color: '', bold: false };
  if (raw && typeof raw === 'object') {
    const text = String(raw.text ?? raw.content ?? raw.body ?? raw.title ?? '').trim();
    const color = (raw.color && typeof raw.color === 'string') ? raw.color.trim() : '';
    const bold = Boolean(raw.bold);
    return { text, color, bold };
  }
  return { text: '', color: '', bold: false };
}

function WeatherPanel({ announcements: announcementsFromWorkspace }) {
  const rawItems = (announcementsFromWorkspace?.items && Array.isArray(announcementsFromWorkspace.items))
    ? announcementsFromWorkspace.items
    : ANNOUNCEMENTS_DEFAULT.map((t) => ({ text: t, color: '', bold: false }));
  const ANNOUNCEMENTS = (() => {
    const normalized = rawItems.map(toAnnouncementItem).filter((a) => a.text);
    return normalized.length > 0 ? normalized : ANNOUNCEMENTS_DEFAULT.map((t) => ({ text: t, color: '', bold: false }));
  })();
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchWeather();
        if (!cancelled) {
          setWeather(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          setWeather(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const cooldownSeconds = Math.max(5, Math.min(3600, Number(announcementsFromWorkspace?.cooldownSeconds) || 120));
  const COOLDOWN_MS = cooldownSeconds * 1000;
  const visibleCount = 1;
  const [announcementIndex, setAnnouncementIndex] = useState(0);
  const [cooldownStart, setCooldownStart] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const e = now - cooldownStart;
      setElapsed(e);
      if (e >= COOLDOWN_MS) {
        setAnnouncementIndex((i) => (i + visibleCount) % Math.max(1, ANNOUNCEMENTS.length));
        setCooldownStart(now);
        setElapsed(0);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [cooldownStart, COOLDOWN_MS]);

  const cooldownPercent = Math.max(0, Math.min(100, 100 - (elapsed / COOLDOWN_MS) * 100));
  const visibleAnnouncements = Array.from({ length: visibleCount }, (_, k) => {
    const idx = (announcementIndex + k) % ANNOUNCEMENTS.length;
    const item = ANNOUNCEMENTS[idx] || { text: '', color: '', bold: false };
    return { id: `${announcementIndex}-${k}`, ...item };
  });

  const details = weather
    ? [
        { label: 'Humidity', value: weather.humidity },
        { label: 'Wind', value: weather.wind },
        { label: 'UV Index', value: weather.uvIndex }
      ]
    : [
        { label: 'Humidity', value: '—' },
        { label: 'Wind', value: '—' },
        { label: 'UV Index', value: '—' }
      ];

  return (
    <div className="w-full flex flex-col min-h-0 overflow-hidden">
      <div className="shrink-0 flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-1">
        <div className="flex flex-col gap-0 min-w-0">
          <span className="text-xs uppercase tracking-[0.2em] font-light text-gray-500">Local weather</span>
          <span className="text-sm font-medium text-gray-700 truncate">
            {weather?.location ?? 'Aumovio Sibiu - Strada Salzburg'}
          </span>
        </div>
        <div className="h-10 w-10 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center text-xl shrink-0">
          {weather?.icon ?? '☀'}
        </div>
      </div>

      {loading && !weather && !error && (
        <p className="text-[0.6rem] text-gray-500 shrink-0">Loading…</p>
      )}
      {error && !weather && (
        <p className="text-[0.6rem] text-amber-700 shrink-0">Weather unavailable.</p>
      )}
      {weather && (
        <>
          <div className="flex items-end gap-1.5 shrink-0">
            <span className="text-2xl font-light tabular-nums text-gray-900">{weather.temperature}</span>
            <div className="flex flex-col gap-0">
              <span className="text-sm font-medium text-gray-800">{weather.condition}</span>
              <span className="text-xs text-gray-500">{weather.feelsLike}</span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5 shrink-0">
            {(weather.next4Hours || []).map((h) => (
              <div key={h.time} className="rounded border border-gray-200 bg-gray-50 px-1.5 py-1 flex flex-col items-center gap-0.5">
                <span className="text-[0.65rem] text-gray-500">{h.time}</span>
                <span className="text-base">{h.icon}</span>
                <span className="text-xs font-semibold text-gray-800">{h.temp}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-1.5 shrink-0">
            {details.map((item) => (
              <div key={item.label} className="rounded border border-gray-200 bg-gray-50 px-1.5 py-1 flex flex-col items-center justify-center min-h-0">
                <span className="text-[0.6rem] uppercase text-gray-500">{item.label}</span>
                <p className="text-xs font-medium text-gray-800">{item.value}</p>
              </div>
            ))}
          </div>
        </>
      )}
      </div>

      <div className="border-t border-gray-100 pt-3 flex-1 min-h-0 flex flex-col mt-1.5">
        <div className="flex items-center justify-between gap-2 mb-1 shrink-0">
          <span className="text-xs uppercase tracking-[0.15em] font-semibold text-gray-600">Announcements</span>
          <span className="text-[0.6rem] text-gray-400 tabular-nums">{Math.ceil((COOLDOWN_MS - elapsed) / 1000)}s</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden mb-2 shrink-0">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear"
            style={{ width: `${cooldownPercent}%` }}
          />
        </div>
        <div className="flex-1 min-h-[4.5rem] flex flex-col gap-1.5 overflow-y-auto pt-0.5">
          {visibleAnnouncements.map((a) => {
            const raw = (a.text || '').trim();
            const html = raw || '—';
            const style = {};
            if (a.color && /^#[0-9A-Fa-f]{6}$/.test(a.color)) style.color = a.color;
            if (a.bold) style.fontWeight = 'bold';
            return (
              <div
                key={a.id}
                className={'text-sm font-medium leading-snug announcement-html shrink-0' + (!style.color ? ' text-gray-800' : '')}
                style={Object.keys(style).length ? style : undefined}
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default WeatherPanel;
