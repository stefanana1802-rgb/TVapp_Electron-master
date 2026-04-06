import React, { useMemo, useState } from 'react';
import {
  FLIGHTBOARD_STEP_TYPES,
  FLIGHTBOARD_PROJECTS_URL_DEFAULT,
  FLIGHTBOARD_STATUS_BASE_DEFAULT,
  buildFlightboardCatalog,
  buildFlightboardLastxUrl,
  buildFlightboardSimpleViewUrl,
  collectFlightboardUrlsFromSections,
  createDefaultFlightboard,
  filterFlightboardProjectEntry,
  newFlightboardSection,
  parseFlightboardProjectString
} from '../../utils/flightboardUtils.js';

function cloneFlightboardForEditor(fb) {
  const d = createDefaultFlightboard();
  if (!fb || typeof fb !== 'object') return d;
  return {
    finalized: !!fb.finalized,
    projectsUrl: fb.projectsUrl || d.projectsUrl,
    statusBase: fb.statusBase || d.statusBase,
    sections:
      Array.isArray(fb.sections) && fb.sections.length > 0
        ? fb.sections.map((s) => ({
            ...s,
            selectedTypes: Array.isArray(s.selectedTypes) ? [...s.selectedTypes] : [],
            generatedUrls: Array.isArray(s.generatedUrls) ? [...s.generatedUrls] : [],
            simpleView: s.simpleView === true,
            xHoursBack: Math.max(1, Math.min(99999, Number(s.xHoursBack) || 150))
          }))
        : [newFlightboardSection()],
    urls: Array.isArray(fb.urls) ? [...fb.urls] : []
  };
}

/**
 * Formular inline (dashboard): același flux ca web_live / web_action.
 * La „Validează și finalizează” apelează onApply cu datele complete + durată totală.
 */
export default function FlightboardProjectEditor({ initialFlightboard, initialDuration, onApply }) {
  const [loadError, setLoadError] = useState('');
  const [loadOk, setLoadOk] = useState('');
  const [loading, setLoading] = useState(false);
  const [rawProjects, setRawProjects] = useState([]);
  const [fb, setFb] = useState(() => cloneFlightboardForEditor(initialFlightboard));
  const [totalDurationSec, setTotalDurationSec] = useState(() => Math.max(10, Number(initialDuration) || 120));

  const { sections, projectsUrl, statusBase } = fb;
  const setProjectsUrl = (v) => setFb((prev) => ({ ...prev, projectsUrl: v }));
  const setStatusBase = (v) => setFb((prev) => ({ ...prev, statusBase: v }));

  const catalog = useMemo(() => {
    const filtered = rawProjects.filter(filterFlightboardProjectEntry);
    return buildFlightboardCatalog(filtered);
  }, [rawProjects]);

  const projectKeys = useMemo(() => Object.keys(catalog).sort(), [catalog]);

  const loadDatabase = async () => {
    if (!window.api?.fetchFlightboardProjects) {
      setLoadError('API indisponibil (repornește aplicația).');
      return;
    }
    setLoading(true);
    setLoadError('');
    setLoadOk('');
    try {
      const res = await window.api.fetchFlightboardProjects(projectsUrl.trim() || undefined);
      if (!res?.ok) {
        setLoadError(res?.error || 'Eroare la încărcare');
        setRawProjects([]);
        return;
      }
      const list = Array.isArray(res.projects) ? res.projects : [];
      setRawProjects(list);
      const filtered = list.filter(filterFlightboardProjectEntry);
      const parsed = filtered.map(parseFlightboardProjectString).filter(Boolean);
      setLoadOk(`${list.length} intrări API → ${parsed.length} după filtru (cust-release / feature/padit-).`);
    } catch (e) {
      setLoadError(e?.message || 'Eroare rețea');
      setRawProjects([]);
    } finally {
      setLoading(false);
    }
  };

  const updateSection = (id, patch) => {
    setFb((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === id ? { ...s, ...patch } : s))
    }));
  };

  const addSection = () =>
    setFb((prev) => ({ ...prev, sections: [...prev.sections, newFlightboardSection()] }));
  const removeSection = (id) => {
    setFb((prev) =>
      prev.sections.length <= 1 ? prev : { ...prev, sections: prev.sections.filter((s) => s.id !== id) }
    );
  };

  const toggleType = (secId, type) => {
    setFb((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => {
        if (s.id !== secId) return s;
        const set = new Set(s.selectedTypes);
        if (set.has(type)) set.delete(type);
        else set.add(type);
        return { ...s, selectedTypes: [...set] };
      })
    }));
  };

  const generateForSection = (sec) => {
    if (!sec.project || !sec.flavor || !sec.branch) {
      setLoadError('Selectează Proiect, Flavor și Branch în fiecare secțiune înainte de generare.');
      return;
    }
    if (!sec.selectedTypes.length && !sec.simpleView) {
      setLoadError('Bifează cel puțin un tip (ex. SWCT_fast) sau SimpleView.');
      return;
    }
    setLoadError('');
    const lastX = Math.max(1, Math.min(20, Number(sec.lastX) || 4));
    const xHoursBack = Math.max(1, Math.min(99999, Number(sec.xHoursBack) || 150));
    const urls = [];
    for (const stepType of sec.selectedTypes) {
      const url = buildFlightboardLastxUrl(
        {
          project: sec.project,
          flavor: sec.flavor,
          branch: sec.branch,
          lastX,
          stepType
        },
        statusBase.trim() || FLIGHTBOARD_STATUS_BASE_DEFAULT
      );
      if (url) urls.push(url);
    }
    if (sec.simpleView) {
      const sv = buildFlightboardSimpleViewUrl({
        project: sec.project,
        flavor: sec.flavor,
        branch: sec.branch,
        xHoursBack
      });
      if (sv) urls.push(sv);
    }
    updateSection(sec.id, { generatedUrls: urls, lastX, xHoursBack });
  };

  const deleteUrlInSection = (secId, index) => {
    setFb((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === secId ? { ...s, generatedUrls: s.generatedUrls.filter((_, i) => i !== index) } : s
      )
    }));
  };

  const handleFinalize = () => {
    const urls = collectFlightboardUrlsFromSections(sections);
    if (urls.length === 0) {
      setLoadError('Nu există link-uri generate. Folosește „Generează link-uri” în secțiuni.');
      return;
    }
    setLoadError('');
    const total = Math.max(10, Number(totalDurationSec) || 120);
    onApply({
      projectsUrl: projectsUrl.trim() || FLIGHTBOARD_PROJECTS_URL_DEFAULT,
      statusBase: statusBase.trim() || FLIGHTBOARD_STATUS_BASE_DEFAULT,
      sections: sections.map((s) => ({
        ...s,
        selectedTypes: [...s.selectedTypes],
        generatedUrls: [...s.generatedUrls],
        simpleView: s.simpleView === true,
        xHoursBack: Math.max(1, Math.min(99999, Number(s.xHoursBack) || 150))
      })),
      urls,
      totalDuration: total
    });
  };

  return (
    <div className="mt-2 space-y-3 text-sm rounded-lg border border-blue-200 bg-white p-3">
      <p className="text-xs text-gray-600">
        Încarcă baza de date înainte de selectare. După validare, în listă rămâne doar rezumatul Flightboard (durată,
        Editare, Ștergere).
      </p>

      <div className="space-y-2 rounded-lg border border-gray-200 p-3 bg-gray-50">
        <label className="block text-xs font-medium text-gray-700">URL API projects</label>
        <input
          type="url"
          value={projectsUrl}
          onChange={(e) => setProjectsUrl(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono"
        />
        <label className="block text-xs font-medium text-gray-700 mt-2">Bază PublicBuildStatus / lastx.php</label>
        <input
          type="url"
          value={statusBase}
          onChange={(e) => setStatusBase(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono"
        />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={loadDatabase}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? 'Se încarcă…' : 'Load database'}
          </button>
          {loadOk && <span className="text-xs text-green-700">{loadOk}</span>}
          {loadError && <span className="text-xs text-red-600">{loadError}</span>}
        </div>
      </div>

      {!projectKeys.length && rawProjects.length === 0 && (
        <p className="text-amber-700 text-xs">Apasă „Load database” pentru a încărca proiectele filtrate.</p>
      )}

      {sections.map((sec, idx) => (
        <div key={sec.id} className="rounded-lg border border-gray-200 p-3 space-y-2 bg-gray-50/80">
          <div className="flex justify-between items-center">
            <span className="font-medium text-gray-800">Proiect #{idx + 1}</span>
            {sections.length > 1 && (
              <button type="button" onClick={() => removeSection(sec.id)} className="text-xs text-red-600 hover:underline">
                Șterge secțiunea
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-gray-600 mb-0.5">Project</label>
              <select
                value={sec.project}
                onChange={(e) => updateSection(sec.id, { project: e.target.value, flavor: '', branch: '' })}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                disabled={!projectKeys.length}
              >
                <option value="">— alege —</option>
                {projectKeys.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-0.5">Flavor</label>
              <select
                value={sec.flavor}
                onChange={(e) => updateSection(sec.id, { flavor: e.target.value, branch: '' })}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                disabled={!sec.project || !catalog[sec.project]}
              >
                <option value="">— alege —</option>
                {(sec.project && catalog[sec.project] ? Object.keys(catalog[sec.project]).sort() : []).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-0.5">Branch</label>
              <select
                value={sec.branch}
                onChange={(e) => updateSection(sec.id, { branch: e.target.value })}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                disabled={!sec.project || !sec.flavor || !catalog[sec.project]?.[sec.flavor]}
              >
                <option value="">— alege —</option>
                {(catalog[sec.project]?.[sec.flavor] || []).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-0.5">Last X (1–20)</label>
              <input
                type="number"
                min={1}
                max={20}
                value={sec.lastX}
                onChange={(e) =>
                  updateSection(sec.id, {
                    lastX: Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 4))
                  })
                }
                className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => generateForSection(sec)}
              className="px-3 py-1.5 rounded-lg border border-gray-800 text-gray-900 text-sm hover:bg-gray-100"
            >
              Generează link-uri
            </button>
          </div>

          <div>
            <span className="block text-xs text-gray-600 mb-1">Tipuri build (multiple)</span>
            <div className="flex flex-wrap gap-x-3 gap-y-1 items-center">
              {FLIGHTBOARD_STEP_TYPES.map((t) => (
                <label key={t} className="inline-flex items-center gap-1 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sec.selectedTypes.includes(t)}
                    onChange={() => toggleType(sec.id, t)}
                  />
                  {t}
                </label>
              ))}
              <label className="inline-flex items-center gap-1 text-xs cursor-pointer font-medium text-gray-800">
                <input
                  type="checkbox"
                  checked={sec.simpleView === true}
                  onChange={(e) => updateSection(sec.id, { simpleView: e.target.checked })}
                />
                SimpleView
              </label>
            </div>
            {sec.simpleView && (
              <div className="mt-2">
                <label className="block text-xs text-gray-600 mb-0.5">How many hours back from now</label>
                <input
                  type="number"
                  min={1}
                  max={99999}
                  value={sec.xHoursBack ?? 150}
                  onChange={(e) =>
                    updateSection(sec.id, {
                      xHoursBack: Math.max(1, Math.min(99999, parseInt(e.target.value, 10) || 150))
                    })
                  }
                  className="w-28 rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </div>
            )}
          </div>

          {sec.generatedUrls.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-gray-700">Link-uri generate</span>
              {sec.generatedUrls.map((url, ui) => (
                <div key={`${url}-${ui}`} className="flex gap-1 items-start">
                  <input
                    readOnly
                    value={url}
                    className="flex-1 text-xs rounded border border-gray-200 px-2 py-1 font-mono bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => deleteUrlInSection(sec.id, ui)}
                    className="shrink-0 text-xs text-red-600 px-2 py-1 hover:underline"
                  >
                    Șterge
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      <button type="button" onClick={addSection} className="text-sm text-gray-700 hover:text-gray-900 underline">
        + Adaugă proiect (secțiune nouă)
      </button>

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200">
        <label className="text-sm text-gray-700">Durată totală slideshow (sec)</label>
        <input
          type="number"
          min={10}
          max={86400}
          value={totalDurationSec}
          onChange={(e) => setTotalDurationSec(Math.max(10, parseInt(e.target.value, 10) || 120))}
          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <span className="text-xs text-gray-500">Împărțit la nr. link-uri (min. 5s / slide în player)</span>
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={handleFinalize}
          className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800"
        >
          Validează și finalizează
        </button>
      </div>
    </div>
  );
}
