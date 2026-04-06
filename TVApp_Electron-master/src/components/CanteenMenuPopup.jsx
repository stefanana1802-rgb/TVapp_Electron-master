import React, { useEffect, useRef, useState } from 'react';

const FOLDER_PATH = 'canteen_menu/menu_pdf';
const PER_IMAGE_MS = 4 * 60 * 1000; // 4 minutes per image
const PER_IMAGE_SEC = PER_IMAGE_MS / 1000;

/**
 * Fullscreen popup: slideshow of images from canteen menu PDF folder.
 * Each image 4 min; popup closes after durationMinutes (from dashboard slot).
 */
export default function CanteenMenuPopup({ visible, durationMinutes, onClose }) {
  const [images, setImages] = useState([]);
  const [index, setIndex] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(PER_IMAGE_SEC);
  const closeTimerRef = useRef(null);
  const slideTimerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!visible || typeof window === 'undefined' || !window.api?.getWorkspaceFolderImages) {
      setImages([]);
      setIndex(0);
      return;
    }
    let cancelled = false;
    window.api.getWorkspaceFolderImages(FOLDER_PATH).then((list) => {
      if (!cancelled) {
        setImages(list);
        setIndex(0);
        setSecondsRemaining(PER_IMAGE_SEC);
      }
    });
    return () => { cancelled = true; };
  }, [visible]);

  // Close after duration (e.g. 15 min) – nu depinde de onClose ca timeout-ul să nu fie resetat la fiecare render
  useEffect(() => {
    if (!visible || durationMinutes == null || durationMinutes < 1) return;
    const durationMs = durationMinutes * 60 * 1000;
    closeTimerRef.current = setTimeout(() => {
      if (typeof onCloseRef.current === 'function') onCloseRef.current();
    }, durationMs);
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [visible, durationMinutes]);

  // Advance slide every 4 minutes
  useEffect(() => {
    if (!visible || images.length === 0) return;
    slideTimerRef.current = setInterval(() => {
      setIndex((i) => (i >= images.length - 1 ? i : i + 1));
    }, PER_IMAGE_MS);
    return () => {
      if (slideTimerRef.current) clearInterval(slideTimerRef.current);
    };
  }, [visible, images.length]);

  // La schimbarea slide-ului (sau la deschidere) resetează counterul la 240 sec
  useEffect(() => {
    if (!visible) return;
    setSecondsRemaining(PER_IMAGE_SEC);
  }, [visible, index]);

  // Tick countdown la fiecare secundă
  useEffect(() => {
    if (!visible || images.length === 0) return;
    const t = setInterval(() => {
      setSecondsRemaining((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [visible, images.length, index]);

  if (!visible) return null;

  const currentSrc = images[index];
  const hasImages = images.length > 0;
  const displaySec = index < images.length ? secondsRemaining : 0;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black"
      style={{ zIndex: 2147483647 }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        {hasImages && currentSrc ? (
          <img
            key={currentSrc}
            src={currentSrc}
            alt=""
            className="w-full h-full object-fill bg-black"
          />
        ) : (
          <p className="text-white/80 text-lg">Meniul zilei – nu există imagini.</p>
        )}
      </div>
      <div className="absolute top-4 left-4 z-10 px-4 py-2 bg-black/90 rounded-md">
        <p className="text-white text-2xl font-semibold leading-tight">
          Canteen Menu – {displaySec} sec
        </p>
      </div>
      <button
        type="button"
        onClick={() => typeof onClose === 'function' && onClose()}
        className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-xl leading-none z-10"
        aria-label="Închide"
      >
        ×
      </button>
    </div>
  );
}
