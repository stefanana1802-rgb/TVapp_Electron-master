/**
 * Slide type inference and embed URL handling for slideshow.
 * Supported: .jpeg .jpg .png .webp .bmp .tiff | .mp4 .webm .mov .avi .wmv .flv | .pdf .pptx .docx .doc .xlsx .xls | Vimeo | HLS (.m3u8) | web_url
 */

const IMAGE_EXT = ['jpeg', 'jpg', 'png', 'webp', 'bmp', 'tiff', 'tif'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'avi', 'wmv', 'flv'];
const HLS_EXT = ['m3u8'];

function getExtension(src) {
  if (!src || typeof src !== 'string') return '';
  const path = src.split('?')[0];
  const last = path.split('/').pop() || '';
  const dot = last.lastIndexOf('.');
  return dot === -1 ? '' : last.slice(dot + 1).toLowerCase();
}

function isVimeoUrl(src) {
  if (!src || typeof src !== 'string') return false;
  return /vimeo\.com\/(\d+)|player\.vimeo\.com\/video\//i.test(src);
}

function getVimeoEmbedUrl(url, withSound = false) {
  const m = url.match(/vimeo\.com\/(\d+)/i) || url.match(/player\.vimeo\.com\/video\/(\d+)/i);
  const id = m ? m[1] : '';
  if (!id) return url;
  const muted = withSound ? '0' : '1';
  return `https://player.vimeo.com/video/${id}?autoplay=1&muted=${muted}`;
}

function isHlsUrl(src) {
  if (!src || typeof src !== 'string') return false;
  const ext = getExtension(src);
  if (HLS_EXT.includes(ext)) return true;
  return /\.m3u8(\?|$)/i.test(src);
}

/**
 * Resolve effective slide type and display src from playlist slide.
 * @param {{ type?: string, src: string }} slide
 * @returns {{ type: string, src: string }}
 */
export function getSlideDisplay(slide) {
  if (!slide?.src) return { type: 'web_url', src: '' };
  const rawType = (slide.type || '').toLowerCase();
  const src = slide.src.trim();

  if (isVimeoUrl(src)) {
    const withSound = slide.vimeoSound === true;
    return { type: 'vimeo', src: getVimeoEmbedUrl(src, withSound) };
  }

  const ext = getExtension(src);

  if (rawType === 'image' || IMAGE_EXT.includes(ext)) {
    return { type: 'image', src };
  }
  if (rawType === 'hls' || isHlsUrl(src)) {
    return { type: 'hls', src };
  }
  if (rawType === 'video' || VIDEO_EXT.includes(ext)) {
    return { type: 'video', src };
  }
  if (rawType === 'pdf' || ext === 'pdf') {
    return { type: 'pdf', src };
  }
  if (rawType === 'pptx' || ext === 'pptx' || ext === 'ppt') {
    return { type: 'pptx', src };
  }
  if (rawType === 'word' || ext === 'docx' || ext === 'doc') {
    return { type: 'word', src };
  }
  if (rawType === 'excel' || ext === 'xlsx' || ext === 'xls') {
    return { type: 'excel', src };
  }
  if (rawType === 'web_url') {
    return { type: 'web_url', src };
  }
  if (rawType === 'web_live') {
    return { type: 'web_live', src };
  }
  if (rawType === 'web_action') {
    return { type: 'web_action', src };
  }
  if (rawType === 'flightboard') {
    const urls = Array.isArray(slide.flightboard?.urls) ? slide.flightboard.urls.filter(Boolean) : [];
    return { type: 'web_url', src: urls[0] || '' };
  }
  if (rawType === 'powerbi' || /app\.powerbi\.com|powerbi\.com/i.test(src)) {
    return { type: 'powerbi', src };
  }
  return { type: 'web_url', src };
}
