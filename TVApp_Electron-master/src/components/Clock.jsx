import React, { useEffect, useState } from 'react';

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatSeconds(date) {
  return date.toLocaleTimeString([], { second: '2-digit' });
}

function formatDate(date) {
  return date.toLocaleDateString([], {
    weekday: 'long',
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  });
}

// Sibiu ~45.79°N – aproximare simplă răsărit/apus
function getSunriseSunset(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const n = Math.floor((date - start) / 86400000);
  const t = (2 * Math.PI * (n - 80)) / 365;
  const rise = 6.5 - 2 * Math.sin(t);
  const set = 17.5 + 2 * Math.sin(t);
  const riseDate = new Date(date);
  riseDate.setHours(Math.floor(rise), Math.floor((rise % 1) * 60), 0, 0);
  const setDate = new Date(date);
  setDate.setHours(Math.floor(set), Math.floor((set % 1) * 60), 0, 0);
  return {
    sunrise: riseDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    sunset: setDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
}

function getWorkMode(now) {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h >= 6 && h < 9) return { label: 'Flex Time', subtext: 'Flexible Schedule', color: 'green' };
  if (h >= 9 && h < 15) return { label: 'Core Time', subtext: 'Presence Required', color: 'red' };
  if (h >= 15 && h < 22) return { label: 'Flex Time', subtext: 'Flexible Schedule', color: 'green' };
  return { label: 'Office Closed', subtext: null, color: 'blue' };
}

const modeStyles = {
  green: {
    badge: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    dot: 'bg-emerald-500',
    time: 'text-emerald-600'
  },
  red: {
    badge: 'bg-red-50 border-red-200 text-red-800',
    dot: 'bg-red-500',
    time: 'text-red-600'
  },
  blue: {
    badge: 'bg-blue-50 border-blue-200 text-blue-800',
    dot: 'bg-blue-500',
    time: 'text-blue-600'
  }
};

function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = formatTime(now);
  const seconds = formatSeconds(now);
  const date = formatDate(now);
  const mode = getWorkMode(now);
  const styles = modeStyles[mode.color];
  const { sunrise, sunset } = getSunriseSunset(now);

  return (
    <div className="w-full flex flex-col gap-3 min-h-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs uppercase tracking-[0.2em] text-gray-500">Current time</span>
          <div className={`flex items-baseline gap-2 tabular-nums ${styles.time}`}>
            <span className="text-4xl xl:text-5xl font-light">{time}</span>
            <span className="text-lg align-bottom">{seconds}</span>
          </div>
          <span className="text-xs text-gray-500">{date}</span>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[0.65rem] uppercase tracking-[0.2em] text-gray-500">WORK MODE</span>
          <div className={`inline-flex flex-col items-end gap-0 px-2.5 py-1.5 rounded-lg border text-xs font-medium ${styles.badge}`}>
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
              {mode.label}
            </span>
            {mode.subtext && <span className="text-[0.65rem] opacity-90">{mode.subtext}</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between text-[0.7rem] text-gray-600 pt-1 border-t border-gray-100">
        <span>Sunrise {sunrise}</span>
        <span>Sunset {sunset}</span>
      </div>
    </div>
  );
}

export default Clock;
