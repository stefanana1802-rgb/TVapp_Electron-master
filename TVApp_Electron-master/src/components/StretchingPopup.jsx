import React, { useEffect, useRef, useState } from 'react';

/** Parse duration from dashboard (e.g. "10 min", "5 min", "2", "15") → milliseconds. Default 10 min. */
function parseDurationToMs(str) {
  if (!str || typeof str !== 'string') return 10 * 60 * 1000;
  const s = str.trim();
  const num = parseInt(s.replace(/\D/g, ''), 10);
  if (Number.isNaN(num) || num < 1) return 10 * 60 * 1000;
  return num * 60 * 1000;
}

/** Parse duration to seconds (for counter). */
function parseDurationToSec(str) {
  return Math.floor(parseDurationToMs(str) / 1000);
}

/** Check if current time matches scheduled time. Content.json stores 24h (e.g. "04:48" = 4:48 AM). */
function isTimeMatch(scheduledTime, now) {
  if (!scheduledTime || typeof scheduledTime !== 'string') return false;
  const s = scheduledTime.trim();
  const parts = s.split(':');
  const h = parseInt(parts[0], 10);
  const m = parts[1] != null ? parseInt(parts[1], 10) : 0;
  if (Number.isNaN(h) || h < 0 || h > 23 || Number.isNaN(m) || m < 0 || m > 59) return false;
  return now.getHours() === h && now.getMinutes() === m;
}

/** Slot key for "already closed this slot" (e.g. "2026-02-17_10_30"). */
function getSlotKey(now, timeStr) {
  const d = now && now instanceof Date ? now : new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const t = (timeStr || '').trim().replace(':', '_');
  return `${y}-${mo}-${day}_${t}`;
}

export default function StretchingPopup({ sections, now: appNow, onClose, onVisibleChange }) {
  const [visible, setVisibleState] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const videoRef = useRef(null);
  const closeTimerRef = useRef(null);
  const closedForSlotRef = useRef(null);

  const setVisible = (next) => {
    setVisibleState(next);
    if (typeof onVisibleChange === 'function') onVisibleChange(!!next);
  };

  useEffect(() => {
    const stretching = sections?.stretching?.items?.[0];
    if (!stretching?.video || !stretching?.time || !stretching?.duration) return;
    const current = appNow && appNow instanceof Date ? appNow : new Date();
    if (!isTimeMatch(stretching.time, current)) {
      closedForSlotRef.current = null;
      return;
    }
    const slotKey = getSlotKey(current, stretching.time);
    if (closedForSlotRef.current === slotKey) return;
    setVisible(true);
  }, [sections?.stretching?.items, appNow]);

  useEffect(() => {
    if (!visible) return;
    const stretching = sections?.stretching?.items?.[0];
    if (stretching?.duration) setSecondsRemaining(parseDurationToSec(stretching.duration));
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const stretching = sections?.stretching?.items?.[0];
    const durationMs = parseDurationToMs(stretching?.duration);

    closeTimerRef.current = setTimeout(() => {
      const s = sections?.stretching?.items?.[0];
      if (s?.time) {
        const current = appNow && appNow instanceof Date ? appNow : new Date();
        closedForSlotRef.current = getSlotKey(current, s.time);
      }
      setVisible(false);
      if (typeof onClose === 'function') onClose();
    }, durationMs);

    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => {
      setSecondsRemaining((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [visible]);

  if (!visible) return null;

  const stretching = sections?.stretching?.items?.[0];
  if (!stretching?.video) return null;

  const videoSrc = stretching.video.startsWith('http') || stretching.video.startsWith('workspace://')
    ? stretching.video
    : 'workspace://./' + stretching.video.replace(/^\.\/+/, '');

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black"
      style={{ zIndex: 9999 }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <video
          ref={videoRef}
          src={videoSrc}
          className="w-full h-full object-fill bg-black"
          autoPlay
          playsInline
          loop
        />
      </div>
      <div className="absolute top-4 left-4 z-10 px-4 py-2 bg-black/90 rounded-md">
        <p className="text-white text-2xl font-semibold leading-tight">
          Stretching Time – {secondsRemaining} sec
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
          const s = sections?.stretching?.items?.[0];
          if (s?.time) {
            const current = appNow && appNow instanceof Date ? appNow : new Date();
            closedForSlotRef.current = getSlotKey(current, s.time);
          }
          setVisible(false);
          if (typeof onClose === 'function') onClose();
        }}
        className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-xl leading-none z-10"
        aria-label="Închide"
      >
        ×
      </button>
    </div>
  );
}
