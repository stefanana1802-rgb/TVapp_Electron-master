// JSDoc type definitions for playlist items

/**
 * Slide type can be explicit or inferred from src (see src/utils/slideUtils.js).
 * @typedef {'image' | 'video' | 'web_url' | 'web_live' | 'web_action' | 'flightboard' | 'powerbi' | 'pdf' | 'pptx' | 'word' | 'excel' | 'vimeo' | 'hls'} SlideType
 */

/**
 * @typedef {Object} Slide
 * @property {string} id
 * @property {SlideType} [type]  Optional; inferred from src if omitted (e.g. .png → image, .docx → word).
 * @property {string} src       URL or workspace:// path. Supported: images | video | .pdf .pptx .docx .doc .xlsx .xls | .m3u8 (HLS) | YouTube / Vimeo URLs.
 * @property {Object} [flightboard] type flightboard: { finalized, projectsUrl, statusBase, sections[] (simpleView, xHoursBack, …), urls[] }; în player se expandează în web_url. Vezi flightboardUtils.
 * @property {number} duration  In seconds
 * @property {string} [title]
 * @property {string} [subtitle]
 * @property {number} [webLiveFit]  For type web_live: zoom-out fit (e.g. 200 = 200% view, scale 0.5; 250 = scale 0.4). Default 250.
 * @property {number} [powerBiFit]  For type powerbi: same as webLiveFit (zoom fit %). Default 100.
 * @property {string} [powerBiPage] For type powerbi: report page name (Power BI pageName URL param).
 * @property {boolean} [powerBiAutoScroll] For type powerbi: enable/disable auto-scroll. Nr. scrolluri se calculează automat din înălțimea conținutului, durata slide și delay. Default true.
 * @property {boolean} [powerBiApplyLoginScript] For type powerbi: dacă true, se aplică scriptul de login (completare email/parolă) pe pagina de login. Default true.
 * @property {boolean} [webLiveAutoScroll] For type web_live: enable/disable auto-scroll pe document/body; același calcul ca la Power BI (segment = durata/(scrollCount+1)). Default false.
 * @property {boolean} [webLiveApplyLoginScript] For type web_live: dacă true, se aplică scriptul de login (completare email/parolă) pe pagina de login în iframe. Default true.
 * @property {number} [webActionFit] For type web_action: numeric din playlist; în app → setZoomFactor(fit/100) pe BrowserView. Default în renderer dacă lipsește: 100.
 * @property {boolean} [webActionApplyLoginScript] For type web_action: autologin ca Power BI. Default false.
 * @property {boolean} [webActionAutoScroll] For type web_action: auto-scroll după login+click-uri. Default false.
 * @property {boolean} [webActionHardLoadEnabled] For type web_action: dacă true, amână N secunde autologin, action script-urile și auto-scroll; BrowserView încarcă URL-ul imediat. Default false.
 * @property {number} [webActionHardLoadSeconds] For type web_action: secunde fără automatizare după ce pagina poate începe să se încarce. Ignorat dacă webActionHardLoadEnabled e false.
 * @property {string[]} [webActionScripts] For type web_action: selectori CSS sau fragmente HTML (ex. label copiat) pentru click în ordine.
 */

/**
 * @typedef {Object} Playlist
 * @property {Slide[]} slides
 */

export {};

