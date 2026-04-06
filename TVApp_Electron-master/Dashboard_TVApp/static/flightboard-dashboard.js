/**
 * Flightboard Project – logică pentru Dashboard_TVApp (fără Electron).
 * Așteaptă în DOM elementele cu id modalFb* din panelFlightboard.
 */
(function (global) {
  var DEFAULT_PROJECTS = 'https://flightboard-query-prod.cmo.aws.automotive.cloud/rest/projects';
  var DEFAULT_STATUS = 'https://asf42.cmo.aws.automotive.cloud/PublicBuildStatus/lastx.php';
  var DEFAULT_SIMPLEVIEW_BASE = 'https://asf42.cmo.aws.automotive.cloud/wpp/#/flightBoard';
  var STEP_TYPES = [
    'SWCT_fast', 'SWCT_full', 'QAC_fast', 'QAC_full', 'ECU_fast', 'ECU_full',
    'CPI_fast', 'CPI_full', 'HIL_fast', 'HIL_full', 'SIL_fast', 'SIL_full'
  ];

  function newSection() {
    return {
      id: 'fb-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      project: '',
      flavor: '',
      branch: '',
      lastX: 4,
      selectedTypes: [],
      generatedUrls: [],
      simpleView: false,
      xHoursBack: 150
    };
  }

  function createDefaultFlightboard() {
    return {
      finalized: false,
      projectsUrl: DEFAULT_PROJECTS,
      statusBase: DEFAULT_STATUS,
      sections: [newSection()],
      urls: []
    };
  }

  function filterEntry(entry) {
    if (!entry || typeof entry !== 'string') return false;
    return entry.indexOf('cust-release') >= 0 || entry.indexOf('feature/padit-') >= 0;
  }

  function parseEntry(s) {
    if (!s) return null;
    var i1 = s.indexOf('_');
    if (i1 <= 0) return null;
    var i2 = s.indexOf('_', i1 + 1);
    if (i2 <= 0) return null;
    var project = s.slice(0, i1);
    var flavor = s.slice(i1 + 1, i2);
    var branch = s.slice(i2 + 1);
    if (!project || !flavor || !branch) return null;
    return { project: project, flavor: flavor, branch: branch, raw: s };
  }

  function buildCatalog(projectStrings) {
    var tree = {};
    (projectStrings || []).forEach(function (raw) {
      if (!filterEntry(raw)) return;
      var p = parseEntry(raw);
      if (!p) return;
      if (!tree[p.project]) tree[p.project] = {};
      if (!tree[p.project][p.flavor]) tree[p.project][p.flavor] = {};
      tree[p.project][p.flavor][p.branch] = true;
    });
    var out = {};
    Object.keys(tree).sort().forEach(function (proj) {
      out[proj] = {};
      Object.keys(tree[proj]).sort().forEach(function (fl) {
        out[proj][fl] = Object.keys(tree[proj][fl]).sort();
      });
    });
    return out;
  }

  function parseStepToken(token) {
    var t = (token || '').trim();
    var i = t.lastIndexOf('_');
    if (i <= 0) return null;
    var mode = t.slice(i + 1).toLowerCase();
    if (mode !== 'fast' && mode !== 'full') return null;
    var steps = t.slice(0, i).toUpperCase();
    if (!steps) return null;
    return { steps: steps, buildType: mode };
  }

  function buildUrl(project, flavor, branch, lastX, stepType, statusBase) {
    var parsed = parseStepToken(stepType);
    if (!parsed) return null;
    var base = (statusBase || DEFAULT_STATUS).trim();
    var projectValue = project + '_' + flavor + '_' + branch;
    var lx = Math.max(1, Math.min(20, parseInt(lastX, 10) || 4));
    var params = new URLSearchParams();
    params.set('project', projectValue);
    params.set('lastx', String(lx));
    params.set('steps', parsed.steps);
    params.set('buildType', parsed.buildType);
    var sep = base.indexOf('?') >= 0 ? '&' : '?';
    return base + sep + params.toString();
  }

  function buildSimpleViewUrl(project, flavor, branch, hoursBack) {
    var projectValue = project + '_' + flavor + '_' + branch;
    var projectsParam = encodeURIComponent(projectValue);
    var h = Math.max(1, Math.min(99999, parseInt(hoursBack, 10) || 150));
    return DEFAULT_SIMPLEVIEW_BASE + ';projects=' + projectsParam + ';xHoursBack=' + h + ';isToDateNotNow=false';
  }

  function collectUrls(sections) {
    var u = [];
    (sections || []).forEach(function (sec) {
      (sec.generatedUrls || []).forEach(function (x) {
        if (x) u.push(x);
      });
    });
    return u;
  }

  var state = {
    rawProjects: [],
    catalog: {},
    sections: [newSection()],
    projectsUrl: DEFAULT_PROJECTS,
    statusBase: DEFAULT_STATUS,
    loadMsg: ''
  };

  function el(id) {
    return document.getElementById(id);
  }

  function syncInputsFromState() {
    var pu = el('modalFbProjectsUrl');
    var sb = el('modalFbStatusBase');
    if (pu) pu.value = state.projectsUrl;
    if (sb) sb.value = state.statusBase;
  }

  function readInputsToState() {
    var pu = el('modalFbProjectsUrl');
    var sb = el('modalFbStatusBase');
    if (pu) state.projectsUrl = pu.value.trim() || DEFAULT_PROJECTS;
    if (sb) state.statusBase = sb.value.trim() || DEFAULT_STATUS;
  }

  function renderSectionHtml(sec, idx, catalog) {
    var pkeys = Object.keys(catalog).sort();
    var flavors = sec.project && catalog[sec.project] ? Object.keys(catalog[sec.project]).sort() : [];
    var branches = sec.project && sec.flavor && catalog[sec.project] && catalog[sec.project][sec.flavor]
      ? catalog[sec.project][sec.flavor]
      : [];

    var optsP = '<option value="">— alege —</option>' + pkeys.map(function (p) {
      return '<option value="' + esc(p) + '"' + (sec.project === p ? ' selected' : '') + '>' + esc(p) + '</option>';
    }).join('');
    var optsF = '<option value="">— alege —</option>' + flavors.map(function (f) {
      return '<option value="' + esc(f) + '"' + (sec.flavor === f ? ' selected' : '') + '>' + esc(f) + '</option>';
    }).join('');
    var optsB = '<option value="">— alege —</option>' + branches.map(function (b) {
      return '<option value="' + esc(b) + '"' + (sec.branch === b ? ' selected' : '') + '>' + esc(b) + '</option>';
    }).join('');

    var checks = STEP_TYPES.map(function (st) {
      var on = sec.selectedTypes.indexOf(st) >= 0;
      return '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:0.75rem;"><input type="checkbox" class="modal-fb-type-cb" data-sid="' + esc(sec.id) + '" data-type="' + esc(st) + '"' + (on ? ' checked' : '') + '/> ' + esc(st) + '</label>';
    }).join('');
    checks +=
      '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:0.75rem;font-weight:600;"><input type="checkbox" class="modal-fb-simpleview" data-sid="' +
      esc(sec.id) +
      '"' +
      (sec.simpleView ? ' checked' : '') +
      '/> SimpleView</label>';

    var hoursRow = sec.simpleView
      ? '<div style="margin-top:8px;"><label style="font-size:0.75rem;color:var(--muted);display:block;margin-bottom:4px;">How many hours back from now</label><input type="number" class="modal-fb-hoursback" data-sid="' +
        esc(sec.id) +
        '" min="1" max="99999" value="' +
        (parseInt(sec.xHoursBack, 10) || 150) +
        '" style="width:5rem;" /></div>'
      : '';

    var urlRows = (sec.generatedUrls || []).map(function (url, ui) {
      return '<div style="display:flex;gap:6px;margin:4px 0;align-items:center;"><input type="text" readonly value="' + esc(url) + '" style="flex:1;font-size:0.75rem;" /><button type="button" class="small danger modal-fb-del-url" data-sid="' + esc(sec.id) + '" data-ui="' + ui + '">Șterge</button></div>';
    }).join('');

    return (
      '<div class="fb-sec-card" data-sid="' + esc(sec.id) + '" style="border:1px solid #3d434e;border-radius:8px;padding:12px;margin-bottom:10px;background:#2d323c;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><strong>Proiect #' + (idx + 1) + '</strong>' +
      (state.sections.length > 1 ? '<button type="button" class="small danger modal-fb-del-sec" data-sid="' + esc(sec.id) + '">Șterge secțiunea</button>' : '') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;">' +
      '<div><label style="font-size:0.75rem;color:var(--muted);">Project</label><select class="modal-fb-project" data-sid="' + esc(sec.id) + '" ' + (pkeys.length ? '' : 'disabled') + '>' + optsP + '</select></div>' +
      '<div><label style="font-size:0.75rem;color:var(--muted);">Flavor</label><select class="modal-fb-flavor" data-sid="' + esc(sec.id) + '" ' + (sec.project ? '' : 'disabled') + '>' + optsF + '</select></div>' +
      '<div><label style="font-size:0.75rem;color:var(--muted);">Branch</label><select class="modal-fb-branch" data-sid="' + esc(sec.id) + '" ' + (sec.flavor ? '' : 'disabled') + '>' + optsB + '</select></div>' +
      '</div>' +
      '<div style="margin-top:8px;display:flex;gap:10px;align-items:end;flex-wrap:wrap;">' +
      '<div><label style="font-size:0.75rem;color:var(--muted);">Last X</label><input type="number" class="modal-fb-lastx" data-sid="' + esc(sec.id) + '" min="1" max="20" value="' + (parseInt(sec.lastX, 10) || 4) + '" style="width:4rem;" /></div>' +
      '<button type="button" class="small modal-fb-gen" data-sid="' + esc(sec.id) + '">Generează link-uri</button></div>' +
      '<div style="margin-top:8px;"><span style="font-size:0.75rem;color:var(--muted);">Tipuri build</span><div style="margin-top:4px;">' +
      checks +
      '</div>' +
      hoursRow +
      '</div>' +
      (urlRows ? '<div style="margin-top:8px;"><span style="font-size:0.8rem;">Link-uri</span>' + urlRows + '</div>' : '') +
      '</div>'
    );
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function renderSections() {
    var wrap = el('modalFbSections');
    if (!wrap) return;
    readInputsToState();
    wrap.innerHTML = state.sections.map(function (sec, idx) {
      return renderSectionHtml(sec, idx, state.catalog);
    }).join('');

    wrap.querySelectorAll('.modal-fb-project').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var sid = sel.dataset.sid;
        var s = state.sections.find(function (x) { return x.id === sid; });
        if (!s) return;
        s.project = sel.value;
        s.flavor = '';
        s.branch = '';
        renderSections();
      });
    });
    wrap.querySelectorAll('.modal-fb-flavor').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var sid = sel.dataset.sid;
        var s = state.sections.find(function (x) { return x.id === sid; });
        if (!s) return;
        s.flavor = sel.value;
        s.branch = '';
        renderSections();
      });
    });
    wrap.querySelectorAll('.modal-fb-branch').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var sid = sel.dataset.sid;
        var s = state.sections.find(function (x) { return x.id === sid; });
        if (!s) return;
        s.branch = sel.value;
      });
    });
    wrap.querySelectorAll('.modal-fb-lastx').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var sid = inp.dataset.sid;
        var s = state.sections.find(function (x) { return x.id === sid; });
        if (!s) return;
        s.lastX = Math.max(1, Math.min(20, parseInt(inp.value, 10) || 4));
      });
    });
    wrap.querySelectorAll('.modal-fb-type-cb').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var sid = cb.dataset.sid;
        var st = cb.dataset.type;
        var s = state.sections.find(function (x) { return x.id === sid; });
        if (!s) return;
        var i = s.selectedTypes.indexOf(st);
        if (cb.checked && i < 0) s.selectedTypes.push(st);
        if (!cb.checked && i >= 0) s.selectedTypes.splice(i, 1);
      });
    });
    wrap.querySelectorAll('.modal-fb-simpleview').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var sid = cb.dataset.sid;
        var s = state.sections.find(function (x) { return x.id === sid; });
        if (!s) return;
        s.simpleView = !!cb.checked;
        renderSections();
      });
    });
    wrap.querySelectorAll('.modal-fb-hoursback').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var sid = inp.dataset.sid;
        var s = state.sections.find(function (x) { return x.id === sid; });
        if (!s) return;
        s.xHoursBack = Math.max(1, Math.min(99999, parseInt(inp.value, 10) || 150));
      });
    });
    wrap.querySelectorAll('.modal-fb-gen').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sid = btn.dataset.sid;
        var s = state.sections.find(function (x) { return x.id === sid; });
        if (!s || !s.project || !s.flavor || !s.branch) {
          setStatus('Selectează Project, Flavor, Branch.', false);
          return;
        }
        if (!s.selectedTypes.length && !s.simpleView) {
          setStatus('Bifează cel puțin un tip (ex. SWCT_fast) sau SimpleView.', false);
          return;
        }
        readInputsToState();
        var urls = [];
        s.selectedTypes.forEach(function (st) {
          var u = buildUrl(s.project, s.flavor, s.branch, s.lastX, st, state.statusBase);
          if (u) urls.push(u);
        });
        if (s.simpleView) {
          var hb = Math.max(1, Math.min(99999, parseInt(s.xHoursBack, 10) || 150));
          s.xHoursBack = hb;
          urls.push(buildSimpleViewUrl(s.project, s.flavor, s.branch, hb));
        }
        s.generatedUrls = urls;
        s.lastX = Math.max(1, Math.min(20, parseInt(s.lastX, 10) || 4));
        setStatus('Generate: ' + urls.length + ' link-uri.', true);
        renderSections();
      });
    });
    wrap.querySelectorAll('.modal-fb-del-url').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sid = btn.dataset.sid;
        var ui = parseInt(btn.dataset.ui, 10);
        var s = state.sections.find(function (x) { return x.id === sid; });
        if (!s || !s.generatedUrls) return;
        s.generatedUrls.splice(ui, 1);
        renderSections();
      });
    });
    wrap.querySelectorAll('.modal-fb-del-sec').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sid = btn.dataset.sid;
        if (state.sections.length <= 1) return;
        state.sections = state.sections.filter(function (x) { return x.id !== sid; });
        renderSections();
      });
    });
  }

  function setStatus(msg, ok) {
    var s = el('modalFbLoadStatus');
    if (s) {
      s.textContent = msg || '';
      s.style.color = ok ? 'var(--green)' : 'var(--red)';
    }
  }

  function reset() {
    state.rawProjects = [];
    state.catalog = {};
    state.sections = [newSection()];
    state.projectsUrl = DEFAULT_PROJECTS;
    state.statusBase = DEFAULT_STATUS;
    state.loadMsg = '';
    syncInputsFromState();
    renderSections();
    setStatus('', true);
  }

  function loadFromSlide(slide) {
    var fb = slide && slide.flightboard;
    if (!fb || typeof fb !== 'object') {
      reset();
      return;
    }
    state.projectsUrl = fb.projectsUrl || DEFAULT_PROJECTS;
    state.statusBase = fb.statusBase || DEFAULT_STATUS;
    state.sections = Array.isArray(fb.sections) && fb.sections.length
      ? fb.sections.map(function (sec) {
        return {
          id: sec.id || newSection().id,
          project: sec.project || '',
          flavor: sec.flavor || '',
          branch: sec.branch || '',
          lastX: sec.lastX != null ? sec.lastX : 4,
          selectedTypes: Array.isArray(sec.selectedTypes) ? sec.selectedTypes.slice() : [],
          generatedUrls: Array.isArray(sec.generatedUrls) ? sec.generatedUrls.slice() : [],
          simpleView: sec.simpleView === true,
          xHoursBack: Math.max(1, Math.min(99999, parseInt(sec.xHoursBack, 10) || 150))
        };
      })
      : [newSection()];
    state.rawProjects = [];
    state.catalog = {};
    syncInputsFromState();
    renderSections();
    setStatus('Reîncarcă „Load database” pentru liste Project/Flavor/Branch.', false);
  }

  function validate() {
    readInputsToState();
    var urls = collectUrls(state.sections);
    if (!urls.length) {
      return { ok: false, msg: 'Generează link-uri în fiecare secțiune (buton Generează link-uri).' };
    }
    var dur = parseInt(el('modalFbTotalDuration') && el('modalFbTotalDuration').value, 10) || 120;
    if (dur < 10) return { ok: false, msg: 'Durată totală minim 10 secunde.' };
    return { ok: true, msg: 'Form valid. Apăsați Finalizare.' };
  }

  function buildSlide(enabled, title, subtitle) {
    readInputsToState();
    var urls = collectUrls(state.sections);
    var dur = Math.max(10, parseInt(el('modalFbTotalDuration') && el('modalFbTotalDuration').value, 10) || 120);
    var sections = state.sections.map(function (s) {
      return {
        id: s.id,
        project: s.project,
        flavor: s.flavor,
        branch: s.branch,
        lastX: s.lastX,
        selectedTypes: s.selectedTypes.slice(),
        generatedUrls: (s.generatedUrls || []).slice(),
        simpleView: s.simpleView === true,
        xHoursBack: Math.max(1, Math.min(99999, parseInt(s.xHoursBack, 10) || 150))
      };
    });
    return {
      type: 'flightboard',
      src: '',
      duration: dur,
      title: title || '',
      subtitle: subtitle || '',
      enabled: enabled !== false,
      flightboard: {
        finalized: true,
        projectsUrl: state.projectsUrl,
        statusBase: state.statusBase,
        sections: sections,
        urls: urls
      }
    };
  }

  function bindLoadDb() {
    var btn = el('modalFbLoadDb');
    if (!btn) return;
    if (btn.dataset.fbBound) return;
    btn.dataset.fbBound = '1';
    btn.addEventListener('click', function () {
      readInputsToState();
      var endpoint;
      try {
        endpoint = new URL('/api/flightboard/projects', window.location.href);
        endpoint.search = '';
      } catch (e2) {
        endpoint = { pathname: '/api/flightboard/projects', origin: '' };
      }
      var postUrl = typeof endpoint.toString === 'function' ? endpoint.toString() : (window.location.origin || '') + '/api/flightboard/projects';
      setStatus('Se încarcă…', true);
      fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ url: state.projectsUrl })
      })
        .then(function (r) {
          return r.text().then(function (text) {
            var ct = (r.headers.get('content-type') || '').toLowerCase();
            var looksJson = text && (text.trim().charAt(0) === '{' || text.trim().charAt(0) === '[');
            if (!looksJson && ct.indexOf('application/json') < 0) {
              throw new Error(
                'Răspuns HTML în loc de JSON — endpoint-ul /api/flightboard/projects nu e disponibil pe acest server. ' +
                  'Repornește Dashboard_TVApp după actualizare (python app.py sau rebuild .exe) și deschide dashboard-ul de la același URL (nu file://).'
              );
            }
            var data;
            try {
              data = JSON.parse(text);
            } catch (pe) {
              throw new Error((pe && pe.message) || 'Răspuns invalid');
            }
            if (!r.ok) {
              throw new Error((data && data.error) || 'HTTP ' + r.status);
            }
            return data;
          });
        })
        .then(function (data) {
          if (!data.ok) {
            setStatus(data.error || 'Eroare API', false);
            return;
          }
          state.rawProjects = data.projects || [];
          state.catalog = buildCatalog(state.rawProjects);
          var n = state.rawProjects.length;
          var m = Object.keys(state.catalog).length;
          setStatus(n + ' intrări API; ' + m + ' proiecte după filtru.', true);
          renderSections();
        })
        .catch(function (e) {
          setStatus(e.message || 'Eroare rețea', false);
        });
    });
  }

  function bindAddSection() {
    var btn = el('modalFbAddSection');
    if (!btn || btn.dataset.fbBound) return;
    btn.dataset.fbBound = '1';
    btn.addEventListener('click', function () {
      readInputsToState();
      state.sections.push(newSection());
      renderSections();
    });
  }

  global.FlightboardDashboard = {
    createDefaultFlightboard: createDefaultFlightboard,
    reset: reset,
    loadFromSlide: loadFromSlide,
    validate: validate,
    buildSlide: buildSlide,
    renderSections: renderSections,
    bind: function () {
      syncInputsFromState();
      bindLoadDb();
      bindAddSection();
      renderSections();
    }
  };
})(window);
