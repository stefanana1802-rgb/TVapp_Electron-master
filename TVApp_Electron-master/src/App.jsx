import React, { useEffect, useState } from 'react';
import SlidePlayer from './components/SlidePlayer.jsx';
import Clock from './components/Clock.jsx';
import WeatherPanel from './components/WeatherPanel.jsx';
import InfoCarousel from './components/InfoCarousel.jsx';
import CanteenRestaurantBlock from './components/CanteenRestaurantBlock.jsx';
import StatusDashboard from './components/StatusDashboard.jsx';
import VisitorsCarousel from './components/VisitorsCarousel.jsx';
import AumovioLogo from './components/AumovioLogo.jsx';
import TeamSelection from './components/TeamSelection.jsx';
import StretchingPopup from './components/StretchingPopup.jsx';
import CanteenMenuPopup from './components/CanteenMenuPopup.jsx';
import { expandPlaylistSlidesForPlayback } from './utils/flightboardUtils.js';

function formatTempC(c) {
  if (c == null || typeof c !== 'number' || !Number.isFinite(c)) return 'N/A';
  return `${c}°C`;
}

/** Peste prag: rând roșu (etichetă + valoare) pentru vizibilitate pe TV. */
function tempRowClasses(c, overC) {
  const warn = typeof c === 'number' && Number.isFinite(c) && c > overC;
  return {
    row: warn ? 'text-red-600 font-semibold' : 'text-gray-800',
    label: warn ? 'text-red-600' : 'text-gray-600'
  };
}

function App() {
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [teamCheckDone, setTeamCheckDone] = useState(false);
  const [playlist, setPlaylist] = useState({ slides: [] });
  const [sectionsContent, setSectionsContent] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [canteenMenuPopupVisible, setCanteenMenuPopupVisible] = useState(false);
  const [stretchingPopupVisible, setStretchingPopupVisible] = useState(false);
  const [canteenMenuPopupDuration, setCanteenMenuPopupDuration] = useState(15);
  const [canteenMenuLoadFailed, setCanteenMenuLoadFailed] = useState(false);
  const [gitSyncStatus, setGitSyncStatus] = useState(null);
  const [msalConfigured, setMsalConfigured] = useState(false);
  const [msalAccount, setMsalAccount] = useState(null);
  const [msalSessionActive, setMsalSessionActive] = useState(false);
  const [msalSessionVersion, setMsalSessionVersion] = useState(0);
  const [msalCheckPending, setMsalCheckPending] = useState(true);
  const [msalWaitTimeout, setMsalWaitTimeout] = useState(false);
  const [hardwareTemps, setHardwareTemps] = useState(null);
  const [hardwareTempsRefreshMs, setHardwareTempsRefreshMs] = useState(120000);

  useEffect(() => {
    if (!window.api?.getAppEnvFlags) return;
    window.api
      .getAppEnvFlags()
      .then((f) => {
        if (f && typeof f.hardwareTempsRefreshMs === 'number') setHardwareTempsRefreshMs(f.hardwareTempsRefreshMs);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedTeam || !window.api?.getHardwareTemps) return;
    let cancelled = false;
    const load = () => {
      window.api
        .getHardwareTemps()
        .then((t) => {
          if (!cancelled && t) setHardwareTemps(t);
        })
        .catch(() => {
          if (!cancelled) setHardwareTemps(null);
        });
    };
    load();
    const id = setInterval(load, hardwareTempsRefreshMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selectedTeam, hardwareTempsRefreshMs]);

  useEffect(() => {
    if (!window.api?.msalIsConfigured) {
      setMsalCheckPending(false);
      return;
    }
    window.api.msalIsConfigured()
      .then((configured) => {
        setMsalConfigured(configured);
        setMsalCheckPending(false);
      })
      .catch(() => {
        setMsalConfigured(false);
        setMsalCheckPending(false);
      });
  }, []);

  useEffect(() => {
    if (!msalConfigured || msalSessionActive) return;
    const t = setTimeout(() => setMsalWaitTimeout(true), 25000);
    return () => clearTimeout(t);
  }, [msalConfigured, msalSessionActive]);
  useEffect(() => {
    if (!msalConfigured || !window.api?.msalGetAccount) return;
    const load = () => window.api.msalGetAccount().then(setMsalAccount).catch(() => setMsalAccount(null));
    load();
    const unsub = window.api?.onMsalSessionUpdate?.(() => {
      load();
      setMsalSessionVersion((v) => v + 1);
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [msalConfigured]);
  useEffect(() => {
    if (!msalConfigured || !window.api?.msalSessionActive) return;
    const refresh = () => window.api.msalSessionActive().then((r) => setMsalSessionActive(!!r?.active)).catch(() => setMsalSessionActive(false));
    refresh();
    const unsub = window.api?.onMsalSessionUpdate?.(refresh);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [msalConfigured]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!window.api?.getGitSyncStatus) return;
    const load = () => {
      window.api.getGitSyncStatus().then((s) => {
        if (s && typeof s.lastSyncAt === 'number' && typeof s.intervalMs === 'number') setGitSyncStatus(s);
      }).catch(() => {});
    };
    load();
    const id = setInterval(load, 30 * 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!window.api?.onCanteenMenuShow || !window.api?.onCanteenMenuLoadFailed) return;
    const unshow = window.api.onCanteenMenuShow((payload) => {
      setCanteenMenuLoadFailed(false);
      setCanteenMenuPopupDuration(payload?.durationMinutes ?? 15);
      setCanteenMenuPopupVisible(true);
    });
    const unfail = window.api.onCanteenMenuLoadFailed(() => {
      setCanteenMenuLoadFailed(true);
    });
    return () => {
      if (typeof unshow === 'function') unshow();
      if (typeof unfail === 'function') unfail();
    };
  }, []);

  const greeting = (() => {
    const h = now.getHours();
    if (h < 12) return 'Good Morning';
    if (h < 18) return 'Good Afternoon';
    return 'Good Evening';
  })();

  useEffect(() => {
    if (!window.api?.getSelectedTeam) {
      setTeamCheckDone(true);
      return;
    }
    window.api.getSelectedTeam().then((team) => {
      setSelectedTeam(team || null);
      setTeamCheckDone(true);
    }).catch(() => setTeamCheckDone(true));
  }, []);

  const loadPlaylist = async () => {
    if (!selectedTeam) return;
    try {
      setLoading(true);
      if (!window.api?.getPlaylist) {
        setError('This app runs in Electron. Do not open the URL in a browser.');
        setLoading(false);
        return;
      }
      const data = await window.api.getPlaylist();
      if (data.error) {
        setError(data.error);
      } else {
        setError('');
      }
      const slides = expandPlaylistSlidesForPlayback(data?.slides || []);
      setPlaylist({ ...data, slides });
    } catch (err) {
      console.error(err);
      setError('Failed to load playlist from main process.');
    } finally {
      setLoading(false);
    }
  };

  const loadSections = async () => {
    if (!selectedTeam || !window.api?.getAllSectionsContent) return;
    try {
      const data = await window.api.getAllSectionsContent(selectedTeam);
      setSectionsContent(data || {});
    } catch (e) {
      setSectionsContent({});
    }
  };

  useEffect(() => {
    if (!selectedTeam) return;
    loadPlaylist();
    loadSections();
    let unsubscribe;
    if (window.api?.onPlaylistUpdated) {
      unsubscribe = window.api.onPlaylistUpdated(() => {
        loadPlaylist();
        loadSections();
      });
    }
    const REFRESH_MS = 60 * 1000;
    const interval = setInterval(() => {
      try {
        loadPlaylist();
        loadSections();
      } catch (e) {
        console.error('[App] Refresh interval error:', e);
      }
    }, REFRESH_MS);
    return () => {
      clearInterval(interval);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [selectedTeam]);

  if (typeof window !== 'undefined' && !window.api?.getPlaylist) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-white text-slate-800 px-8">
        <h1 className="text-4xl font-bold mb-6 text-slate-900">Digital Signage</h1>
        <p className="text-xl text-center text-slate-600 mb-2">
          This app runs in Electron, not in the browser.
        </p>
        <p className="text-2xl font-mono font-semibold mt-6 text-cyan-600">npm start</p>
        <p className="text-sm text-slate-500 mt-4">Run this in the project folder, then use the Electron window.</p>
      </div>
    );
  }

  if (!teamCheckDone) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-background text-gray-600">
        <p className="text-xl">Loading…</p>
      </div>
    );
  }

  if (teamCheckDone && selectedTeam === null) {
    return <TeamSelection onSelect={(team) => setSelectedTeam(team)} />;
  }

  if (loading && playlist.slides.length === 0) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-background text-gray-600">
        <p className="text-xl tracking-wide">Loading signage playlist...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-background text-gray-700 px-8">
        <h1 className="text-3xl font-semibold mb-4 text-gray-900">Configuration Error</h1>
        <p className="max-w-xl text-center text-gray-600 mb-4">{error}</p>
        <p className="text-sm text-gray-500 text-center max-w-lg mb-2">
          Ensure <span className="font-mono">WORKSPACE/{selectedTeam}/playlist.json</span> exists and is valid JSON.
        </p>
        <p className="text-sm text-gray-500 text-center max-w-lg mb-6">
          Dacă în WORKSPACE echipa s-a redenumit (ex. <span className="font-mono">BSW</span> →{' '}
          <span className="font-mono">SAM</span>), actualizează aplicația la ultima versiune sau apasă mai jos și
          selectează din nou echipa corectă.
        </p>
        {window.api?.setSelectedTeam && (
          <button
            type="button"
            onClick={async () => {
              await window.api.setSelectedTeam(null);
              setSelectedTeam(null);
              setError('');
            }}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
          >
            Alege altă echipă
          </button>
        )}
      </div>
    );
  }

  if (!playlist.slides || playlist.slides.length === 0) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-background text-gray-600">
        <h1 className="text-3xl font-semibold mb-4 text-gray-900">No Slides Available</h1>
        <p className="max-w-xl text-center">
          No slides in playlist. Edit <span className="font-mono">WORKSPACE/{selectedTeam}/playlist.json</span> and add slides (images in <span className="font-mono">photos/</span>, etc.).
        </p>
      </div>
    );
  }

  const waitingForMsal =
    typeof window !== 'undefined' &&
    window.api?.msalIsConfigured &&
    !msalWaitTimeout &&
    (msalCheckPending || (msalConfigured && !msalSessionActive));

  if (waitingForMsal) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-background text-gray-800">
        <div className="animate-pulse rounded-full w-12 h-12 border-4 border-blue-200 border-t-blue-600 mb-6" />
        <p className="text-xl font-semibold text-gray-900">Connecting to Microsoft</p>
        <p className="text-sm text-gray-500 mt-2">Signing in. The slideshow will start when ready.</p>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen max-h-[100vh] bg-background text-gray-800 overflow-hidden flex flex-col">
      <header className="flex items-center justify-between shrink-0 px-3 py-2 h-[10vh] min-h-[48px] max-h-[80px]">
        <div className="flex items-center gap-4 sm:gap-6">
          <AumovioLogo className="h-6 w-auto sm:h-8" textColor="#111827" />
          <div className="h-6 w-px bg-gray-300 sm:h-8" />
          <div className="min-w-0">
            <p className="text-base font-semibold text-gray-900 truncate sm:text-lg">{greeting}!</p>
            <p className="text-xs text-gray-500 truncate sm:text-sm">
              Live information wall for teams, guests, and leadership.
            </p>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-2 text-sm text-gray-600 shrink-0">
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-1.5">
                <span className="uppercase tracking-[0.2em] text-xs text-gray-400">Department</span>
                {gitSyncStatus && (() => {
                  const nextAt = gitSyncStatus.lastSyncAt + gitSyncStatus.intervalMs;
                  const ms = Math.max(0, nextAt - now.getTime());
                  const min = Math.ceil(ms / 60000);
                  const neverSynced = gitSyncStatus.lastSyncAt === 0;
                  const label = neverSynced ? 'upd. la ~15 min' : min > 0 ? `upd. ${min} min` : 'upd. în < 1 min';
                  return (
                    <span className="text-[10px] text-gray-400 font-normal normal-case tracking-normal" title="Următoarea verificare Git">
                      · {label}
                    </span>
                  );
                })()}
              </div>
              <span className="font-medium text-gray-800">{selectedTeam}</span>
            </div>
            {window.api?.getHardwareTemps && (
              <div
                className="rounded-md bg-background px-2 py-1 text-[10px] leading-snug shadow-sm max-w-[9.5rem]"
                title="CPU, motherboard, and battery temperature (refreshed every few minutes)"
              >
                <div className="text-[9px] font-semibold uppercase tracking-wide text-gray-700">Temps</div>
                {(() => {
                  const cpu = tempRowClasses(hardwareTemps?.cpuC, 80);
                  const mb = tempRowClasses(hardwareTemps?.motherboardC, 50);
                  const bat = tempRowClasses(hardwareTemps?.batteryC, 40);
                  return (
                    <>
                      <div className={cpu.row}>
                        <span className={cpu.label}>CPU:</span> {formatTempC(hardwareTemps?.cpuC)}
                      </div>
                      <div className={mb.row}>
                        <span className={mb.label}>Motherboard:</span> {formatTempC(hardwareTemps?.motherboardC)}
                      </div>
                      <div className={bat.row}>
                        <span className={bat.label}>Battery:</span> {formatTempC(hardwareTemps?.batteryC)}
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
            <button
              type="button"
              onClick={async () => {
                if (window.api?.setSelectedTeam) {
                  await window.api.setSelectedTeam(null);
                  setSelectedTeam(null);
                }
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100"
            >
              Change department
            </button>
            {/* Microsoft login: header TV (între "Change department" și butonul Admin). Vizibil în Electron. */}
            {typeof window !== 'undefined' && window.api && (
              <span className="flex items-center gap-2">
                {!msalConfigured ? (
                  <span className="text-[10px] text-gray-400" title="Adaugă AZURE_CLIENT_ID în .env din rădăcina proiectului">
                    Microsoft (configurare .env)
                  </span>
                ) : (msalAccount || msalSessionActive) ? (
                  <>
                    <span className="text-xs text-gray-600" title={msalAccount?.username || 'Sesiune activă'}>
                      Connected
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await window.api?.msalLogout?.();
                        setMsalAccount(null);
                        setMsalSessionActive(false);
                        setMsalWaitTimeout(true);
                      }}
                      className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await window.api?.msalLogin?.();
                      if (res?.ok) return;
                      if (res?.error) console.warn('[MSAL]', res.error);
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100"
                  >
                    Sign In Microsoft
                  </button>
                )}
              </span>
            )}
            <button
              type="button"
              onClick={() => window.api?.openAdminWindow?.()}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors"
              title="Admin"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => window.api?.quitApp?.()}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/20 text-red-500 hover:bg-red-500 hover:text-white transition-colors"
              title="Shut down"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 12V3" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z" />
              </svg>
            </button>
          </div>
      </header>

      <main className="flex-1 min-h-0 grid grid-cols-[minmax(0,3fr)_minmax(0,0.92fr)] gap-2 sm:gap-3 px-2 pb-2 sm:px-4 sm:pb-4 overflow-hidden">
        <section className="flex flex-col gap-2 sm:gap-3 min-h-0 min-w-0 overflow-hidden">
          <div className="flex-[5] min-h-0 rounded-xl sm:rounded-2xl bg-surface border border-gray-200 shadow-sm overflow-hidden">
            <SlidePlayer
              slides={playlist.slides}
              msalSessionVersion={msalSessionVersion}
              msalCanLoadPowerBi={!!(msalAccount || msalSessionActive)}
              paused={canteenMenuPopupVisible || stretchingPopupVisible}
            />
          </div>
          <div className="flex-[1] min-h-0 grid grid-cols-2 gap-2 sm:gap-3 overflow-hidden">
            <div className="min-w-0 min-h-0 flex flex-col overflow-hidden">
              <VisitorsCarousel sections={sectionsContent} />
            </div>
            <div className="min-w-0 min-h-0 flex flex-col overflow-hidden">
              <StatusDashboard sections={sectionsContent} />
            </div>
          </div>
        </section>

        <aside className="flex flex-col gap-2 sm:gap-3 min-h-0 min-w-0 overflow-y-auto">
          <div className="shrink-0 rounded-xl sm:rounded-2xl bg-surface border border-gray-200 shadow-sm px-4 py-3 w-full">
            <Clock />
          </div>
          <div className="flex-[1.35] min-h-0 rounded-xl sm:rounded-2xl bg-surface border border-gray-200 shadow-sm px-3 py-2 sm:px-4 sm:py-3 w-full overflow-hidden flex flex-col">
            <WeatherPanel announcements={sectionsContent.announcements} />
          </div>
          <div className="flex-[0.74] min-h-0 max-h-[33vh] rounded-xl sm:rounded-2xl bg-surface border border-gray-200 shadow-sm px-2 py-1.5 sm:px-3 sm:py-2 w-full overflow-hidden flex flex-col">
            <InfoCarousel sections={sectionsContent} />
          </div>
          <div className="shrink-0 rounded-xl sm:rounded-2xl bg-surface border border-gray-200 shadow-sm px-2 py-1.5 sm:px-3 sm:py-2 w-full">
            <CanteenRestaurantBlock
              canteenMenu={sectionsContent.canteen_menu}
              traffic={sectionsContent.traffic}
              menuLoadFailed={canteenMenuLoadFailed}
            />
          </div>
        </aside>
      </main>
      <StretchingPopup
        sections={sectionsContent}
        now={now}
        onVisibleChange={setStretchingPopupVisible}
      />
      <CanteenMenuPopup
        visible={canteenMenuPopupVisible}
        durationMinutes={canteenMenuPopupDuration}
        onClose={() => setCanteenMenuPopupVisible(false)}
      />
    </div>
  );
}

export default App;
