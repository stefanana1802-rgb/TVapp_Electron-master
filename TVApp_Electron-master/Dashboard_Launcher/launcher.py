"""
Dashboard Launcher – aplicație care afișează butoane pentru fiecare Dashboard înregistrat.
Citește lista din repo (URL raw JSON), afișează punct verde/roșu după ce verifică URL-ul,
la click deschide dashboard-ul în browser. Verificare status la fiecare 15 min.
"""
import json
import os
import sys
import webbrowser
from pathlib import Path

try:
    import requests
except ImportError:
    print("Instalează: pip install requests")
    sys.exit(1)

try:
    import tkinter as tk
    from tkinter import font as tkfont
except ImportError:
    print("tkinter nu este disponibil.")
    sys.exit(1)

# Când e rulat ca .exe (PyInstaller), config.ini e în același folder cu exe-ul
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys.executable).resolve().parent
else:
    BASE_DIR = Path(__file__).resolve().parent
CONFIG_INI = BASE_DIR / "config.ini"
CHECK_INTERVAL_SEC = 15 * 60  # 15 minute
REQUEST_TIMEOUT = 8


def _load_config():
    url = os.environ.get("SOURCES_JSON_URL")
    interval = 15
    if CONFIG_INI.exists():
        for line in CONFIG_INI.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip().lower(), v.strip()
            if k == "sources_json_url" and v:
                url = v
            if k == "check_interval_minutes" and v.isdigit():
                interval = max(1, int(v))
    if not url:
        url = "https://raw.githubusercontent.com/OWNER/REPO/master/WORKSPACE/dashboard_sources.json"
    return url, interval


def fetch_sources(url: str):
    """Preia lista de surse de la URL (raw JSON)."""
    try:
        r = requests.get(url, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        data = r.json()
        return (data.get("sources") or []) if isinstance(data, dict) else []
    except Exception:
        return []


def check_url_reachable(url: str) -> bool:
    """Verifică dacă URL-ul răspunde (GET, status 200)."""
    try:
        r = requests.get(url, timeout=5)
        return r.status_code == 200
    except Exception:
        return False


def get_first_reachable_url(source: dict) -> tuple:
    """
    Încearcă pe rând toate URL-urile sursei (urls sau url).
    Returnează (url_that_works, True) sau (primul din listă, False).
    """
    urls = source.get("urls")
    if isinstance(urls, list) and urls:
        for u in urls:
            u = (u or "").strip()
            if u and check_url_reachable(u):
                return (u, True)
        return (urls[0].strip() if urls else "", False)
    u = (source.get("url") or "").strip()
    if u:
        return (u, check_url_reachable(u))
    return ("", False)


class LauncherApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Dashboard TV – Launcher")
        self.root.minsize(320, 200)
        self.sources_url, interval_min = _load_config()
        self.check_interval_sec = interval_min * 60
        self.sources = []
        self.buttons = []
        self.status_vars = []
        self.working_urls = []  # URL-ul care a raspuns pentru fiecare sursa (pentru deschidere la click)
        self._build_ui()
        self._fetch_and_show()
        self._schedule_check()

    def _build_ui(self):
        f = tkfont.nametofont("TkDefaultFont")
        self.header = tk.Label(
            self.root,
            text="Surse Dashboard",
            font=(f.actual("family"), 14, "bold"),
        )
        self.header.pack(pady=(12, 8))
        self.list_frame = tk.Frame(self.root, padx=12, pady=8)
        self.list_frame.pack(fill=tk.BOTH, expand=True)
        self.status_label = tk.Label(self.root, text="Se încarcă...", fg="gray")
        self.status_label.pack(pady=(0, 8))
        self.refresh_btn = tk.Button(
            self.root,
            text="Reîmprospătare listă",
            command=self._fetch_and_show,
        )
        self.refresh_btn.pack(pady=(0, 12))

    def _schedule_check(self):
        """Programează verificarea URL-urilor la fiecare CHECK_INTERVAL."""
        self._check_all_urls()
        self.root.after(self.check_interval_sec * 1000, self._schedule_check)

    def _make_open_cmd(self, index):
        """La click: deschide working_urls[index], sau reîncearcă toate URL-urile sursei."""
        def open_source():
            if index < len(self.working_urls) and self.working_urls[index]:
                webbrowser.open(self.working_urls[index])
            elif index < len(self.sources):
                url_working, _ = get_first_reachable_url(self.sources[index])
                if url_working:
                    self.working_urls[index] = url_working
                    webbrowser.open(url_working)
        return open_source

    def _check_all_urls(self):
        for i, src in enumerate(self.sources):
            if i >= len(self.buttons):
                break
            url_working, ok = get_first_reachable_url(src)
            if i < len(self.working_urls):
                self.working_urls[i] = url_working
            else:
                self.working_urls.append(url_working)
            if i < len(self.status_vars):
                self.status_vars[i].set(ok)
            color = "green" if ok else "red"
            self.buttons[i].config(fg=color)

    def _fetch_and_show(self):
        self.status_label.config(text="Se încarcă lista...")
        self.root.update()
        self.sources = fetch_sources(self.sources_url)
        for w in self.list_frame.winfo_children():
            w.destroy()
        self.buttons.clear()
        self.status_vars.clear()
        if not self.sources:
            self.status_label.config(text="Nicio sursă găsită sau URL invalid.")
            return
        self.status_label.config(text="{} surse. Verificare status...".format(len(self.sources)))
        self.working_urls = []
        for i, src in enumerate(self.sources):
            title = (src.get("title") or "Source {}".format(i + 1)).strip()
            urls = src.get("urls") or [src.get("url") or ""]
            first_url = (urls[0] if urls else "").strip()
            var = tk.BooleanVar(value=False)
            self.status_vars.append(var)
            self.working_urls.append(first_url)
            btn = tk.Button(
                self.list_frame,
                text="  \u25cf  {}".format(title),
                font=(None, 11),
                fg="gray",
                anchor="w",
                command=self._make_open_cmd(i),
            )
            btn.pack(fill=tk.X, pady=2)
            self.buttons.append(btn)
        self._check_all_urls()
        self.status_label.config(text="Lista actualizată. Verificare la fiecare {} min.".format(self.check_interval_sec // 60))

    def run(self):
        self.root.mainloop()


def main():
    app = LauncherApp()
    app.run()


if __name__ == "__main__":
    main()
