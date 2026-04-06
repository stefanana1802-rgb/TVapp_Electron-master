/**
 * Descarcă automat PDF-urile meniu cantină de pe o pagină protejată de login.
 * Folosește un BrowserWindow temporar, login cu CANTEEN_LOGIN_EMAIL / CANTEEN_LOGIN_PASSWORD,
 * extrage linkuri PDF după label-uri, descarcă, închide fereastra (eliberează memoria).
 */
const path = require('path');
const fs = require('fs').promises;
const { BrowserWindow } = require('electron');

const CANTEEN_DOWNLOAD_PARTITION = 'persist:canteen-download';
const INITIAL_WAIT_MS = 2500;
const LOGIN_WAIT_MS = 6000;
const EXTRACT_WAIT_MS = 2000;

/**
 * Extrage din pagină toate linkurile către PDF-uri.
 * SharePoint modern: fișierele sunt în listă; linkul poate fi viewer (open), nu direct .pdf.
 * Construim URL download: _layouts/15/download.aspx?SourceUrl=... sau &download=1.
 */
function getPdfLinksScript() {
  return `
    (function() {
      var base = window.location.href;
      var origin = window.location.origin || (window.location.protocol + '//' + window.location.host);
      var seen = {};
      var links = [];
      function isPdfName(n) {
        if (!n || typeof n !== 'string') return false;
        return n.toLowerCase().endsWith('.pdf');
      }
      function buildDownloadUrl(href) {
        if (!href || (href.trim().toLowerCase().indexOf('http') !== 0 && href.trim().indexOf('/') !== 0)) return null;
        try {
          var u = new URL(href, base);
          var path = (u.pathname || '').toLowerCase();
          if (path.indexOf('/_layouts/') >= 0) return u.href;
          var fullHref = u.href;
          if (fullHref.length < 40 || fullHref.indexOf('.pdf') === -1) return null;
          if (path.endsWith('.pdf')) return origin + '/_layouts/15/download.aspx?SourceUrl=' + encodeURIComponent(fullHref);
          return fullHref + (fullHref.indexOf('?') >= 0 ? '&' : '?') + 'download=1';
        } catch (e) { return null; }
      }
      function getServerRelativeFromRow(row) {
        if (!row) return null;
        var attrs = ['data-serverrelativeurl', 'data-sp-itemurl', 'data-file-ref', 'data-url'];
        for (var a = 0; a < attrs.length; a++) {
          var el = row.querySelector('[' + attrs[a] + ']');
          if (el) {
            var v = (el.getAttribute(attrs[a]) || '').trim();
            if (v && (v.indexOf('/') === 0 || v.indexOf('http') === 0)) {
              if (v.indexOf('http') === 0) try { return new URL(v).pathname; } catch (e) { return null; }
              return v;
            }
          }
        }
        return null;
      }
      function parseModifiedFromText(text, fileName) {
        if (!text || !fileName) return null;
        var idx = text.indexOf(fileName);
        if (idx === -1) return null;
        var after = text.substring(idx + fileName.length).trim();
        if (after.length < 2) return null;
        var d = null;
        var dayNames = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\\s+at\\s+(\\d{1,2}):(\\d{2})\\s*(AM|PM)/i;
        var m1 = after.match(dayNames);
        if (m1) {
          var now = new Date();
          var targetDay = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 }[m1[1].toLowerCase()];
          var currentDay = now.getDay();
          var diff = (currentDay === 0 ? 7 : currentDay) - (targetDay === 0 ? 7 : targetDay);
          if (diff < 0) diff += 7;
          var d2 = new Date(now);
          d2.setDate(d2.getDate() - diff);
          d2.setHours(parseInt(m1[2], 10) + (m1[4].toUpperCase() === 'PM' ? 12 : 0), parseInt(m1[3], 10), 0, 0);
          if (d2.getTime() > now.getTime()) d2.setDate(d2.getDate() - 7);
          d = d2;
        }
        if (!d) {
          var monthDay = /^(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2})/i.exec(after);
          if (monthDay) {
            var months = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };
            var y = new Date().getFullYear();
            d = new Date(y, months[monthDay[1].toLowerCase()], parseInt(monthDay[2], 10));
            if (d.getTime() > Date.now()) d.setFullYear(y - 1);
          }
        }
        if (!d) {
          var shortMonth = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+(\\d{1,2})/i.exec(after);
          if (shortMonth) {
            var sm = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
            var y = new Date().getFullYear();
            d = new Date(y, sm[shortMonth[1].toLowerCase().substring(0,3)], parseInt(shortMonth[2], 10));
            if (d.getTime() > Date.now()) d.setFullYear(y - 1);
          }
        }
        if (!d) {
          var numSlash = /^(\\d{1,2})[\\/\\.-](\\d{1,2})[\\/\\.-](\\d{4})/.exec(after);
          if (numSlash) d = new Date(parseInt(numSlash[3],10), parseInt(numSlash[2],10)-1, parseInt(numSlash[1],10));
        }
        if (!d) {
          var endMar = /\\d{1,2}\\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\\s*-\\s*(\\d{1,2})\\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/i.exec(after);
          if (endMar) {
            var em = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
            d = new Date(new Date().getFullYear(), em[endMar[2].toLowerCase().substring(0,3)], parseInt(endMar[1], 10));
          }
        }
        if (!d) {
          var roMonths = /(\\d{1,2})\\s*-\\s*(\\d{1,2})\\s+(ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie)/i.exec(after);
          if (roMonths) {
            var rom = { ianuarie:0,februarie:1,martie:2,aprilie:3,mai:4,iunie:5,iulie:6,august:7,septembrie:8,octombrie:9,noiembrie:10,decembrie:11 };
            var monthIdx = rom[roMonths[3].toLowerCase()];
            if (monthIdx !== undefined) d = new Date(new Date().getFullYear(), monthIdx, parseInt(roMonths[2], 10));
          }
        }
        if (d && !isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2100) return d.toISOString();
        return null;
      }
      function add(downloadHref, displayName, text, rawFileUrl, serverRelativePath) {
        if (!downloadHref || seen[downloadHref]) return;
        var n = (displayName || '').split('?')[0].trim();
        if (!isPdfName(n)) return;
        seen[downloadHref] = true;
        var fromText = parseModifiedFromText((text || '').trim(), n);
        links.push({ href: downloadHref, fileUrl: rawFileUrl || downloadHref, text: (text || '').trim(), name: n, modified: fromText, serverRelativePath: serverRelativePath || null });
      }
      function findRow(el) {
        return el.closest('tr') || el.closest('[role="row"]') || el.closest('[role="listitem"]') || el.closest('.ms-List-cell') || el.closest('[class*="List-cell"]') || el.closest('.ms-DocumentCard') || el.closest('[class*="DocumentCard"]') || el.closest('[data-list-id]') || el.closest('[class*="Item"]') || null;
      }
      function getFullRowText(el) {
        var row = findRow(el);
        if (row) {
          var txt = (row.textContent || '').trim();
          if (txt.length >= 20 && txt.indexOf('.pdf') >= 0) return txt;
          var p = row.parentElement;
          while (p && p !== document.body) {
            txt = (p.textContent || '').trim();
            if (txt.length >= 30 && txt.indexOf('.pdf') >= 0) return txt;
            p = p.parentElement;
          }
          return (row.textContent || '').trim();
        }
        return (el.textContent || '').trim();
      }
      function extractFullPdfName(t) {
        if (!t) return null;
        var r = /(\\S(?:\\s*\\S)*\\.pdf)/gi;
        var all = [];
        var m;
        while ((m = r.exec(t)) !== null) all.push(m[1].trim());
        if (all.length === 0) {
          var short = t.match(/[^\\s\\/]+\\.pdf/gi);
          if (short && short.length > 0) {
            var longest = short[0];
            for (var i = 1; i < short.length; i++) if (short[i].length > longest.length) longest = short[i];
            return longest.trim();
          }
          return null;
        }
        var longest = all[0];
        for (var i = 1; i < all.length; i++) if (all[i].length > longest.length) longest = all[i];
        return longest.trim();
      }
      function getFileUrlFromRow(row, preferFilename) {
        if (!row) return null;
        var as = row.querySelectorAll('a[href]');
        var candidates = [];
        for (var i = 0; i < as.length; i++) {
          var h = as[i].getAttribute('href');
          if (!h || h.length < 3 || h === '#' || h.indexOf('javascript:') === 0) continue;
          var full = new URL(h, base).href;
          var linkText = (as[i].textContent || '').trim();
          var hrefEnd = (h.split('/').pop() || '').split('?')[0];
          try { hrefEnd = decodeURIComponent(hrefEnd); } catch (e) {}
          candidates.push({ url: full, hrefEnd: hrefEnd, linkText: linkText });
        }
        if (preferFilename && candidates.length > 0) {
          for (var c = 0; c < candidates.length; c++) {
            if (candidates[c].hrefEnd === preferFilename) return candidates[c].url;
            if (candidates[c].linkText && candidates[c].linkText.indexOf(preferFilename) >= 0) return candidates[c].url;
          }
          var best = null;
          for (var c = 0; c < candidates.length; c++) {
            var ce = candidates[c].hrefEnd || '';
            if (preferFilename.endsWith(ce) && (!best || ce.length > (best.hrefEnd || '').length)) best = candidates[c];
          }
          if (best) return best.url;
        }
        if (candidates.length > 0) return candidates[0].url;
        var dataAttrs = ['data-url', 'data-href', 'data-fileurl', 'data-itemurl', 'data-serverrelativeurl', 'data-sp-itemurl', 'data-interactable-target', 'data-file-ref'];
        for (var d = 0; d < dataAttrs.length; d++) {
          var el = row.querySelector('[' + dataAttrs[d] + ']');
          if (el) {
            var v = el.getAttribute(dataAttrs[d]);
            if (v && v.indexOf('http') === 0) return v;
            if (v && v.indexOf('/') === 0) return origin + v;
          }
        }
        return null;
      }
      function extractPdfName(t) {
        return extractFullPdfName(t) || (t ? (t.match(/[^\\s\\/]+\\.pdf/i) ? t.match(/[^\\s\\/]+\\.pdf/i)[0].trim() : null) : null);
      }
      var byText = document.evaluate("//*[contains(translate(., 'PDF', 'pdf'), '.pdf') and string-length(normalize-space(.)) < 200 and string-length(normalize-space(.)) > 3]", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (var i = 0; i < byText.snapshotLength; i++) {
        var el = byText.snapshotItem(i);
        var text = (el.textContent || '').trim();
        if (text.length > 250) continue;
        var row = findRow(el);
        var rowText = getFullRowText(el);
        var fileUrl = getFileUrlFromRow(row, null);
        if (!fileUrl && row) {
          var allA = row.querySelectorAll('a[href]');
          for (var j = 0; j < allA.length; j++) {
            var h = allA[j].getAttribute('href');
            if (h && h.length > 5 && h.indexOf('javascript:') !== 0) {
              fileUrl = new URL(h, base).href;
              break;
            }
          }
        }
        var nameFromUrl = '';
        if (fileUrl) try { nameFromUrl = decodeURIComponent((fileUrl.split('/').pop() || '').split('?')[0]); } catch (e) {}
        var name = (nameFromUrl && nameFromUrl.toLowerCase().endsWith('.pdf')) ? nameFromUrl : (extractFullPdfName(rowText) || extractFullPdfName(text) || extractPdfName(text) || text.split(/\\s{2,}|\\n/)[0].trim());
        if (!name || !isPdfName(name)) continue;
        fileUrl = getFileUrlFromRow(row, name) || fileUrl;
        var fullFromRow = extractFullPdfName(rowText);
        if (fullFromRow && (fullFromRow.endsWith(name) || fullFromRow === name) && fullFromRow.length > name.length) name = fullFromRow;
        if (fileUrl) {
          var downloadUrl = buildDownloadUrl(fileUrl);
          if (downloadUrl) add(downloadUrl, name, rowText || text, fileUrl, getServerRelativeFromRow(row));
        } else {
          var folderPath = null;
          try {
            var params = new URLSearchParams(window.location.search || '');
            var id = params.get('id') || params.get('rootFolder');
            if (id) folderPath = decodeURIComponent(id).replace(/\\\\/g, '/');
            if (!folderPath) folderPath = (window.location.pathname || '').replace(/\\/$/, '');
            if (folderPath && name) {
              var slash = folderPath.slice(-1) === '/' ? '' : '/';
              var directUrl = origin + (folderPath.indexOf('/') === 0 ? folderPath : '/' + folderPath) + slash + encodeURIComponent(name);
              var downloadUrl = buildDownloadUrl(directUrl);
              if (downloadUrl) add(downloadUrl, name, rowText || text, directUrl, getServerRelativeFromRow(row));
            }
          } catch (err) {}
        }
      }
      document.querySelectorAll('a[href]').forEach(function(a) {
        var href = a.getAttribute('href');
        if (!href || href === '#' || href.indexOf('javascript:') === 0) return;
        var text = (a.textContent || '').trim();
        var row = findRow(a);
        var rowTxt = getFullRowText(a);
        var absolute = null;
        try { absolute = new URL(href, base).href; } catch (e) { return; }
        var nameFromUrl = '';
        try { nameFromUrl = decodeURIComponent((absolute.split('/').pop() || '').split('?')[0]); } catch (e) {}
        var name = nameFromUrl && nameFromUrl.toLowerCase().endsWith('.pdf') ? nameFromUrl : extractFullPdfName(rowTxt) || extractFullPdfName(text) || extractPdfName(rowTxt) || extractPdfName(text) || nameFromUrl;
        if (!name || !isPdfName(name)) return;
        var rowUrl = getFileUrlFromRow(row, name);
        if (rowUrl) absolute = rowUrl;
        var fullFromRow = extractFullPdfName(rowTxt);
        if (fullFromRow && (fullFromRow.endsWith(name) || fullFromRow === name) && fullFromRow.length > name.length) name = fullFromRow;
        try {
          var downloadUrl = buildDownloadUrl(absolute);
          if (downloadUrl) add(downloadUrl, name, rowTxt || text, absolute, getServerRelativeFromRow(row));
        } catch (e) {}
      });
      return (async function enrichModified(links) {
        var folderPath = null;
        try {
          var params = new URLSearchParams(window.location.search || '');
          var id = params.get('id') || params.get('rootFolder');
          if (id) folderPath = decodeURIComponent(id).replace(/\\\\/g, '/');
          if (folderPath && folderPath.indexOf('/') !== 0) folderPath = '/' + folderPath;
        } catch (e) {}
        for (var i = 0; i < links.length; i++) {
          var currentName = (links[i].name || '').trim();
          var fullNameFromText = extractFullPdfName(links[i].text);
          var urlPath = '';
          try { urlPath = new URL(links[i].fileUrl || links[i].href, base).pathname; } catch (e) {}
          var urlFilename = (urlPath.split('/').pop() || '').split('?')[0];
          try { urlFilename = decodeURIComponent(urlFilename); } catch (e) {}
          if (fullNameFromText && fullNameFromText.length > currentName.length) {
            var isSameFile = fullNameFromText.endsWith(currentName) || currentName.endsWith(fullNameFromText) || fullNameFromText === urlFilename || (urlFilename && fullNameFromText.endsWith(urlFilename));
            if (isSameFile) links[i].name = fullNameFromText;
          }
          if (folderPath && links[i].name && links[i].name !== urlFilename && (links[i].name.length > urlFilename.length || links[i].name.indexOf(urlFilename) < 0)) {
            var direct = origin + (folderPath.slice(-1) === '/' ? folderPath : folderPath + '/') + encodeURIComponent(links[i].name);
            links[i].altFileUrl = direct;
            links[i].serverRelativePath = (folderPath.slice(-1) === '/' ? folderPath : folderPath + '/') + links[i].name;
            var built = buildDownloadUrl(direct);
            if (built) links[i].altDownloadUrl = built;
          }
        }
        var q = "'";
        for (var i = 0; i < links.length; i++) {
          try {
            var pathToUse = links[i].serverRelativePath;
            if (!pathToUse) {
              var url = links[i].fileUrl || links[i].href;
              pathToUse = new URL(url, base).pathname;
            }
            if (!pathToUse || pathToUse.length < 3) continue;
            if (pathToUse.indexOf('_layouts') >= 0 || pathToUse.indexOf('WopiFrame') >= 0) continue;
            var safePath = pathToUse.replace(new RegExp(q, 'g'), q + q);
            var restUrl = origin + '/_api/web/GetFileByServerRelativeUrl(' + q + safePath + q + ')?$select=TimeLastModified';
            var res = await fetch(restUrl, { method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } });
            if (res.ok) {
              var j = await res.json();
              if (j.TimeLastModified) links[i].modified = new Date(j.TimeLastModified).toISOString();
            }
          } catch (e) {}
        }
        return links;
      })(links);
    })();
  `;
}

/**
 * Același script de login ca pentru Power BI (Microsoft / ADFS): setInputValueLikeUser + selectori #i0116, #i0118, #idSIButton9, Next/Sign in cu setTimeout.
 */
function getLoginScript(email, password) {
  const emailStr = JSON.stringify(email || '');
  const passStr = JSON.stringify(password || '');
  return `
    (function(){
      var email = ${emailStr};
      var pass = ${passStr};
      function tryPickAccountPage() {
        var bodyText = (document.body && document.body.innerText) ? document.body.innerText : '';
        if (bodyText.indexOf('Pick an account') === -1 && bodyText.indexOf('Choose an account') === -1) return false;
        var emailLower = (email || '').toLowerCase().trim();
        if (!emailLower) return false;
        var all = document.querySelectorAll('div[role="button"], div[role="listitem"], a[href], button, [data-testid], .table-row, [class*="tile"], [class*="account"]');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          var txt = (el.textContent || el.innerText || '').toLowerCase();
          if (txt.indexOf(emailLower) !== -1) {
            el.click();
            return true;
          }
        }
        var useOther = Array.from(document.querySelectorAll('a, button, div[role="button"], span')).find(function(n) {
          var t = (n.textContent || n.innerText || '').trim().toLowerCase();
          return t.indexOf('use another account') !== -1 || t.indexOf('alt cont') !== -1;
        });
        if (useOther) {
          useOther.click();
          return true;
        }
        return false;
      }
      if (tryPickAccountPage()) return;
      function setInputValueLikeUser(inp, val) {
        if (!inp) return;
        inp.focus();
        var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
        if (!proto) proto = inp.constructor.prototype;
        try {
          var desc = Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc && desc.set) {
            desc.set.call(inp, val);
            try { inp.dispatchEvent(new InputEvent('input', { bubbles: true, data: val, inputType: 'insertText' })); } catch (e) { inp.dispatchEvent(new Event('input', { bubbles: true })); }
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            inp.value = val;
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } catch (e) {
          inp.value = val;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
        inp.dispatchEvent(new Event('blur', { bubbles: true }));
      }
      function findEmailInput() {
        return document.querySelector('#i0116') || document.querySelector('input[name="loginfmt"]') || document.querySelector('input[name="username"]') || document.querySelector('input[name="email"]') || document.querySelector('input[id*="user"]') || document.querySelector('input[id*="email"]') || document.querySelector('input[type="email"]') || document.querySelector('input[placeholder*="mail" i]') || document.querySelector('input[placeholder*="user" i]') || document.querySelector('input[placeholder*="Skype" i]') || document.querySelector('input[type="text"]:not([type="hidden"])') || Array.from(document.querySelectorAll('input')).find(function(i){ return i.type !== 'password' && i.type !== 'hidden'; });
      }
      function findPasswordInput() {
        return document.querySelector('#i0118') || document.querySelector('input[name="passwd"]') || document.querySelector('input[name="password"]') || document.querySelector('input[id*="pass"]') || document.querySelector('input[type="password"]');
      }
      function findNextButton() {
        return document.querySelector('#idSIButton9') || document.querySelector('input[type="submit"]') || document.querySelector('input[value="Next"]') || Array.from(document.querySelectorAll('input[type="submit"], button')).find(function(b){ var t = (b.value || b.textContent || '').trim(); return /^next$/i.test(t) || /^continuar$/i.test(t) || /^weiter$/i.test(t); });
      }
      function findSignInButton() {
        var s = document.querySelector('#idSIButton9') || document.querySelector('input[value="Sign in"]') || document.querySelector('input[value="Sign  in"]') || document.querySelector('input[type="submit"]') || document.querySelector('button[type="submit"]');
        if (s) return s;
        var candidates = document.querySelectorAll('input[type="submit"], input[type="button"], button, [role="button"]');
        for (var i = 0; i < candidates.length; i++) {
          var t = (candidates[i].value || candidates[i].textContent || candidates[i].innerText || '').trim().toLowerCase();
          if (t.indexOf('sign') >= 0 && t.indexOf('in') >= 0) return candidates[i];
          if (/signin|submit|login|conectare|trimite/.test(t)) return candidates[i];
        }
        return document.querySelector('form input[type="submit"]') || document.querySelector('form button[type="submit"]') || document.querySelector('input[type="submit"]') || document.querySelector('button[type="submit"]');
      }
      var emailInp = findEmailInput();
      var passInp = findPasswordInput();
      if (emailInp && !passInp && email) {
        setInputValueLikeUser(emailInp, email);
        setTimeout(function(){ var n = findNextButton(); if (n) n.click(); }, 1200);
      } else if (passInp && pass) {
        if (emailInp && email) {
          setInputValueLikeUser(emailInp, email);
          setTimeout(function() {
            setInputValueLikeUser(passInp, pass);
            setTimeout(function(){ var s = findSignInButton(); if (s) s.click(); }, 800);
          }, 600);
        } else {
          setInputValueLikeUser(passInp, pass);
          setTimeout(function(){ var s = findSignInButton(); if (s) s.click(); }, 800);
        }
      }
    })();
  `;
}

/** Extrage o dată din numele fișierului (ex. meniu_18.02.2025.pdf, 2025-02-18_meniu.pdf) pentru fallback când Modified nu e în pagină. */
function getDateFromFileName(name) {
  if (!name || typeof name !== 'string') return null;
  const m = name.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})|(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (!m) return null;
  const d = m[1] ? new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)) : new Date(parseInt(m[6], 10), parseInt(m[5], 10) - 1, parseInt(m[4], 10));
  return isNaN(d.getTime()) ? null : d.getTime();
}

function getModifiedTime(link) {
  if (link.modified && typeof link.modified === 'string') {
    const t = new Date(link.modified).getTime();
    if (!Number.isNaN(t) && t > 0) return t;
  }
  return getDateFromFileName(link.name) || 0;
}

/** Nume rezonabil de fișier PDF (exclude textul întregii pagini folosit greșit ca "name"). */
function isReasonablePdfFileName(name) {
  if (!name || typeof name !== 'string') return false;
  const n = name.trim();
  if (n.length > 180 || !n.toLowerCase().endsWith('.pdf')) return false;
  const pageChrome = /Home|Notebook|Documents|Recycle|Site Contents|Modified By|Sensitivity|Details|Return to classic|Add shortcut|Copy link/i;
  if (pageChrome.test(n)) return false;
  return true;
}

/**
 * Meniu: 1) link care conține label "Meniu", cel mai actual după Modified; 2) fără label, cel mai actual; 3) la egalitate de dată, preferă numele mai lung (fișier complet, ex. "Meniu AUMOVIO 23 FEB-01 MAR.pdf" peste "MAR.pdf").
 */
function pickMeniuLink(links, labelMeniu) {
  const lower = (labelMeniu || 'meniu').toLowerCase();
  const valid = links.filter((l) => isReasonablePdfFileName(l.name));
  const byModifiedOrName = (a, b) => {
    const ta = getModifiedTime(a);
    const tb = getModifiedTime(b);
    if (tb !== ta) return tb - ta;
    const lenDiff = (b.name || '').length - (a.name || '').length;
    if (lenDiff !== 0) return lenDiff;
    return (b.name || '').localeCompare(a.name || '');
  };
  const withLabel = valid.filter(
    (l) => (l.name && l.name.toLowerCase().includes(lower)) || (l.text && l.text.toLowerCase().includes(lower))
  );
  if (withLabel.length > 0) {
    withLabel.sort(byModifiedOrName);
    return withLabel[0];
  }
  if (valid.length === 0) return null;
  const sorted = [...valid].sort(byModifiedOrName);
  return sorted[0];
}

/**
 * Link care conține labelProgram (în nume sau text), cel mai recent după sortare descrescătoare pe nume.
 * Se iau doar linkuri cu nume rezonabil de fișier (exclude textul întregii pagini).
 */
function pickProgramLink(links, labelProgram) {
  const label = (labelProgram || '').trim().toLowerCase();
  if (!label) return null;
  const valid = links.filter((l) => isReasonablePdfFileName(l.name));
  const matches = valid.filter(
    (l) => (l.name && l.name.toLowerCase().includes(label)) || (l.text && l.text.toLowerCase().includes(label))
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
  return matches[0];
}

/**
 * Descarcă un PDF folosind sesiunea paginii. Încearcă mai multe URL-uri în ordine:
 * 1) fileUrl (linkul exact din pagină – cel pe care îl folosește SharePoint la click)
 * 2) fileUrl + ?download=1 sau &download=1 (recomandat Microsoft pentru download forțat)
 * 3) href (download.aspx?SourceUrl=... sau URL cu download=1 construit de noi)
 * 4) REST GetFileByServerRelativeUrl( path )/$value
 */
async function downloadPdfWithSession(webContents, link, savePath, log) {
  const logDiag = typeof log === 'function' ? log : () => {};
  const fileUrl = link.fileUrl || link.href;
  const href = link.href;
  const serverRelativePath = link.serverRelativePath || null;
  const altDownloadUrl = link.altDownloadUrl || null;
  const altFileUrl = link.altFileUrl || null;
  const script = `
    (function() {
      var origin = window.location.origin || (window.location.protocol + '//' + window.location.host);
      var fileUrl = ${JSON.stringify(fileUrl)};
      var href = ${JSON.stringify(href)};
      var serverRelativePath = ${JSON.stringify(serverRelativePath)};
      var altDownloadUrl = ${JSON.stringify(altDownloadUrl)};
      var altFileUrl = ${JSON.stringify(altFileUrl)};
      function toBase64(buf) {
        var bytes = new Uint8Array(buf);
        var chunkSize = 8192;
        var binary = '';
        for (var i = 0; i < bytes.length; i += chunkSize) {
          var chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
          for (var j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]);
        }
        return btoa(binary);
      }
      var FETCH_TIMEOUT_MS = 12000;
      function tryFetch(u, useInclude) {
        if (!u) return Promise.reject(new Error('No URL'));
        var cred = useInclude ? 'include' : 'same-origin';
        var p = fetch(u, { method: 'GET', credentials: cred })
          .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
          .then(toBase64);
        var t = new Promise(function(_, rej) { setTimeout(function() { rej(new Error('Timeout')); }, FETCH_TIMEOUT_MS); });
        return Promise.race([p, t]);
      }
      function withDownload1(url) {
        if (!url) return null;
        return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'download=1';
      }
      function restValue(path) {
        if (!path || path.indexOf('_layouts') >= 0) return null;
        var q = "'";
        var safe = path.replace(new RegExp(q, 'g'), q + q);
        return origin + '/_api/web/GetFileByServerRelativeUrl(' + q + safe + q + ')/$value';
      }
      var seq = [];
      var labels = [];
      if (serverRelativePath) {
        var restU = restValue(serverRelativePath);
        if (restU) { seq.push(function() { return tryFetch(restU); }, function() { return tryFetch(restU, true); }); labels.push('REST(serverRelativePath)', 'REST(serverRelativePath,include)'); }
      }
      if (altFileUrl) {
        seq.push(function() { return tryFetch(altFileUrl); }, function() { return tryFetch(altFileUrl, true); });
        labels.push('altFileUrl(direct)', 'altFileUrl(include)');
      }
      if (altDownloadUrl) {
        seq.push(function() { return tryFetch(altDownloadUrl); }, function() { return tryFetch(altDownloadUrl, true); });
        labels.push('altDownloadUrl(download.aspx)', 'altDownloadUrl(include)');
      }
      seq.push(function() { return tryFetch(fileUrl); }, function() { return tryFetch(withDownload1(fileUrl)); }, function() { return tryFetch(href); }, function() { return tryFetch(fileUrl, true); }, function() { return tryFetch(withDownload1(fileUrl), true); });
      labels.push('fileUrl', 'fileUrl+download=1', 'href(download.aspx)', 'fileUrl(include)', 'fileUrl+download(include)');
      var tried = [];
      function tryWithLog(idx) {
        if (idx >= seq.length) {
          var path = null;
          try { var u = new URL(fileUrl); path = u.pathname; } catch (e) {}
          if (!path) return Promise.resolve({ base64: null, tried: tried, lastError: 'No path' });
          var restU = restValue(path);
          if (restU) {
            return tryFetch(restU).then(function(b) { return { base64: b, tried: tried }; }).catch(function(e) {
              tried.push({ label: 'REST(pathname)', error: (e && e.message) || String(e) });
              return tryFetch(restU, true).then(function(b) { return { base64: b, tried: tried }; }).catch(function(e2) {
                tried.push({ label: 'REST(pathname,include)', error: (e2 && e2.message) || String(e2) });
                return { base64: null, tried: tried, lastError: (e2 && e2.message) || 'REST failed' };
              });
            });
          }
          return Promise.resolve({ base64: null, tried: tried, lastError: 'No REST path' });
        }
        var label = labels[idx] || ('attempt ' + (idx + 1));
        return seq[idx]().then(function(base64) {
          if (base64 && base64.length > 0) return { base64: base64, tried: tried };
          tried.push({ label: label, error: 'Empty response' });
          return tryWithLog(idx + 1);
        }).catch(function(e) {
          tried.push({ label: label, error: (e && e.message) || String(e) });
          return tryWithLog(idx + 1);
        });
      }
      return tryWithLog(0);
    })();
  `;
  const DOWNLOAD_TIMEOUT_MS = 45000;
  try {
    const result = await Promise.race([
      webContents.executeJavaScript(script),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 45s')), DOWNLOAD_TIMEOUT_MS))
    ]);
    const base64 = result && (typeof result === 'string' ? result : result.base64);
    if (result && typeof result === 'object' && result.tried && result.tried.length > 0 && !base64) {
      result.tried.forEach((t, i) => {
        logDiag('[CanteenDownload]   Esec incercare ' + (i + 1) + ' (' + (t.label || '') + '): ' + (t.error || ''));
      });
      if (result.lastError) logDiag('[CanteenDownload]   Ultima eroare: ' + result.lastError);
    }
    if (!base64 || typeof base64 !== 'string') return false;
    const buf = Buffer.from(base64, 'base64');
    if (buf.length < 8) return false;
    if (buf[0] !== 0x25 || buf[1] !== 0x50 || buf[2] !== 0x44 || buf[3] !== 0x46) {
      return false;
    }
    await fs.writeFile(savePath, buf);
    return true;
  } catch (e) {
    logDiag('[CanteenDownload]   Exceptie download: ' + (e && e.message));
    return false;
  }
}

/**
 * Rulează fluxul: fereastră hidden → load URL → login → extrage PDF-uri → descarcă cele 2 → închide fereastra.
 * @param {Object} options - { locationUrl, labelMeniu, labelProgram, email, password, saveDirPdfs }
 * @param {Function} log - (msg) => {} pentru consolă
 * @returns {Promise<{ ok: boolean, meniuPath?: string, programPath?: string, error?: string }>}
 */
async function runCanteenMenuDownload(options, log) {
  const logger = log || (() => {});
  const { locationUrl, labelMeniu, labelProgram, email, password, saveDirPdfs, showWindow } = options;
  const visible = showWindow === true;
  if (visible) logger('[CanteenDownload] Mod vizibil: fereastra SharePoint va fi afisata.');
  logger('[CanteenDownload] ---------- Conectare la locatie SharePoint ----------');
  if (!locationUrl || !locationUrl.startsWith('http')) {
    logger('[CanteenDownload] Eroare: locatie invalida (URL lipseste sau nu incepe cu http).');
    return { ok: false, error: 'Locație invalidă (URL).' };
  }
  if (!saveDirPdfs) {
    logger('[CanteenDownload] Eroare: lipseste directorul de salvare (saveDirPdfs).');
    return { ok: false, error: 'Lipsește directorul de salvare.' };
  }
  logger('[CanteenDownload] URL: ' + locationUrl.substring(0, 70) + (locationUrl.length > 70 ? '...' : ''));
  logger('[CanteenDownload] Label Meniu cautat: "' + (labelMeniu || 'Meniu') + '" | Label Program cautat: "' + (labelProgram || '') + '"');
  if (!email || !password) {
    logger('[CanteenDownload] Avertisment: CANTEEN_LOGIN_EMAIL sau CANTEEN_LOGIN_PASSWORD lipsesc - pagina poate ramane pe login sau cerere autentificare.');
  } else {
    logger('[CanteenDownload] Credentiale: email setat (' + (email.substring(0, 5) + '...') + '), parola setata. Se va incerca login automat.');
  }

  let win = null;
  try {
    await fs.mkdir(saveDirPdfs, { recursive: true });
    const entries = await fs.readdir(saveDirPdfs, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isFile()) {
        await fs.unlink(path.join(saveDirPdfs, e.name)).catch(() => {});
      }
    }
    logger('[CanteenDownload] Director pdfs golit, descarc doar de pe SharePoint.');
  } catch (e) {
    logger('[CanteenDownload] Eroare creare/golire director pdfs: ' + (e.message || e));
    return { ok: false, error: 'Nu s-a putut crea directorul pdfs: ' + (e.message || e) };
  }

  return new Promise((resolve) => {
    win = new BrowserWindow({
      width: 900,
      height: 700,
      show: visible,
      title: visible ? 'Canteen – SharePoint (conectare vizibila)' : undefined,
      webPreferences: {
        partition: CANTEEN_DOWNLOAD_PARTITION,
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    const done = (result) => {
      if (win && !win.isDestroyed()) {
        try {
          win.close();
          win = null;
        } catch (e) {}
      }
      if (result.ok) {
        logger('[CanteenDownload] Succes: meniu=' + (result.meniuPath || '-') + ', program=' + (result.programPath || '-'));
      } else {
        logger('[CanteenDownload] Esec: ' + (result.error || 'necunoscut'));
      }
      logger('[CanteenDownload] ---------- Sfarsit descarcare ----------');
      resolve(result);
    };

    win.webContents.on('did-finish-load', async () => {
      const url = win.webContents.getURL();
      logger('[CanteenDownload] Pagina incarcata: ' + url.substring(0, 90));

      const isLoginPage = /login|adfs|microsoftonline|signin|auth/i.test(url);
      if (isLoginPage && email && password) {
        logger('[CanteenDownload] Pagina de login detectata. Astept ' + (INITIAL_WAIT_MS / 1000) + 's ca butonul sa apara...');
        await new Promise((r) => setTimeout(r, INITIAL_WAIT_MS));
        try {
          await win.webContents.executeJavaScript(getLoginScript(email, password));
          logger('[CanteenDownload] Script login Power BI/Microsoft rulat (click-uri programate la 1.2s / 0.8s). Astept 2.5s...');
          await new Promise((r) => setTimeout(r, 2500));
          await win.webContents.executeJavaScript(getLoginScript(email, password));
          logger('[CanteenDownload] Retry script. Astept ' + (LOGIN_WAIT_MS / 1000) + 's pentru redirect...');
          await new Promise((r) => setTimeout(r, LOGIN_WAIT_MS));
        } catch (e) {
          logger('[CanteenDownload] Eroare injectare login: ' + (e.message || e));
        }
        if (!win || win.isDestroyed()) return;
      } else if (!isLoginPage) {
        logger('[CanteenDownload] Pagina target (nu login). Astept ' + (EXTRACT_WAIT_MS / 1000) + 's inainte de extragere linkuri.');
      } else {
        logger('[CanteenDownload] Fara credentiale - nu s-a facut login.');
      }

      await new Promise((r) => setTimeout(r, EXTRACT_WAIT_MS));

      if (!win || win.isDestroyed()) return;
      let links = [];
      const script = getPdfLinksScript();
      function getAllFrames(frame, list) {
        if (!frame) return list;
        list.push(frame);
        try {
          const frames = frame.frames || [];
          for (let i = 0; i < frames.length; i++) getAllFrames(frames[i], list);
        } catch (err) {}
        return list;
      }
      try {
        const mainFrame = win.webContents.mainFrame;
        const frames = mainFrame ? getAllFrames(mainFrame, []) : [];
        const seen = new Set();
        for (const frame of frames) {
          try {
            const frameLinks = await frame.executeJavaScript(script);
            if (Array.isArray(frameLinks)) {
              (frameLinks || []).forEach((l) => {
                if (l && l.href && !seen.has(l.href)) {
                  seen.add(l.href);
                  links.push(l);
                }
              });
            }
          } catch (err) {
            // ignore (cross-origin or unavailable frame)
          }
        }
      } catch (e) {
        logger('[CanteenDownload] Eroare extragere linkuri PDF din pagina: ' + (e.message || e));
        return done({ ok: false, error: 'Nu s-au putut extrage linkurile PDF: ' + (e.message || e) });
      }

      logger('[CanteenDownload] ---------- Lista PDF-uri disponibile pe pagina ----------');
      logger('[CanteenDownload] Total linkuri PDF gasite: ' + (links.length || 0));
      (links || []).forEach((l, i) => {
        const name = (l.name || l.href?.split('/').pop() || '?').trim();
        const modifiedDisplay = l.modified ? l.modified : '(nu s-a extras din pagina)';
        logger('[CanteenDownload]   ' + (i + 1) + '. name="' + name + '"');
        logger('[CanteenDownload]       Modified (SharePoint): ' + modifiedDisplay);
        if (l.text && l.text.trim()) logger('[CanteenDownload]       text: ' + (l.text.trim().substring(0, 60) + (l.text.length > 60 ? '...' : '')));
      });
      logger('[CanteenDownload] ---------- Sfarsit lista PDF-uri ----------');

      const meniuLink = pickMeniuLink(links, labelMeniu);
      const programLink = pickProgramLink(links, labelProgram);

      if (!meniuLink && !programLink) {
        logger('[CanteenDownload] Eroare: niciun PDF gasit pentru label Meniu ("' + (labelMeniu || 'Meniu') + '") sau Program ("' + (labelProgram || '') + '"). Verifica label-urile in dashboard.');
        return done({ ok: false, error: 'Nu s-a găsit niciun PDF pentru label-urile setate (Meniu / Program). Verifică label-urile în dashboard și că pagina conține linkuri .pdf.' });
      }
      function logSelectedPdf(prefix, link) {
        if (!link) return;
        logger('[CanteenDownload] ---------- ' + prefix + ' ----------');
        logger('[CanteenDownload]   Nume fisier: ' + (link.name || '(lipsa)'));
        logger('[CanteenDownload]   Data modificare: ' + (link.modified || '(nu s-a extras)'));
        logger('[CanteenDownload]   URL-uri de incercat la descarcare:');
        const u1 = link.fileUrl || link.href || '';
        const u2 = link.href || '';
        const u3 = link.serverRelativePath || '';
        const u4 = link.altFileUrl || '';
        const u5 = link.altDownloadUrl || '';
        if (u1) logger('[CanteenDownload]     1. fileUrl: ' + (u1.length > 75 ? u1.substring(0, 72) + '...' : u1));
        if (u2 && u2 !== u1) logger('[CanteenDownload]     2. href: ' + (u2.length > 75 ? u2.substring(0, 72) + '...' : u2));
        if (u3) logger('[CanteenDownload]     3. serverRelativePath (REST): ' + u3);
        if (u4) logger('[CanteenDownload]     4. altFileUrl (direct): ' + (u4.length > 75 ? u4.substring(0, 72) + '...' : u4));
        if (u5) logger('[CanteenDownload]     5. altDownloadUrl (download.aspx): ' + (u5.length > 75 ? u5.substring(0, 72) + '...' : u5));
        logger('[CanteenDownload] ---------- ----------------- ---');
      }
      if (meniuLink) {
        const byLabel = (labelMeniu || 'meniu').toLowerCase();
        const hasLabel = (meniuLink.name && meniuLink.name.toLowerCase().includes(byLabel)) || (meniuLink.text && meniuLink.text.toLowerCase().includes(byLabel));
        logSelectedPdf('Selectie MENIU (ce dorim sa descarcam)', meniuLink);
        logger('[CanteenDownload] Motiv selectie: ' + (hasLabel ? 'contine label "' + (labelMeniu || 'Meniu') + '"' : 'cel mai actual dupa data Modified'));
      }
      if (programLink) {
        logSelectedPdf('Selectie PROGRAM (ce dorim sa descarcam)', programLink);
      }

      const meniuPath = meniuLink ? path.join(saveDirPdfs, 'meniu_' + Date.now() + '.pdf') : null;
      const programPath = programLink ? path.join(saveDirPdfs, 'program_' + Date.now() + '.pdf') : null;

      let actualMeniuPath = null;
      let actualProgramPath = null;
      if (meniuLink) {
        logger('[CanteenDownload] Descarcare Meniu...');
        const ok = await downloadPdfWithSession(win.webContents, meniuLink, meniuPath, logger);
        if (!ok) logger('[CanteenDownload] Descarcare meniu esuata (vezi incercarile de mai sus).');
        else {
          actualMeniuPath = meniuPath;
          logger('[CanteenDownload] Meniu descarcat: ' + meniuPath);
        }
      }
      if (programLink) {
        logger('[CanteenDownload] Descarcare Program...');
        const ok = await downloadPdfWithSession(win.webContents, programLink, programPath, logger);
        if (!ok) logger('[CanteenDownload] Descarcare program esuata (vezi incercarile de mai sus).');
        else {
          actualProgramPath = programPath;
          logger('[CanteenDownload] Program descarcat: ' + programPath);
        }
      }

      const relMeniu = actualMeniuPath ? path.relative(path.dirname(saveDirPdfs), actualMeniuPath).replace(/\\/g, '/') : null;
      const relProgram = actualProgramPath ? path.relative(path.dirname(saveDirPdfs), actualProgramPath).replace(/\\/g, '/') : null;

      if (!actualMeniuPath && !actualProgramPath) {
        logger('[CanteenDownload] Inchid fereastra descarcare.');
        return done({ ok: false, error: 'Descarcarea PDF-urilor a esuat (timeout sau raspuns ne-PDF de la SharePoint).' });
      }

      logger('[CanteenDownload] Inchid fereastra descarcare.');
      return done({
        ok: true,
        meniuPath: relMeniu,
        programPath: relProgram
      });
    });

    win.on('closed', () => { win = null; });

    logger('[CanteenDownload] Incarcare URL...');
    win.loadURL(locationUrl).catch((e) => {
      logger('[CanteenDownload] Eroare la incarcarea URL (retea / SSL / timeout): ' + (e.message || e));
      done({ ok: false, error: 'Eroare încărcare pagină: ' + (e.message || e) });
    });
  });
}

module.exports = {
  runCanteenMenuDownload
};
