import React, { useState, useEffect, useRef } from 'react';

const CUSTOMER_FEEDBACK = [
  { client: 'AutoTech GmbH', quote: 'Outstanding partnership. The team delivered beyond our expectations and the integration was seamless.' },
  { client: 'Mobility Solutions', quote: 'Professional and responsive. They understood our automotive requirements from day one.' },
  { client: 'Drive Systems Inc.', quote: 'Aumovio\'s expertise in the sector made the difference. We highly recommend them.' }
];

const QUOTES_OF_DAY = [
  'Innovation is not about saying yes to everything. It\'s about saying no to all but the most crucial features.',
  'The best time to plant a tree was 20 years ago. The second best time is now.',
  'Quality is not an act, it is a habit.'
];

const DID_YOU_KNOW = [
  { fact: 'The automotive industry is one of the largest R&D investors globally, with billions spent on electrification and autonomous driving each year.' },
  { fact: 'Aumovio was founded with a focus on bringing software excellence to mobility and manufacturing. Our first project was in powertrain calibration.' },
  { fact: 'Modern vehicles contain over 100 million lines of code—more than many operating systems. Software is at the heart of today\'s cars.' }
];

const WORD_OF_DAY = [
  { word: 'Calibration', meaning: 'The process of adjusting and configuring a system (e.g. engine, sensor) to meet specified performance criteria.' },
  { word: 'OEM', meaning: 'Original Equipment Manufacturer. A company that produces parts or systems used in another company\'s end product.' },
  { word: 'ECU', meaning: 'Electronic Control Unit. A microcontroller that manages one or more electrical systems in a vehicle.' }
];

const REMINDER_HEALTHY_SECTIONS = [
  { title: 'Take a break', text: 'Step away from your screen every 1 hour. Short breaks reduce eye strain and improve focus.' },
  { title: 'Stay hydrated', text: 'Keep a bottle of water at your desk. Hydration supports concentration and overall well-being.' },
  { title: 'Simple stretching', text: 'A few minutes of stretching keeps muscles relaxed and helps prevent tension. Your body will thank you.' }
];

/** Format 24h "HH:mm" as "h:mm AM/PM". */
function formatTimeAMPM(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return '';
  const parts = timeStr.trim().slice(0, 5).split(':');
  const h24 = parseInt(parts[0], 10);
  const m = parts[1] ? parseInt(parts[1], 10) : 0;
  if (Number.isNaN(h24)) return timeStr;
  const h12 = h24 % 12 || 12;
  const period = h24 < 12 ? 'AM' : 'PM';
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatDurationMin(str) {
  if (!str || typeof str !== 'string') return '10 min';
  const num = parseInt(String(str).replace(/\D/g, ''), 10);
  if (Number.isNaN(num) || num < 1) return '10 min';
  return num === 1 ? '1 min' : `${num} min`;
}

function getDayIndex() {
  const d = new Date();
  return d.getDate() + d.getMonth() * 31 + d.getFullYear() * 366;
}

function useCarousel(getPageCounts, intervalMs) {
  const [categoryIndex, setCategoryIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const [lastTick, setLastTick] = useState(() => Date.now());
  const lastTickRef = useRef(lastTick);
  lastTickRef.current = lastTick;
  const ref = useRef({ categoryIndex: 0, itemIndex: 0 });
  ref.current = { categoryIndex, itemIndex };
  const getPagesRef = useRef(getPageCounts);
  getPagesRef.current = getPageCounts;

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const { categoryIndex: cat, itemIndex: item } = ref.current;
      if (now - lastTickRef.current >= intervalMs) {
        lastTickRef.current = now;
        setLastTick(now);
        const pageCounts = getPagesRef.current();
        if (!pageCounts.length) return;
        const pages = pageCounts[cat] ?? 0;
        if (pages > 0 && item + 1 < pages) {
          setItemIndex(item + 1);
        } else {
          setCategoryIndex((c) => (c + 1) % pageCounts.length);
          setItemIndex(0);
        }
      }
    }, 1000);
    return () => clearInterval(id);
  }, [intervalMs]);

  return [categoryIndex, itemIndex, lastTick];
}

function useCountdown(lastTick, intervalMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.ceil((lastTick + intervalMs - now) / 1000));
}

function normalizeSingleItem(it) {
  if (it == null) return { section: '' };
  if (typeof it === 'string') return { section: it.trim() };
  if (typeof it === 'object') {
    const s = it.section != null ? String(it.section)
      : it.quote != null ? String(it.quote)
        : it.fact != null ? String(it.fact)
          : '';
    return { section: s.trim() };
  }
  return { section: '' };
}

function normalizePairItem(it) {
  if (!it || typeof it !== 'object') return { text: '', text2: '' };
  if (it.text != null || it.text2 != null) {
    return { text: String(it.text ?? '').trim(), text2: String(it.text2 ?? '').trim() };
  }
  if (it.client != null || it.quote != null) {
    return { text: String(it.client ?? '').trim(), text2: String(it.quote ?? '').trim() };
  }
  if (it.word != null || it.meaning != null) {
    return { text: String(it.word ?? '').trim(), text2: String(it.meaning ?? '').trim() };
  }
  return { text: '', text2: '' };
}

function normalizeMultiItem(it) {
  if (!it || typeof it !== 'object') return { title: '', text: '' };
  return {
    title: String(it.title ?? '').trim(),
    text: String(it.text ?? it.subtitle ?? '').trim()
  };
}

/** Migrate legacy info_section JSON (no infoBlocks) to block list. */
function migrateLegacyInfoSection(info) {
  const cfSrc = (info.customerFeedback && Array.isArray(info.customerFeedback)) ? info.customerFeedback : CUSTOMER_FEEDBACK;
  const quotesSrc = (info.quotesOfDay && Array.isArray(info.quotesOfDay)) ? info.quotesOfDay : QUOTES_OF_DAY.map((q) => ({ quote: q }));
  const dykSrc = (info.didYouKnow && Array.isArray(info.didYouKnow)) ? info.didYouKnow : DID_YOU_KNOW;
  const wodSrc = (info.wordOfDay && Array.isArray(info.wordOfDay)) ? info.wordOfDay : WORD_OF_DAY;
  const rhSrc = (info.reminderHealthy && Array.isArray(info.reminderHealthy)) ? info.reminderHealthy : REMINDER_HEALTHY_SECTIONS;

  const cfItems = cfSrc.map((x) => normalizePairItem(x));
  const qdItems = quotesSrc.map((x) => {
    if (typeof x === 'string') return { section: x.trim() };
    return normalizeSingleItem(x);
  }).filter((x) => (x.section || '').trim().length > 0);
  const dykItems = dykSrc.map((x) => normalizeSingleItem(typeof x === 'string' ? { fact: x } : x)).filter((x) => (x.section || '').trim().length > 0);
  const wodItems = wodSrc.map((x) => normalizePairItem(x));
  const rhItems = rhSrc.map((x) => normalizeMultiItem(x));

  return [
    { id: 'customer_feedback', kind: 'pair', pairMode: 'carousel', title: 'Customer feedback', items: cfItems },
    { id: 'quote_of_day', kind: 'single', singleMode: 'hash', title: 'Quote of the Day', items: qdItems.length ? qdItems : QUOTES_OF_DAY.map((q) => ({ section: q })) },
    { id: 'did_you_know', kind: 'single', singleMode: 'day', title: 'Did you know !', items: dykItems },
    { id: 'word_of_day', kind: 'pair', pairMode: 'daily', title: 'Word of the Day', items: wodItems },
    { id: 'reminder_healthy', kind: 'multi', title: 'Stay healthy', items: rhItems }
  ];
}

function getBlockList(info) {
  if (Array.isArray(info.infoBlocks) && info.infoBlocks.length > 0) {
    return info.infoBlocks;
  }
  return migrateLegacyInfoSection(info);
}

function normalizeBlock(block) {
  const id = block.id || 'block';
  const kind = block.kind || 'single';
  const title = (block.title != null && String(block.title).trim()) ? String(block.title).trim() : 'Info';
  const items = Array.isArray(block.items) ? block.items : [];
  if (kind === 'single') {
    let singleMode = block.singleMode === 'hash' ? 'hash' : 'day';
    if (block.singleMode === undefined) {
      if (id === 'quote_of_day') singleMode = 'hash';
      else if (id === 'did_you_know') singleMode = 'day';
    }
    return { ...block, id, kind: 'single', title, singleMode, items: items.map(normalizeSingleItem) };
  }
  if (kind === 'pair') {
    let pairMode = block.pairMode === 'daily' ? 'daily' : 'carousel';
    if (block.pairMode === undefined) {
      if (id === 'word_of_day') pairMode = 'daily';
      else if (id === 'customer_feedback') pairMode = 'carousel';
    }
    return { ...block, id, kind: 'pair', title, pairMode, items: items.map(normalizePairItem) };
  }
  if (kind === 'multi') {
    return { ...block, id, kind: 'multi', title, items: items.map(normalizeMultiItem) };
  }
  return { ...block, id, kind: 'single', title, singleMode: 'day', items: items.map(normalizeSingleItem) };
}

function singleHasContent(block) {
  return block.items.some((it) => (normalizeSingleItem(it).section || '').trim().length > 0);
}

function pairCarouselItems(block) {
  return block.items.map(normalizePairItem).filter((it) => (it.text || '').trim() || (it.text2 || '').trim().length > 0);
}

function pairDailyHasContent(block) {
  return block.items.some((it) => {
    const p = normalizePairItem(it);
    return (p.text || '').trim() || (p.text2 || '').trim();
  });
}

function multiHasContent(block) {
  return block.items.some((it) => {
    const m = normalizeMultiItem(it);
    return (m.title || '').trim() || (m.text || '').trim();
  });
}

function computePageCount(block) {
  const b = normalizeBlock(block);
  if (b.kind === 'single') return singleHasContent(b) ? 1 : 0;
  if (b.kind === 'pair') {
    if (b.pairMode === 'daily') return pairDailyHasContent(b) ? 1 : 0;
    const n = pairCarouselItems(b).length;
    return n;
  }
  if (b.kind === 'multi') return multiHasContent(b) ? 1 : 0;
  return 0;
}

function pickSingleIndex(block, dayIndex) {
  const items = block.items.map(normalizeSingleItem).filter((it) => (it.section || '').trim());
  if (!items.length) return -1;
  const mode = block.singleMode === 'hash' ? 'hash' : 'day';
  if (mode === 'hash') {
    const seed = dayIndex * 2654435761;
    return (seed >>> 0) % items.length;
  }
  return dayIndex % items.length;
}

function pickPairDailyIndex(block, dayIndex) {
  const items = block.items.map(normalizePairItem).filter((it) => (it.text || '').trim() || (it.text2 || '').trim());
  if (!items.length) return -1;
  return dayIndex % items.length;
}

const EMPTY_MESSAGE = 'Nothing loaded. Configure in Dashboard.';

export default function VisitorsCarousel({ sections = {} }) {
  const cooldownSeconds = Math.max(5, Math.min(3600, Number(sections.info_section?.cooldownSeconds) || 10));
  const INTERVAL_MS = cooldownSeconds * 1000;
  const info = sections.info_section || {};
  const dayIndex = getDayIndex();

  const blockList = getBlockList(info).map(normalizeBlock);
  const withCounts = blockList.map((block) => ({
    block,
    pageCount: computePageCount(block)
  })).filter((x) => x.pageCount > 0);
  const carouselBlocks = withCounts.map((x) => x.block);
  const pageCounts = withCounts.map((x) => x.pageCount);

  const stretchingFromSection = sections?.stretching?.items?.[0];
  const hasStretchingTime = stretchingFromSection?.time && stretchingFromSection?.duration;
  const stretchingLabel = hasStretchingTime
    ? `Stretching Time - ${formatTimeAMPM(stretchingFromSection.time)} (${formatDurationMin(stretchingFromSection.duration)})`
    : ((stretchingFromSection?.title || '').trim() || null);

  const [catIndex, itemIndex, lastTick] = useCarousel(() => pageCounts, INTERVAL_MS);
  const countdown = useCountdown(lastTick, INTERVAL_MS);

  const safeCat = carouselBlocks.length ? Math.min(catIndex, carouselBlocks.length - 1) : 0;
  const currentBlock = carouselBlocks[safeCat] || null;
  const categoryLabel = currentBlock
    ? (currentBlock.id === 'reminder_healthy' && stretchingLabel ? stretchingLabel : currentBlock.title)
    : 'Info';

  const renderContent = () => {
    if (!currentBlock || carouselBlocks.length === 0) {
      return <p className="text-sm text-gray-500 italic w-full">{EMPTY_MESSAGE}</p>;
    }
    const b = currentBlock;
    const kind = b.kind;

    if (kind === 'single') {
      const idx = pickSingleIndex(b, dayIndex);
      if (idx < 0) return <p className="text-sm text-gray-500 italic w-full">{EMPTY_MESSAGE}</p>;
      const items = b.items.map(normalizeSingleItem).filter((it) => (it.section || '').trim());
      const item = items[idx];
      if (!item) return <p className="text-sm text-gray-500 italic w-full">{EMPTY_MESSAGE}</p>;
      if (b.id === 'quote_of_day') {
        return (
          <p className="text-sm text-gray-700 leading-snug italic line-clamp-3 text-left w-full">&ldquo;{item.section}&rdquo;</p>
        );
      }
      return (
        <p className="text-sm text-gray-600 leading-snug line-clamp-3 text-left w-full">{item.section}</p>
      );
    }

    if (kind === 'pair') {
      if (b.pairMode === 'daily') {
        const idx = pickPairDailyIndex(b, dayIndex);
        if (idx < 0) return <p className="text-sm text-gray-500 italic w-full">{EMPTY_MESSAGE}</p>;
        const items = b.items.map(normalizePairItem).filter((it) => (it.text || '').trim() || (it.text2 || '').trim());
        const item = items[idx];
        if (!item) return <p className="text-sm text-gray-500 italic w-full">{EMPTY_MESSAGE}</p>;
        return (
          <div className="space-y-1.5 text-left w-full">
            <p className="text-base font-semibold text-gray-900 truncate">{item.text}</p>
            <p className="text-sm text-gray-600 leading-snug line-clamp-3">{item.text2}</p>
          </div>
        );
      }
      const carousel = pairCarouselItems(b);
      if (!carousel.length) return <p className="text-sm text-gray-500 italic w-full">{EMPTY_MESSAGE}</p>;
      const item = carousel[itemIndex % carousel.length];
      if (!item) return <p className="text-sm text-gray-500 italic w-full">{EMPTY_MESSAGE}</p>;
      return (
        <div className="space-y-1.5 text-left w-full">
          <p className="text-base font-semibold text-gray-800 truncate">{item.text}</p>
          <p className="text-sm text-gray-600 leading-snug italic line-clamp-3">&ldquo;{item.text2}&rdquo;</p>
        </div>
      );
    }

    if (kind === 'multi') {
      const rows = b.items.map(normalizeMultiItem).filter((it) => (it.title || '').trim() || (it.text || '').trim());
      if (!rows.length) {
        return <p className="text-sm text-gray-500 italic w-full">{EMPTY_MESSAGE}</p>;
      }
      return (
        <div className="space-y-1.5 text-left w-full">
          {rows.map((s, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-sm font-semibold text-emerald-600 shrink-0">{s.title}</span>
              <p className="text-sm text-gray-600 leading-snug line-clamp-2 min-w-0">{s.text}</p>
            </div>
          ))}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="rounded-xl bg-surface border border-gray-200 shadow-sm px-3 py-2 flex flex-col min-h-0 h-full flex-1 overflow-hidden">
      <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
        <span className="text-xs uppercase tracking-[0.15em] text-gray-500 truncate">{categoryLabel}</span>
        <span className="text-[0.65rem] text-gray-400 tabular-nums shrink-0">{countdown}s</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden pt-1 flex justify-center items-start">
        <div className="w-full max-w-full min-w-0 text-gray-800 leading-snug text-left">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
