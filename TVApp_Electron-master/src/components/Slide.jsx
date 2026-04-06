import React, { useRef, useEffect, useState, useMemo } from 'react';
import Hls from 'hls.js';
import { getSlideDisplay } from '../utils/slideUtils.js';
import {
  FLIGHTBOARD_SIMPLEVIEW_IFRAME_SCALE,
  isFlightboardSimpleViewPlaybackUrl
} from '../utils/flightboardUtils.js';

function PowerBiWebview({ src }) {
  const [loadSrc, setLoadSrc] = useState('');
  const webviewRef = useRef(null);
  useEffect(() => {
    setLoadSrc('');
    const t = setTimeout(() => setLoadSrc(src), 400);
    return () => clearTimeout(t);
  }, [src]);
  useEffect(() => {
    return () => {
      if (webviewRef.current && typeof webviewRef.current.src !== 'undefined') webviewRef.current.src = 'about:blank';
    };
  }, []);
  return (
    <webview
      ref={webviewRef}
      partition="persist:powerbi"
      src={loadSrc || 'about:blank'}
      className="w-full h-full block"
      style={{ minHeight: '100%' }}
    />
  );
}

function PowerBiBrowserViewSlide({ url, onShow, powerBiFit = 100, duration, powerBiAutoScroll = true, powerBiApplyLoginScript = true }) {
  useEffect(() => {
    if (!url || !onShow) return;
    const fit = Math.max(50, Math.min(500, Number(powerBiFit) || 100));
    const opts = { powerBiFit: fit };
    if (typeof duration === 'number' && duration >= 1) opts.duration = duration;
    opts.powerBiAutoScroll = powerBiAutoScroll === true;
    opts.powerBiApplyLoginScript = powerBiApplyLoginScript !== false;
    const t = setTimeout(() => onShow(url, opts), 300);
    return () => {
      clearTimeout(t);
      window.api?.powerbiHide?.();
    };
  }, [url, onShow, powerBiFit, duration, powerBiAutoScroll, powerBiApplyLoginScript]);
  return <div className="w-full h-full bg-black" aria-hidden="true" />;
}

function WebLiveSlide({ src, title, fit, scale, displayKey, commonOverlay, webLiveAutoScroll, webLiveApplyLoginScript, durationSec }) {
  useEffect(() => {
    window.api?.webLiveScrollStart?.({
      duration: durationSec,
      applyLoginScript: webLiveApplyLoginScript,
      autoScroll: webLiveAutoScroll && durationSec >= 1
    });
    return () => { window.api?.webLiveScrollStop?.(); };
  }, [webLiveAutoScroll, webLiveApplyLoginScript, durationSec]);
  return (
    <div className="w-full h-full relative bg-black overflow-hidden">
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: `${fit}%`,
          height: `${fit}%`,
          transform: `scale(${scale})`
        }}
      >
        <iframe
          key={`web_live_${displayKey}`}
          src={src}
          title={title || 'Web live'}
          className="w-full h-full border-0 block"
          style={{ pointerEvents: 'none' }}
          allow="fullscreen; clipboard-read; clipboard-write"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      {commonOverlay}
    </div>
  );
}

/**
 * web_action: BrowserView în procesul principal (nu iframe), aceeași zonă de bounds ca Power BI.
 * Automatizarea rulează pe webContents-ul acelui view (partition persist:webaction).
 */
function WebActionSlide({
  src,
  webActionFit,
  commonOverlay,
  webActionApplyLoginScript,
  webActionAutoScroll,
  webActionHardLoadEnabled,
  webActionHardLoadSeconds,
  webActionScripts,
  durationSec,
  onWebActionShow
}) {
  const scriptsKey = JSON.stringify(Array.isArray(webActionScripts) ? webActionScripts : []);
  const hardLoadSec = Math.max(0, Math.min(600, Number(webActionHardLoadSeconds) || 0));
  const scriptsNorm = useMemo(
    () => (Array.isArray(webActionScripts) ? webActionScripts.map((s) => String(s || '').trim()).filter(Boolean) : []),
    [scriptsKey]
  );
  const webActionAutomationSig = useMemo(
    () =>
      JSON.stringify({
        duration: durationSec,
        url: typeof src === 'string' ? src.trim() : '',
        login: webActionApplyLoginScript === true,
        scroll: webActionAutoScroll === true,
        hardEn: webActionHardLoadEnabled === true,
        hardSec: hardLoadSec,
        scriptsKey
      }),
    [
      durationSec,
      src,
      webActionApplyLoginScript,
      webActionAutoScroll,
      webActionHardLoadEnabled,
      hardLoadSec,
      scriptsKey
    ]
  );

  useEffect(() => {
    window.api?.webActionStop?.();
    window.api?.webActionStart?.({
      duration: durationSec,
      webActionApplyLoginScript: webActionApplyLoginScript === true,
      webActionAutoScroll: webActionAutoScroll === true,
      webActionHardLoadEnabled: webActionHardLoadEnabled === true,
      webActionHardLoadSeconds: hardLoadSec,
      webActionScripts: scriptsNorm
    });
    return () => {
      window.api?.webActionStop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- semnătura webActionAutomationSig agregă aceste câmpuri
  }, [webActionAutomationSig]);

  useEffect(() => {
    if (!src || !onWebActionShow) return;
    const t = setTimeout(() => onWebActionShow(src), 300);
    return () => {
      clearTimeout(t);
      window.api?.webActionHide?.();
    };
  }, [src, onWebActionShow]);

  return (
    <div className="w-full h-full relative bg-black overflow-hidden min-h-0 min-w-0" aria-hidden="true">
      {commonOverlay}
    </div>
  );
}

function Slide({
  slide,
  onSlideDone,
  displayKey = 0,
  msalSessionVersion = 0,
  msalCanLoadPowerBi = false,
  onPowerBiShow,
  onWebActionShow
}) {
  if (!slide) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-200">
        <p className="text-gray-600">No slide to display.</p>
      </div>
    );
  }

  const { type, src } = getSlideDisplay(slide);
  const { title, subtitle } = slide;

  const commonOverlay = (
    <div className="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-black/80 via-black/0 to-transparent flex flex-col gap-2 pointer-events-none">
      {title && <h2 className="text-3xl font-semibold text-white drop-shadow">{title}</h2>}
      {subtitle && <p className="text-lg text-gray-200 drop-shadow">{subtitle}</p>}
    </div>
  );

  if (type === 'image') {
    const objectFit = slide.fillWidth ? 'object-fill' : 'object-contain';
    return (
      <div className="w-full h-full relative bg-black">
        <img key={src} src={src} alt={title || 'Slide'} className={`w-full h-full ${objectFit} bg-black`} />
        {commonOverlay}
      </div>
    );
  }

  if (type === 'video') {
    return (
      <VideoSlide src={src} sound={slide.videoSound === true} title={title} subtitle={subtitle} />
    );
  }

  if (type === 'hls') {
    return <HlsSlide src={src} sound={slide.hlsSound === true} title={title} subtitle={subtitle} />;
  }

  if (type === 'pdf' && slide.converted && slide.src) {
    return (
      <DocumentImagesSlide
        folderPath={slide.src}
        duration={Number(slide.duration) || 20}
        title={title}
        subtitle={subtitle}
        onDone={onSlideDone}
        fillWidth={slide.fillWidth === true}
      />
    );
  }

  if (type === 'pdf') {
    return (
      <div className="w-full h-full relative bg-black">
        <iframe
          key={src}
          src={src}
          title={title || 'PDF'}
          className="w-full h-full border-0 bg-white"
        />
        {commonOverlay}
      </div>
    );
  }

  if (type === 'pptx' || type === 'word' || type === 'excel') {
    return (
      <DocumentImagesSlide
        folderPath={src}
        duration={Number(slide.duration) || 20}
        title={title}
        subtitle={subtitle}
        onDone={onSlideDone}
        fillWidth={slide.fillWidth === true}
      />
    );
  }

  if (type === 'web_url' && slide.converted && slide.src) {
    return (
      <DocumentImagesSlide
        folderPath={slide.src}
        duration={Number(slide.duration) || 20}
        title={title}
        subtitle={subtitle}
        onDone={onSlideDone}
        fillWidth={slide.fillWidth === true}
      />
    );
  }

  if (type === 'web_live') {
    if (!src) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gray-800 text-gray-400">
          <p className="text-sm">Web Live: introduceți URL în playlist.</p>
          {commonOverlay}
        </div>
      );
    }
    const fit = Math.max(50, Math.min(500, Number(slide.webLiveFit) || 250));
    const scale = 100 / fit;
    return (
      <WebLiveSlide
        src={src}
        title={title}
        fit={fit}
        scale={scale}
        displayKey={displayKey}
        commonOverlay={commonOverlay}
        webLiveAutoScroll={slide.webLiveAutoScroll === true}
        webLiveApplyLoginScript={slide.webLiveApplyLoginScript !== false}
        durationSec={Math.max(1, Number(slide.duration) || 10)}
      />
    );
  }

  if (type === 'web_action') {
    if (!src) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gray-800 text-gray-400">
          <p className="text-sm">Web Action: introduceți URL în playlist.</p>
          {commonOverlay}
        </div>
      );
    }
    const fit = Math.max(25, Math.min(500, Number(slide.webActionFit) || 100));
    const scripts = Array.isArray(slide.webActionScripts) ? slide.webActionScripts : [];
    return (
      <WebActionSlide
        src={src}
        webActionFit={fit}
        commonOverlay={commonOverlay}
        onWebActionShow={onWebActionShow}
        webActionApplyLoginScript={slide.webActionApplyLoginScript === true}
        webActionAutoScroll={slide.webActionAutoScroll === true}
        webActionHardLoadEnabled={slide.webActionHardLoadEnabled === true}
        webActionHardLoadSeconds={slide.webActionHardLoadSeconds}
        webActionScripts={scripts}
        durationSec={Math.max(1, Number(slide.duration) || 10)}
      />
    );
  }

  if (type === 'powerbi') {
    if (!src) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gray-800 text-gray-400">
          <p className="text-sm">Power BI: add report URL in playlist.</p>
          {commonOverlay}
        </div>
      );
    }
    const baseUrl = src.trim();
    const pageName = (slide.powerBiPage || '').trim();
    let iframeSrc = pageName
      ? baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'pageName=' + encodeURIComponent(pageName)
      : baseUrl;
    iframeSrc += (iframeSrc.includes('?') ? '&' : '?') + '_s=' + msalSessionVersion;
    const useBrowserView = typeof window !== 'undefined' && (window.api?.powerbiShow || onPowerBiShow);
    if (useBrowserView) {
      return (
        <PowerBiBrowserViewSlide
          url={iframeSrc}
          onShow={onPowerBiShow || ((url, opts) => window.api?.powerbiShow?.(url, undefined, opts))}
          powerBiFit={Math.max(50, Math.min(500, Number(slide.powerBiFit) || 100))}
          duration={Number(slide.duration) || 0}
          powerBiAutoScroll={slide.powerBiAutoScroll !== false}
          powerBiApplyLoginScript={slide.powerBiApplyLoginScript !== false}
          key={`powerbi_bv_${displayKey}_${msalSessionVersion}`}
        />
      );
    }
    if (!msalCanLoadPowerBi) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900 text-gray-400 gap-4">
          <p className="text-sm">Power BI – sign-in required</p>
          <p className="text-xs text-gray-500 max-w-md text-center">
            Set MSAL_LOGIN_EMAIL and MSAL_LOGIN_PASSWORD in .env. When the login page appears, it will be filled automatically.
          </p>
          {commonOverlay}
        </div>
      );
    }
    const fit = Math.max(50, Math.min(500, Number(slide.powerBiFit) || 100));
    const scale = 100 / fit;
    return (
      <div className="w-full h-full relative bg-black overflow-hidden">
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            width: `${fit}%`,
            height: `${fit}%`,
            transform: `scale(${scale})`
          }}
        >
          <PowerBiWebview key={`powerbi_${displayKey}_${msalSessionVersion}`} src={iframeSrc} />
        </div>
        {commonOverlay}
      </div>
    );
  }

  if (type === 'web_url' && src && isFlightboardSimpleViewPlaybackUrl(src)) {
    const s = FLIGHTBOARD_SIMPLEVIEW_IFRAME_SCALE;
    const pct = 100 / s;
    return (
      <div className="w-full h-full relative bg-black overflow-hidden">
        <iframe
          key={src}
          src={src}
          title={title || 'Embedded content'}
          className="absolute top-0 left-0 border-0"
          style={{
            width: `${pct}%`,
            height: `${pct}%`,
            transform: `scale(${s})`,
            transformOrigin: 'top left'
          }}
          allow="fullscreen; clipboard-read; clipboard-write; encrypted-media; autoplay"
          referrerPolicy="strict-origin-when-cross-origin"
        />
        {commonOverlay}
      </div>
    );
  }

  if (type === 'vimeo' || type === 'web_url') {
    return (
      <div className="w-full h-full relative bg-black">
        <iframe
          key={src}
          src={src}
          title={title || 'Embedded content'}
          className="w-full h-full border-0"
          allow="fullscreen; clipboard-read; clipboard-write; encrypted-media; autoplay"
          referrerPolicy="strict-origin-when-cross-origin"
        />
        {commonOverlay}
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-200">
      <p className="text-gray-600">Unsupported: {String(type)}</p>
    </div>
  );
}

function VideoSlide({ src, sound, title, subtitle }) {
  const videoRef = useRef(null);
  const muted = !sound;
  const commonOverlay = (
    <div className="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-black/80 via-black/0 to-transparent flex flex-col gap-2 pointer-events-none">
      {title && <h2 className="text-3xl font-semibold text-white drop-shadow">{title}</h2>}
      {subtitle && <p className="text-lg text-gray-200 drop-shadow">{subtitle}</p>}
    </div>
  );
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    const onCanPlay = () => {
      video.play().catch(() => {});
    };
    video.addEventListener('canplay', onCanPlay);
    if (video.readyState >= 2) onCanPlay();
    return () => {
      video.removeEventListener('canplay', onCanPlay);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [src]);
  return (
    <div className="w-full h-full relative bg-black">
      <video
        ref={videoRef}
        key={src}
        src={src}
        autoPlay
        loop
        playsInline
        muted={muted}
        preload="auto"
        className="w-full h-full object-contain bg-black"
      />
      {commonOverlay}
    </div>
  );
}

function DocumentImagesSlide({ folderPath, duration, title, subtitle, onDone, fillWidth }) {
  const [images, setImages] = useState([]);
  const [index, setIndex] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (typeof window === 'undefined' || !window.api?.getWorkspaceFolderImages) {
      setImages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      let list = await window.api.getWorkspaceFolderImages(folderPath);
      if (!cancelled && list.length === 0 && /\.(ppt|pptx|doc|docx|xls|xlsx)$/i.test(folderPath)) {
        const folderAlt = folderPath.replace(/\.[^/.]+$/, '_export');
        list = await window.api.getWorkspaceFolderImages(folderAlt);
      }
      if (!cancelled) setImages(list);
    })();
    return () => { cancelled = true; };
  }, [folderPath]);

  // Fiecare imagine 'duration' secunde; după ultima imagine se apelează onDone (fără loop)
  // Ref pentru onDone ca intervalul să nu fie resetat la fiecare render
  const perImageMs = Math.max(1000, (duration || 20) * 1000);
  useEffect(() => {
    if (images.length === 0) return;
    const t = setInterval(() => {
      setIndex((i) => {
        if (i >= images.length - 1) {
          onDoneRef.current?.();
          return i;
        }
        return i + 1;
      });
    }, perImageMs);
    return () => clearInterval(t);
  }, [images.length, perImageMs]);

  const commonOverlay = (
    <div className="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-black/80 via-black/0 to-transparent flex flex-col gap-2 pointer-events-none">
      {title && <h2 className="text-3xl font-semibold text-white drop-shadow">{title}</h2>}
      {subtitle && <p className="text-lg text-gray-200 drop-shadow">{subtitle}</p>}
    </div>
  );

  if (images.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-gray-800 text-gray-300 p-8 text-center">
        <p className="text-sm mb-2">Exportă PPT / Word / Excel în imagini (PNG/JPG) într-un folder.</p>
        <p className="text-xs text-gray-500">În playlist pune src: calea folderului (ex: documents/Prez_export)</p>
        {commonOverlay}
      </div>
    );
  }

  const currentSrc = images[index];
  // Centrare + max dimensiuni pe container: evită flex/înălțimi procentuale care uneori deformează w-full+h-full+object-fit.
  return (
    <div className="w-full h-full relative bg-black flex items-center justify-center min-h-0 min-w-0 overflow-hidden">
      <img
        key={currentSrc}
        src={currentSrc}
        alt=""
        className={
          fillWidth
            ? 'w-full h-full object-cover bg-black'
            : 'max-w-full max-h-full w-auto h-auto object-contain bg-black'
        }
        draggable={false}
      />
      {commonOverlay}
    </div>
  );
}

function HlsSlide({ src, sound, title, subtitle }) {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);
  const muted = !sound;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setError('HLS error');
      });
      return () => {
        hls.destroy();
        video.pause();
        video.removeAttribute('src');
        video.load();
      };
    }
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      return () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      };
    }
    setError('HLS not supported');
    return undefined;
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted]);

  const commonOverlay = (
    <div className="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-black/80 via-black/0 to-transparent flex flex-col gap-2 pointer-events-none">
      {title && <h2 className="text-3xl font-semibold text-white drop-shadow">{title}</h2>}
      {subtitle && <p className="text-lg text-gray-200 drop-shadow">{subtitle}</p>}
    </div>
  );

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black text-gray-400">
        {error}
        {commonOverlay}
      </div>
    );
  }

  return (
    <div className="w-full h-full relative bg-black">
      <video ref={videoRef} autoPlay loop playsInline muted={muted} className="w-full h-full object-contain bg-black" />
      {commonOverlay}
    </div>
  );
}

export default Slide;
