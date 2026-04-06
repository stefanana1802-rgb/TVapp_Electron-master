import React, { useEffect, useState, useRef, useCallback } from 'react';
import Slide from './Slide.jsx';
import { getSlideDisplay } from '../utils/slideUtils.js';

/**
 * Props:
 * - slides: array of { id, type, src, duration, title?, subtitle? }
 * YouTube/Vimeo: redare în fereastră Electron separată (evită Error 153).
 */
function SlidePlayer({ slides, msalSessionVersion = 0, msalCanLoadPowerBi = false, paused = false }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loopCount, setLoopCount] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [slideStartTime, setSlideStartTime] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [displayKey, setDisplayKey] = useState(0);
  const timerRef = useRef(null);
  const slideContainerRef = useRef(null);
  const prevPausedRef = useRef(paused);

  const currentSlide = slides && slides[currentIndex];
  const displayType = currentSlide ? (() => {
    try {
      return getSlideDisplay(currentSlide).type;
    } catch (e) {
      console.error('[SlidePlayer] getSlideDisplay error:', e);
      return 'image';
    }
  })() : null;
  /** La playlist cu 1 slide, bucla remonta tot Slide-ul (loopCount++) → iframe web se reîncarcă mereu. Pentru web_live / web_action / powerbi păstrăm montarea. */
  const singleSlidePersistWeb =
    slides &&
    slides.length <= 1 &&
    currentSlide &&
    ['web_live', 'web_action', 'powerbi'].includes(displayType || '');
  const isVideoExternal = displayType === 'youtube' || displayType === 'vimeo';

  // Înălțimea barei de progres (counter + progress bar) ca Power BI să nu o acopere
  const POWERBI_COUNTER_BAR_HEIGHT = 24;

  const getPowerBiBounds = useCallback(() => {
    const r = slideContainerRef.current?.getBoundingClientRect();
    if (!r) return null;
    const h = Math.max(0, r.height - POWERBI_COUNTER_BAR_HEIGHT);
    return { x: r.left, y: r.top, width: r.width, height: h };
  }, []);

  const handlePowerBiShow = useCallback((url, options) => {
    setTimeout(() => {
      const b = getPowerBiBounds();
      if (b && window.api?.powerbiShow) {
        window.api.powerbiShow(url, b, options);
      } else if (window.api?.powerbiShow) {
        window.api.powerbiShow(url, undefined, options);
      }
    }, 50);
  }, [getPowerBiBounds]);

  const handleWebActionShow = useCallback((url, webActionFit) => {
    const opts = { webActionFit: Math.max(25, Math.min(500, Number(webActionFit) || 100)) };
    setTimeout(() => {
      const b = getPowerBiBounds();
      if (b && window.api?.webActionShow) {
        window.api.webActionShow(url, b, opts);
      } else if (window.api?.webActionShow) {
        window.api.webActionShow(url, undefined, opts);
      }
    }, 50);
  }, [getPowerBiBounds]);

  useEffect(() => {
    if (displayType !== 'powerbi' || !msalCanLoadPowerBi || !window.api?.onPowerBiRequestBounds) return;
    const unsub = window.api.onPowerBiRequestBounds(() => {
      const b = getPowerBiBounds();
      if (b && window.api?.powerbiSetBounds) {
        window.api.powerbiSetBounds(b);
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [displayType, msalCanLoadPowerBi, getPowerBiBounds]);

  useEffect(() => {
    if (displayType !== 'web_action' || !window.api?.onWebActionRequestBounds) return;
    const unsub = window.api.onWebActionRequestBounds(() => {
      const b = getPowerBiBounds();
      if (b && window.api?.webActionSetBounds) {
        window.api.webActionSetBounds(b);
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [displayType, getPowerBiBounds]);
  const isDocImages =
    ['pptx', 'word', 'excel'].includes(displayType) ||
    (displayType === 'web_url' && currentSlide?.converted) ||
    (displayType === 'pdf' && currentSlide?.converted);
  const usesInternalDone = isDocImages;
  const durationSeconds = Math.max(1, Number(currentSlide?.duration || 10));
  const durationMs = isDocImages
    ? (currentSlide?.pageCount ?? 1) * durationSeconds * 1000
    : durationSeconds * 1000;
  const cooldownPercent = Math.max(0, Math.min(100, 100 - (elapsed / durationMs) * 100));

  const scheduleNextSlide = () => {
    timerRef.current = setTimeout(goNext, durationMs);
  };

  const goNext = () => {
    if (!slides || slides.length <= 1) {
      setLoopCount((c) => c + 1);
      setSlideStartTime(Date.now());
      setElapsed(0);
      if (timerRef.current) clearTimeout(timerRef.current);
      scheduleNextSlide();
      return;
    }
    setIsVisible(false);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % slides.length);
      setDisplayKey((k) => k + 1);
      setIsVisible(true);
    }, 700);
  };

  useEffect(() => {
    if (!currentSlide) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    if (paused) return;

    if (isVideoExternal && typeof window !== 'undefined' && window.api?.openVideoSlide) {
      window.api.openVideoSlide({ url: currentSlide.src, durationMs });
      const unsub = window.api.onVideoSlideDone(goNext);
      return () => unsub?.();
    }

    setSlideStartTime(Date.now());
    setElapsed(0);
    if (!usesInternalDone) scheduleNextSlide();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, slides.length, currentSlide?.duration, currentSlide?.src, isVideoExternal, usesInternalDone, paused]);

  useEffect(() => {
    if (paused && timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const wasPaused = prevPausedRef.current;
    prevPausedRef.current = paused;
    if (wasPaused && !paused) {
      setCurrentIndex(0);
      setDisplayKey((k) => k + 1);
      setSlideStartTime(Date.now());
      setElapsed(0);
      setIsVisible(true);
    }
  }, [paused]);

  // Cooldown bar: update elapsed la 500ms (reduce CPU vs 200ms); nu avansa cand paused
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setElapsed(Date.now() - slideStartTime);
    }, 500);
    return () => clearInterval(id);
  }, [slideStartTime, currentIndex, paused]);

  // Reset to first slide when slides list changes significantly
  useEffect(() => {
    setCurrentIndex(0);
  }, [JSON.stringify(slides.map((s) => s.id))]);

  return (
    <div className="w-full h-full relative bg-gray-100">
      <div
        ref={slideContainerRef}
        className={`absolute inset-0 transition-opacity duration-700 ease-in-out ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <Slide
          key={
            slides && slides.length <= 1
              ? singleSlidePersistWeb
                ? `persist-web-${currentSlide.id || currentSlide.src || 'slide'}`
                : `loop-${loopCount}`
              : `${currentIndex}-${displayKey}`
          }
          slide={currentSlide}
          onSlideDone={usesInternalDone ? goNext : undefined}
          displayKey={displayKey}
          msalSessionVersion={msalSessionVersion}
          msalCanLoadPowerBi={msalCanLoadPowerBi}
          onPowerBiShow={handlePowerBiShow}
          onWebActionShow={handleWebActionShow}
        />
      </div>

      {/* Counter peste Power BI: z-index ridicat + fundal 60% opacitate */}
      <div className="absolute bottom-0 left-0 right-0 z-20 px-2 pb-1 pt-1 bg-black/60 pointer-events-none">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className="text-[0.5rem] text-white/95 tabular-nums drop-shadow-md">
            {Math.max(0, Math.ceil((durationMs - elapsed) / 1000))}s
          </span>
          <span className="text-[0.5rem] text-white/90 drop-shadow-md">
            {currentIndex + 1} / {slides.length}
          </span>
        </div>
        <div className="h-0.5 w-full rounded-full bg-white/30 overflow-hidden">
          <div
            className="h-full rounded-full bg-white/90 transition-[width] duration-200 ease-linear"
            style={{ width: `${cooldownPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default SlidePlayer;

