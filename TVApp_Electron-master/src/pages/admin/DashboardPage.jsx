import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import FlightboardProjectEditor from '../../components/admin/FlightboardProjectEditor.jsx';
import { createDefaultFlightboard } from '../../utils/flightboardUtils.js';

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [teams, setTeams] = useState([]);
  const [newTeamName, setNewTeamName] = useState('');
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [playlist, setPlaylist] = useState({ slides: [] });
  const [saveStatus, setSaveStatus] = useState('');
  const [canteenSaveStatus, setCanteenSaveStatus] = useState('');
  const [canteen, setCanteen] = useState({
    canteenMenuLocation: '',
    canteenLabelMeniu: 'Meniu',
    canteenLabelProgram: '2025_Cantina',
    slots: [{ time: '11:30', duration: 15 }]
  });
  const [loading, setLoading] = useState(true);
  const [flightboardEditNonce, setFlightboardEditNonce] = useState({});
  const [draggingSlideId, setDraggingSlideId] = useState(null);
  const [dragOverSlideId, setDragOverSlideId] = useState(null);

  const loadTeams = async () => {
    if (!window.api?.getTeams) return;
    const list = await window.api.getTeams();
    setTeams(list || []);
  };

  useEffect(() => {
    loadTeams().finally(() => setLoading(false));
  }, []);


  useEffect(() => {
    if (!selectedTeam || !window.api?.getPlaylistForTeam) return;
    window.api.getPlaylistForTeam(selectedTeam).then((data) => {
      const raw = data?.slides ?? [];
      const slides = raw.map((s) => {
        if ((s.type || '').toLowerCase() === 'social_media') {
          const { posts, ...rest } = s;
          return { ...rest, type: 'web_url', src: s.src || '' };
        }
        return s;
      });
      setPlaylist({ slides });
    });
  }, [selectedTeam]);

  useEffect(() => {
    if (!selectedTeam || !window.api?.getSectionContent) return;
    window.api.getSectionContent(selectedTeam, 'canteen_menu').then((data) => {
      if (!data) return;
      setCanteen({
        canteenMenuLocation: (data.canteenMenuLocation || '').trim(),
        canteenLabelMeniu: (data.canteenLabelMeniu || 'Meniu').trim(),
        canteenLabelProgram: (data.canteenLabelProgram || '2025_Cantina').trim(),
        slots: Array.isArray(data.slots) && data.slots.length > 0
          ? data.slots.map((s) => ({ time: s.time || '11:30', duration: s.duration ?? 15 }))
          : [{ time: '11:30', duration: 15 }]
      });
    });
  }, [selectedTeam]);

  const handleCreateTeam = async (e) => {
    e.preventDefault();
    const name = newTeamName.trim();
    if (!name) return;
    const res = await window.api.adminCreateTeam(name);
    if (res.ok) {
      setNewTeamName('');
      await loadTeams();
    } else {
      alert(res.error || 'Eroare la creare');
    }
  };

  const handleDeleteTeam = async (name) => {
    if (!confirm(`Ștergi echipa "${name}" și tot conținutul?`)) return;
    const res = await window.api.adminDeleteTeam(name);
    if (res.ok) {
      if (selectedTeam === name) setSelectedTeam(null);
      await loadTeams();
    } else {
      alert(res.error || 'Eroare la ștergere');
    }
  };

  const handleSavePlaylist = async () => {
    if (!selectedTeam) return;
    setSaveStatus('Se salvează…');
    const toSave = {
      ...playlist,
      slides: (playlist.slides || []).map((s) => ({
        ...s,
        src: (s.src || '').replace(/^workspace:\/\/\.?\//, '')
      }))
    };
    const res = await window.api.adminSavePlaylist(selectedTeam, toSave);
    setSaveStatus(res.ok ? 'Salvat.' : (res.error || 'Eroare'));
    if (res.ok) setTimeout(() => setSaveStatus(''), 2000);
  };

  const addSlide = () => {
    setPlaylist((p) => ({
      ...p,
      slides: [...(p.slides || []), { id: `slide-${Date.now()}`, type: 'web_url', src: 'https://', duration: 10, title: '', subtitle: '' }]
    }));
  };

  const removeSlide = (id) => {
    setPlaylist((p) => ({ ...p, slides: (p.slides || []).filter((s) => s.id !== id) }));
  };

  /** Reordonare: mută slide-ul `slideId` astfel încât să ajungă la poziția vizuală `toIndex` (înainte de slide-ul de la acel index). */
  const moveSlideToIndex = (slideId, toIndex) => {
    setPlaylist((p) => {
      const slides = [...(p.slides || [])];
      const fromIndex = slides.findIndex((s) => s.id === slideId);
      if (fromIndex < 0 || fromIndex === toIndex) return p;
      const next = [...slides];
      const [item] = next.splice(fromIndex, 1);
      let insertAt = toIndex;
      if (fromIndex < toIndex) insertAt = toIndex - 1;
      next.splice(insertAt, 0, item);
      return { ...p, slides: next };
    });
  };

  const updateSlide = (id, field, value) => {
    setPlaylist((p) => ({
      ...p,
      slides: (p.slides || []).map((s) => (s.id === id ? { ...s, [field]: value } : s))
    }));
  };

  const handleSlideTypeChange = (id, newType) => {
    if (newType === 'flightboard') {
      setFlightboardEditNonce((m) => ({ ...m, [id]: (m[id] || 0) + 1 }));
    }
    setPlaylist((p) => ({
      ...p,
      slides: (p.slides || []).map((s) => {
        if (s.id !== id) return s;
        if (newType === 'flightboard') {
          return {
            ...s,
            type: 'flightboard',
            src: '',
            duration: Math.max(10, Number(s.duration) || 120),
            flightboard: createDefaultFlightboard()
          };
        }
        const { flightboard, ...rest } = s;
        return { ...rest, type: newType };
      })
    }));
  };

  const openFlightboardEdit = (slideId) => {
    setFlightboardEditNonce((m) => ({ ...m, [slideId]: (m[slideId] || 0) + 1 }));
    setPlaylist((p) => ({
      ...p,
      slides: (p.slides || []).map((s) => {
        if (s.id !== slideId || (s.type || '').toLowerCase() !== 'flightboard') return s;
        const base = s.flightboard || createDefaultFlightboard();
        return { ...s, flightboard: { ...base, finalized: false } };
      })
    }));
  };

  const applyFlightboardFinalize = (slideId, payload) => {
    setPlaylist((p) => ({
      ...p,
      slides: (p.slides || []).map((s) =>
        s.id === slideId
          ? {
              ...s,
              duration: payload.totalDuration,
              flightboard: {
                projectsUrl: payload.projectsUrl,
                statusBase: payload.statusBase,
                sections: payload.sections,
                urls: payload.urls,
                finalized: true
              }
            }
          : s
      )
    }));
  };

  const handleSaveCanteen = async () => {
    if (!selectedTeam || !window.api?.getSectionContent || !window.api?.adminSaveSectionContent) return;
    setCanteenSaveStatus('Se salvează…');
    const existing = await window.api.getSectionContent(selectedTeam, 'canteen_menu').catch(() => null);
    const merged = {
      ...(existing || {}),
      canteenMenuLocation: canteen.canteenMenuLocation.trim(),
      canteenLabelMeniu: canteen.canteenLabelMeniu.trim() || 'Meniu',
      canteenLabelProgram: canteen.canteenLabelProgram.trim() || '2025_Cantina',
      slots: canteen.slots
    };
    const res = await window.api.adminSaveSectionContent(selectedTeam, 'canteen_menu', merged);
    setCanteenSaveStatus(res.ok ? 'Salvat.' : 'Eroare');
    if (res.ok) setTimeout(() => setCanteenSaveStatus(''), 2000);
  };

  const updateCanteen = (field, value) => {
    setCanteen((c) => ({ ...c, [field]: value }));
  };

  const updateCanteenSlot = (index, field, value) => {
    setCanteen((c) => ({
      ...c,
      slots: c.slots.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    }));
  };

  const addCanteenSlot = () => {
    setCanteen((c) => ({ ...c, slots: [...c.slots, { time: '11:30', duration: 15 }] }));
  };

  const removeCanteenSlot = (index) => {
    setCanteen((c) => ({ ...c, slots: c.slots.filter((_, i) => i !== index) }));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Admin – Panou de control</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user?.email}</span>
          <button
            type="button"
            onClick={logout}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100"
          >
            Deconectare
          </button>
        </div>
      </header>

      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Echipe (WORKSPACE)</h2>
          {loading ? (
            <p className="text-gray-500">Se încarcă…</p>
          ) : (
            <>
              <form onSubmit={handleCreateTeam} className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="Nume echipă nouă"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                />
                <button type="submit" className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800">
                  Adaugă
                </button>
              </form>
              <ul className="space-y-2">
                {teams.map((name) => (
                  <li key={name} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <button
                      type="button"
                      onClick={() => setSelectedTeam(name)}
                      className={`flex-1 text-left font-medium ${selectedTeam === name ? 'text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
                    >
                      {name}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTeam(name)}
                      className="text-red-500 hover:text-red-700 text-sm px-2"
                    >
                      Șterge
                    </button>
                  </li>
                ))}
                {teams.length === 0 && <p className="text-gray-500 text-sm">Nicio echipă. Adaugă una mai sus.</p>}
              </ul>
            </>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Playlist {selectedTeam ? `– ${selectedTeam}` : ''}
          </h2>
          {!selectedTeam ? (
            <p className="text-gray-500 text-sm">Selectează o echipă pentru a edita playlist-ul.</p>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-2">
                Trage de mânerul <span className="font-mono text-gray-700">⠿</span> pentru a schimba ordinea. Apasă <strong>Salvează</strong> ca să se actualizeze slideshow-ul pe TV.
              </p>
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm text-gray-500">{saveStatus}</span>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={addSlide}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-50"
                  >
                    + Slide
                  </button>
                  <button
                    type="button"
                    onClick={handleSavePlaylist}
                    className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800"
                  >
                    Salvează
                  </button>
                </div>
              </div>
              <ul className="space-y-3 max-h-96 overflow-y-auto">
                {(playlist.slides || []).map((slide, i) => {
                  const isFb = (slide.type || '').toLowerCase() === 'flightboard';
                  const fb = slide.flightboard || {};
                  const fbFinal = isFb && fb.finalized === true;
                  const fbEdit = isFb && !fbFinal;
                  return (
                  <li
                    key={slide.id}
                    className={`p-3 rounded-lg border border-gray-200 bg-gray-50 transition-shadow ${
                      dragOverSlideId === slide.id && draggingSlideId !== slide.id
                        ? 'ring-2 ring-blue-500 border-blue-300'
                        : ''
                    } ${draggingSlideId === slide.id ? 'opacity-50' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (draggingSlideId && draggingSlideId !== slide.id) setDragOverSlideId(slide.id);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget)) {
                        setDragOverSlideId((x) => (x === slide.id ? null : x));
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData('text/plain');
                      setDragOverSlideId(null);
                      setDraggingSlideId(null);
                      if (id && id !== slide.id) moveSlideToIndex(id, i);
                    }}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          role="button"
                          tabIndex={0}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', slide.id);
                            e.dataTransfer.effectAllowed = 'move';
                            setDraggingSlideId(slide.id);
                          }}
                          onDragEnd={() => {
                            setDraggingSlideId(null);
                            setDragOverSlideId(null);
                          }}
                          className="cursor-grab active:cursor-grabbing select-none text-gray-400 hover:text-gray-600 px-1 shrink-0 touch-none text-lg leading-none"
                          title="Trage pentru a reordona"
                          aria-label="Trage pentru a reordona"
                        >
                          ⠿
                        </div>
                        <span className="text-xs font-medium text-gray-500 truncate">
                          #{i + 1} {slide.type || 'slide'}
                        </span>
                      </div>
                      <button type="button" onClick={() => removeSlide(slide.id)} className="text-red-500 text-xs hover:underline shrink-0">
                        Elimină
                      </button>
                    </div>
                    {!isFb && (
                    <input
                      value={slide.src || ''}
                      onChange={(e) => updateSlide(slide.id, 'src', e.target.value)}
                      placeholder={((slide.type || '') === 'powerbi' || (slide.src || '').toLowerCase().includes('powerbi')) ? 'https://app.powerbi.com/view?r=...' : 'src (URL sau cale)'}
                      className="w-full mt-1 text-sm rounded border border-gray-300 px-2 py-1"
                    />
                    )}
                    {isFb && fbFinal && (
                      <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2">
                        <span className="text-sm font-semibold text-gray-900">Flightboard Project</span>
                        <span className="text-xs text-gray-600">{(fb.urls || []).length} link-uri</span>
                        <label className="flex items-center gap-1 text-xs text-gray-700">
                          Durată totală (sec)
                          <input
                            type="number"
                            min={10}
                            max={86400}
                            value={slide.duration || 120}
                            onChange={(e) =>
                              updateSlide(slide.id, 'duration', Math.max(10, Number(e.target.value) || 120))
                            }
                            className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => openFlightboardEdit(slide.id)}
                          className="text-sm px-2 py-1 rounded border border-gray-400 text-gray-800 hover:bg-white"
                        >
                          Editare
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSlide(slide.id)}
                          className="text-sm px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
                        >
                          Ștergere
                        </button>
                      </div>
                    )}
                    {isFb && fbEdit && (
                      <FlightboardProjectEditor
                        key={`${slide.id}-${flightboardEditNonce[slide.id] || 0}`}
                        initialFlightboard={slide.flightboard || createDefaultFlightboard()}
                        initialDuration={slide.duration}
                        onApply={(payload) => applyFlightboardFinalize(slide.id, payload)}
                      />
                    )}
                    {!isFb && ((slide.type || '') === 'powerbi' || (slide.src || '').toLowerCase().includes('powerbi')) && (
                      <input
                        value={slide.powerBiPage || ''}
                        onChange={(e) => updateSlide(slide.id, 'powerBiPage', e.target.value)}
                        placeholder="Pagină report (pageName, opțional)"
                        className="w-full mt-1 text-sm rounded border border-gray-300 px-2 py-1"
                      />
                    )}
                    <div className="flex gap-2 mt-1 flex-wrap items-center">
                      <select
                        value={slide.type || 'web_url'}
                        onChange={(e) => handleSlideTypeChange(slide.id, e.target.value)}
                        className="text-sm rounded border border-gray-300 px-2 py-1"
                      >
                        <option value="web_url">web_url</option>
                        <option value="web_live">web_live</option>
                        <option value="web_action">web_action</option>
                        <option value="flightboard">flightboard (Flightboard Project)</option>
                        <option value="powerbi">powerbi (Power BI)</option>
                        <option value="image">image</option>
                        <option value="video">video</option>
                        <option value="vimeo">vimeo</option>
                        <option value="hls">hls</option>
                        <option value="pdf">pdf</option>
                      </select>
                      {!isFb && (
                      <input
                        type="number"
                        value={slide.duration || 10}
                        onChange={(e) => updateSlide(slide.id, 'duration', Number(e.target.value) || 10)}
                        placeholder="durata (s)"
                        className="w-20 text-sm rounded border border-gray-300 px-2 py-1"
                      />
                      )}
                      {isFb && fbEdit && (
                        <span className="text-xs text-gray-500">Durata totală se setează în formular până la finalizare</span>
                      )}
                      {!isFb && (
                      <>
                      <label className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={slide.powerBiAutoScroll !== false}
                          onChange={(e) => updateSlide(slide.id, 'powerBiAutoScroll', e.target.checked)}
                        />
                        <span className="text-gray-600">Auto-scroll Power BI</span>
                      </label>
                      {((slide.type || '') === 'powerbi' || (slide.src || '').toLowerCase().includes('powerbi')) && (
                        <label className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={slide.powerBiApplyLoginScript !== false}
                            onChange={(e) => updateSlide(slide.id, 'powerBiApplyLoginScript', e.target.checked)}
                          />
                          <span className="text-gray-600">Aplică script login</span>
                        </label>
                      )}
                      {(slide.type || '') === 'web_live' && (
                        <label className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={slide.webLiveApplyLoginScript !== false}
                            onChange={(e) => updateSlide(slide.id, 'webLiveApplyLoginScript', e.target.checked)}
                          />
                          <span className="text-gray-600">Aplică script login</span>
                        </label>
                      )}
                      {(slide.type || '') === 'web_live' && (
                        <label className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={slide.webLiveAutoScroll === true}
                            onChange={(e) => updateSlide(slide.id, 'webLiveAutoScroll', e.target.checked)}
                          />
                          <span className="text-gray-600">Auto-scroll</span>
                        </label>
                      )}
                      {(slide.type || '') === 'web_action' && (
                        <>
                          <label className="flex items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              checked={slide.webActionApplyLoginScript === true}
                              onChange={(e) => updateSlide(slide.id, 'webActionApplyLoginScript', e.target.checked)}
                            />
                            <span className="text-gray-600">Autologin</span>
                          </label>
                          <label className="flex items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              checked={slide.webActionAutoScroll === true}
                              onChange={(e) => updateSlide(slide.id, 'webActionAutoScroll', e.target.checked)}
                            />
                            <span className="text-gray-600">Auto-scroll</span>
                          </label>
                          <label className="flex items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              checked={slide.webActionHardLoadEnabled === true}
                              onChange={(e) => updateSlide(slide.id, 'webActionHardLoadEnabled', e.target.checked)}
                            />
                            <span className="text-gray-600" title="Pagina se încarcă în iframe; amână doar autologin, acțiunile și scroll-ul">
                              Hard load delay
                            </span>
                          </label>
                          {slide.webActionHardLoadEnabled === true && (
                            <label className="flex items-center gap-1.5 text-sm">
                              <span className="text-gray-500">Sec (fără auto):</span>
                              <input
                                type="number"
                                min={1}
                                max={600}
                                value={Math.max(1, Math.min(600, Number(slide.webActionHardLoadSeconds) || 5))}
                                onChange={(e) =>
                                  updateSlide(
                                    slide.id,
                                    'webActionHardLoadSeconds',
                                    Math.max(1, Math.min(600, parseInt(e.target.value, 10) || 5))
                                  )
                                }
                                className="w-16 text-sm rounded border border-gray-300 px-2 py-1"
                              />
                            </label>
                          )}
                          <input
                            value={(slide.webActionScripts || []).join(' | ')}
                            onChange={(e) =>
                              updateSlide(
                                slide.id,
                                'webActionScripts',
                                e.target.value.split('|').map((s) => s.trim()).filter(Boolean)
                              )
                            }
                            placeholder="Selectors CSS separate cu |"
                            className="flex-1 min-w-[120px] text-sm rounded border border-gray-300 px-2 py-1"
                          />
                        </>
                      )}
                      {(slide.type || '') === 'web_live' && (
                        <label className="flex items-center gap-1.5 text-sm">
                          <span className="text-gray-500">Zoom fit %:</span>
                          <select
                            value={slide.webLiveFit ?? 250}
                            onChange={(e) => updateSlide(slide.id, 'webLiveFit', Number(e.target.value))}
                            className="text-sm rounded border border-gray-300 px-2 py-1"
                          >
                            <option value={50}>50% (zoom in)</option>
                            <option value={75}>75% (zoom in)</option>
                            <option value={100}>100% (1:1)</option>
                            <option value={150}>150% (scale 0.67)</option>
                            <option value={200}>200% (scale 0.5)</option>
                            <option value={250}>250% (scale 0.4)</option>
                            <option value={300}>300% (scale 0.33)</option>
                            <option value={400}>400% (scale 0.25)</option>
                          </select>
                        </label>
                      )}
                      {((slide.type || '') === 'powerbi' || (slide.src || '').toLowerCase().includes('powerbi')) && (
                        <label className="flex items-center gap-1.5 text-sm">
                          <span className="text-gray-500">Zoom fit %:</span>
                          <select
                            value={slide.powerBiFit ?? 100}
                            onChange={(e) => updateSlide(slide.id, 'powerBiFit', Number(e.target.value))}
                            className="text-sm rounded border border-gray-300 px-2 py-1"
                          >
                            <option value={50}>50% (zoom in)</option>
                            <option value={75}>75% (zoom in)</option>
                            <option value={100}>100% (1:1)</option>
                            <option value={150}>150%</option>
                            <option value={200}>200%</option>
                            <option value={250}>250%</option>
                            <option value={300}>300%</option>
                            <option value={400}>400%</option>
                          </select>
                        </label>
                      )}
                      </>
                      )}
                    </div>
                  </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-6 md:col-span-2">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Cantină – meniu automat {selectedTeam ? `– ${selectedTeam}` : ''}
          </h2>
          {!selectedTeam ? (
            <p className="text-gray-500 text-sm">Selectează o echipă pentru a seta locația și label-urile.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Locație (URL)</label>
                  <input
                    type="url"
                    value={canteen.canteenMenuLocation}
                    onChange={(e) => updateCanteen('canteenMenuLocation', e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-1">Pagina unde se află PDF-urile (login cu CANTEEN_LOGIN_EMAIL / CANTEEN_LOGIN_PASSWORD din .env).</p>
                </div>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Label Meniu</label>
                    <input
                      type="text"
                      value={canteen.canteenLabelMeniu}
                      onChange={(e) => updateCanteen('canteenLabelMeniu', e.target.value)}
                      placeholder="Meniu"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-gray-500 mt-1">PDF care conține acest text (cel mai recent).</p>
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Label Program</label>
                    <input
                      type="text"
                      value={canteen.canteenLabelProgram}
                      onChange={(e) => updateCanteen('canteenLabelProgram', e.target.value)}
                      placeholder="2025_Cantina"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <p className="text-xs text-gray-500 mt-1">PDF al cărui nume începe cu acest text.</p>
                  </div>
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Ore afișare (sloturi)</label>
                <p className="text-xs text-gray-500 mb-1">Ora în format 24h (ex: 16:04 = 4:04 PM) sau cu AM/PM (ex: 4:04 PM). Fără PM, 4:04 = 4:04 AM.</p>
                <div className="space-y-2">
                  {canteen.slots.map((slot, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={slot.time}
                        onChange={(e) => updateCanteenSlot(i, 'time', e.target.value)}
                        placeholder="11:30 sau 16:04"
                        className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                      <input
                        type="number"
                        min={1}
                        max={120}
                        value={slot.duration}
                        onChange={(e) => updateCanteenSlot(i, 'duration', Number(e.target.value) || 15)}
                        className="w-20 rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                      <span className="text-sm text-gray-500">min</span>
                      <button type="button" onClick={() => removeCanteenSlot(i)} className="text-red-500 text-sm hover:underline">
                        Șterge
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addCanteenSlot} className="mt-2 text-sm text-gray-600 hover:text-gray-900">
                  + Adaugă oră
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">{canteenSaveStatus}</span>
                <button
                  type="button"
                  onClick={handleSaveCanteen}
                  className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm hover:bg-gray-800"
                >
                  Salvează cantina
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
