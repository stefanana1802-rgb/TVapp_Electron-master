"""
Dashboard TV App – aplicație Python care actualizează directorul WORKSPACE
(al echipe, playlist-uri) pentru Digital Signage. Rulează local; poate fi împachetată ca .exe cu PyInstaller.
"""
import json
import os
import shutil
import subprocess
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Tuple

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

load_dotenv()

app = Flask(__name__, static_folder="static", template_folder="templates")

# Calea către WORKSPACE (rădăcina proiectului TV_App = parent al acestui folder)
BASE_DIR = Path(__file__).resolve().parent
WORKSPACE_DIR = Path(os.environ.get("WORKSPACE_PATH", "../WORKSPACE")).resolve()
if not WORKSPACE_DIR.is_absolute():
    WORKSPACE_DIR = (BASE_DIR / WORKSPACE_DIR).resolve()


def _git_repo_root() -> Optional[Path]:
    """Rădăcina repo-ului (directorul care conține .git). Caută din WORKSPACE_DIR în sus, apoi din BASE_DIR.parent."""
    for start in (WORKSPACE_DIR, BASE_DIR.parent, WORKSPACE_DIR.parent):
        if not start:
            continue
        p = Path(start).resolve()
        for _ in range(10):
            if p and (p / ".git").exists():
                return p
            parent = p.parent
            if parent == p:
                break
            p = parent
    return None


# Directoare per echipă: documents, photos, videos + secțiuni de conținut (nu se șterg la Clean Workspace)
TEAM_SECTION_DIRS = (
    "announcements",
    "canteen_menu",
    "anniversary",
    "uptime_services",
    "info_section",
    "projects_info",
    "stretching",
    "meeting_rooms",
    "traffic",
)


def _team_path(name: str) -> Path:
    """Cale absolută pentru echipă; validează că e sub WORKSPACE."""
    name = (name or "").strip().replace("..", "").replace("/", "").replace("\\", "")
    if not name:
        raise ValueError("Invalid team name")
    p = (WORKSPACE_DIR / name).resolve()
    if not str(p).startswith(str(WORKSPACE_DIR)):
        raise ValueError("Invalid team name")
    return p


@app.route("/")
def index():
    return send_from_directory("templates", "dashboard.html")


@app.route("/api/restaurant-status", methods=["GET"])
def restaurant_status():
    """
    Status Restaurant of the Day: doar citire din WORKSPACE (Git), fără interfață grafică.
    OK (verde) dacă restaurantul e actualizat în ultimele 24h sau în ziua respectivă (azi/ieri);
    NOK (roșu) altfel. Folosește restaurant_api_status.json (lastRun) sau content.json (restaurantLastUpdated).
    """
    try:
        if not WORKSPACE_DIR or not WORKSPACE_DIR.exists():
            return jsonify({
                "ok": False,
                "message": "WORKSPACE nu este disponibil (verifică WORKSPACE_PATH)",
                "lastRun": None,
            })

        now = datetime.now(timezone.utc)
        cutoff_24h = now - timedelta(hours=24)
        today_str = now.strftime("%Y-%m-%d")
        yesterday_str = (now - timedelta(days=1)).strftime("%Y-%m-%d")
        last_run_iso = None
        ok = False
        message = ""

        # 1) Încearcă restaurant_api_status.json (lastRun în ultimele 24h)
        p_status = WORKSPACE_DIR / "restaurant_api_status.json"
        if p_status.exists():
            try:
                data = json.loads(p_status.read_text(encoding="utf-8"))
                last_run_iso = data.get("lastRun")
                if last_run_iso:
                    try:
                        dt = datetime.fromisoformat(last_run_iso.replace("Z", "+00:00"))
                        if dt.tzinfo is None:
                            dt = dt.replace(tzinfo=timezone.utc)
                        if dt >= cutoff_24h:
                            ok = True
                        last_run_iso = dt.isoformat()
                    except (ValueError, TypeError):
                        pass
            except Exception:
                pass

        # 2) Fallback: content.json per echipă, restaurantLastUpdated (azi sau ieri)
        if not ok:
            try:
                for team_dir in WORKSPACE_DIR.iterdir():
                    if not team_dir.is_dir() or team_dir.name.startswith("."):
                        continue
                    content_path = team_dir / "canteen_menu" / "content.json"
                    if not content_path.exists():
                        continue
                    try:
                        content = json.loads(content_path.read_text(encoding="utf-8"))
                        updated = (content.get("restaurantLastUpdated") or "").strip()
                        if updated in (today_str, yesterday_str):
                            ok = True
                            if not last_run_iso:
                                last_run_iso = f"{updated}T00:00:00+00:00"
                            break
                    except Exception:
                        continue
            except Exception:
                pass

        if not message:
            message = "OK" if ok else "Niciun update în ultimele 24h"

        return jsonify({
            "ok": ok,
            "message": message,
            "lastRun": last_run_iso,
        })
    except Exception as e:
        return jsonify({
            "ok": False,
            "message": f"Eroare: {e!s}",
            "lastRun": None,
        })


# ---------- API Echipe ----------
@app.route("/api/teams", methods=["GET"])
def list_teams():
    if not WORKSPACE_DIR.exists():
        return jsonify([])
    teams = [d.name for d in WORKSPACE_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")]
    return jsonify(sorted(teams))


@app.route("/api/teams", methods=["POST"])
def create_team():
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    safe = "".join(c for c in name if c.isalnum() or c in " -_").strip() or "team"
    team_dir = _team_path(safe)
    try:
        team_dir.mkdir(parents=True, exist_ok=True)
        (team_dir / "playlist.json").write_text(
            json.dumps({"slides": []}, indent=2), encoding="utf-8"
        )
        for sub in ("documents", "photos", "videos"):
            (team_dir / sub).mkdir(exist_ok=True)
        for sub in TEAM_SECTION_DIRS:
            (team_dir / sub).mkdir(exist_ok=True)
        return jsonify({"ok": True, "name": safe})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/teams/<name>/delete-resource", methods=["POST"])
def delete_team_resource(name):
    """Șterge fișierul sau directorul din WORKSPACE (ex. documents/folder, photos/file.jpg). La push va fi șters și din git."""
    import shutil
    try:
        team_dir = _team_path(name)
        data = request.get_json() or {}
        src = (data.get("src") or "").strip().replace("\\", "/").strip("/")
        if not src or ".." in src:
            return jsonify({"error": "invalid src"}), 400
        parts = src.split("/")
        if parts[0] not in ("documents", "photos", "videos"):
            return jsonify({"error": "src must be under documents, photos or videos"}), 400
        target = (team_dir / src).resolve()
        if not str(target).startswith(str(team_dir)):
            return jsonify({"error": "invalid path"}), 400
        if not target.exists():
            return jsonify({"ok": True, "message": "already gone"})
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/teams/<name>", methods=["DELETE"])
def delete_team(name):
    try:
        team_dir = _team_path(name)
        if not team_dir.exists():
            return jsonify({"error": "not found"}), 404
        import shutil
        shutil.rmtree(team_dir)
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------- API Secțiuni echipă (announcements, canteen_menu, etc.) ----------
@app.route("/api/teams/<name>/section/<section_id>", methods=["GET"])
def get_team_section(name, section_id):
    """Citește conținutul secțiunii (content.json) din WORKSPACE/<team>/<section_id>/."""
    try:
        team_dir = _team_path(name)
        section_id = (section_id or "").strip().replace("..", "").replace("/", "").replace("\\", "")
        if section_id not in TEAM_SECTION_DIRS:
            return jsonify({"error": "invalid section"}), 400
        content_path = team_dir / section_id / "content.json"
        if not content_path.exists():
            return jsonify(None)
        data = json.loads(content_path.read_text(encoding="utf-8"))
        return jsonify(data)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/teams/<name>/section/<section_id>", methods=["PUT"])
def put_team_section(name, section_id):
    """Scrie conținutul secțiunii (content.json) în WORKSPACE/<team>/<section_id>/."""
    try:
        team_dir = _team_path(name)
        section_id = (section_id or "").strip().replace("..", "").replace("/", "").replace("\\", "")
        if section_id not in TEAM_SECTION_DIRS:
            return jsonify({"error": "invalid section"}), 400
        section_dir = team_dir / section_id
        section_dir.mkdir(parents=True, exist_ok=True)
        data = request.get_json()
        if data is None:
            return jsonify({"error": "JSON body required"}), 400
        content_path = section_dir / "content.json"
        if section_id == "stretching":
            old_video_path = None
            if content_path.exists():
                try:
                    old_content = json.loads(content_path.read_text(encoding="utf-8"))
                    items = old_content.get("items") if isinstance(old_content.get("items"), list) else []
                    if items and isinstance(items[0], dict):
                        old_video = (items[0].get("video") or "").strip().replace("\\", "/")
                        if old_video.startswith("stretching/"):
                            old_video_path = team_dir / old_video
                except Exception:
                    pass
            new_video = ""
            new_items = data.get("items") if isinstance(data.get("items"), list) else []
            if new_items and isinstance(new_items[0], dict):
                new_video = (new_items[0].get("video") or "").strip().replace("\\", "/")
            if old_video_path and old_video_path.exists() and old_video_path.is_file():
                if not new_video or not new_video.startswith("stretching/") or old_video_path != (team_dir / new_video.replace("\\", "/")):
                    try:
                        old_video_path.unlink()
                    except Exception:
                        pass
        content_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        out = {"ok": True}
        if section_id == "canteen_menu":
            items = data.get("menuPdfItems") if isinstance(data.get("menuPdfItems"), list) else []
            if items:
                ok, count, err = _canteen_convert_pdfs_to_images(team_dir, items)
                if not ok:
                    out["warning"] = "Sloturi și setări salvate. Conversie PDF → imagini eșuată: " + (err or "failed")
        return jsonify(out)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _git_push_team_canteen(team_name: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """Git add WORKSPACE/<team>/canteen_menu, commit and push. Returns (success, error_message, new_commit_hash)."""
    repo_root = _git_repo_root()
    if not repo_root:
        return (False, "Nu s-a găsit repository Git.", None)
    try:
        rel = (WORKSPACE_DIR / team_name / "canteen_menu").relative_to(repo_root).as_posix()
    except ValueError:
        return (False, "WORKSPACE nu este în repo.", None)
    cwd = str(repo_root)
    r_add = subprocess.run(["git", "add", rel], cwd=cwd, capture_output=True, text=True, timeout=10)
    if r_add.returncode != 0:
        err = (r_add.stderr or r_add.stdout or "git add a eșuat").strip()
        return (False, err, None)
    r_commit = subprocess.run(
        ["git", "commit", "-m", "Canteen menu: PDF + imagini"],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=10,
    )
    if r_commit.returncode != 0 and "nothing to commit" not in (r_commit.stdout or "") + (r_commit.stderr or ""):
        err = (r_commit.stderr or r_commit.stdout or "git commit a eșuat").strip()
        return (False, err, None)
    r_push = subprocess.run(["git", "push"], cwd=cwd, capture_output=True, text=True, timeout=60)
    if r_push.returncode != 0:
        err = (r_push.stderr or r_push.stdout or "git push a eșuat").strip()
        return (False, err, None)
    new_commit = _git_head_commit(cwd)
    return (True, None, new_commit)


@app.route("/api/teams/section-list", methods=["GET"])
def list_section_ids():
    """Listează id-urile secțiunilor (pentru dashboard)."""
    return jsonify(list(TEAM_SECTION_DIRS))


@app.route("/api/teams/<name>/ensure-section-dirs", methods=["POST"])
def ensure_team_section_dirs(name):
    """Creează directoarele de secțiuni (announcements, canteen_menu, etc.) pentru echipă dacă lipsesc."""
    try:
        team_dir = _team_path(name)
        team_dir.mkdir(parents=True, exist_ok=True)
        for sub in TEAM_SECTION_DIRS:
            (team_dir / sub).mkdir(exist_ok=True)
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/flightboard/projects", methods=["GET", "POST"])
def flightboard_projects():
    """Proxy JSON projects[] pentru Dashboard (evită CORS în browser). POST evită URL-uri GET foarte lungi."""
    url = ""
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        url = (body.get("url") or "").strip()
    else:
        url = (request.args.get("url") or "").strip()
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        url = (os.environ.get("FLIGHTBOARD_PROJECTS_URL") or "").strip()
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        url = "https://flightboard-query-prod.cmo.aws.automotive.cloud/rest/projects"
    try:
        req = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "Dashboard-TVApp-Flightboard/1.0",
            },
        )
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return jsonify(
                {
                    "ok": False,
                    "error": "URL-ul extern a returnat HTML sau non-JSON (login, 403, etc.). Verifică VPN / URL în .env FLIGHTBOARD_PROJECTS_URL.",
                    "projects": [],
                }
            )
        projects = data.get("projects") if isinstance(data.get("projects"), list) else []
        return jsonify({"ok": True, "projects": projects})
    except urllib.error.HTTPError as e:
        return jsonify({"ok": False, "error": f"HTTP {e.code}", "projects": []})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e), "projects": []})


# ---------- API Playlist ----------
@app.route("/api/teams/<name>/playlist", methods=["GET"])
def get_playlist(name):
    try:
        team_dir = _team_path(name)
        pl_path = team_dir / "playlist.json"
        if not pl_path.exists():
            return jsonify({"slides": []})
        data = json.loads(pl_path.read_text(encoding="utf-8"))
        slides = data.get("slides") if isinstance(data.get("slides"), list) else []
        return jsonify({"slides": slides})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/teams/<name>/playlist", methods=["PUT"])
def save_playlist(name):
    try:
        team_dir = _team_path(name)
        team_dir.mkdir(parents=True, exist_ok=True)
        data = request.get_json()
        if not data:
            return jsonify({"error": "body required"}), 400
        slides = data.get("slides") if isinstance(data.get("slides"), list) else []
        for i, s in enumerate(slides):
            if not isinstance(s, dict):
                continue
            if not s.get("id"):
                s["id"] = f"slide-{i + 1}"
        pl_path = team_dir / "playlist.json"
        pl_path.write_text(
            json.dumps({"slides": slides}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return jsonify({"ok": True})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------- Upload imagini / video în WORKSPACE/<team>/photos|videos ----------
ALLOWED_IMAGE = {"image/jpeg", "image/png", "image/gif", "image/webp"}
ALLOWED_VIDEO = {"video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"}


@app.route("/api/teams/<name>/upload", methods=["POST"])
def upload_team_file(name):
    try:
        team_dir = _team_path(name)
        team_dir.mkdir(parents=True, exist_ok=True)
        if "file" not in request.files:
            return jsonify({"error": "file required"}), 400
        f = request.files["file"]
        kind = (request.form.get("kind") or "").strip().lower()
        if kind not in ("image", "video"):
            return jsonify({"error": "kind must be image or video"}), 400
        if not f or not f.filename:
            return jsonify({"error": "no file selected"}), 400
        fn = secure_filename(f.filename) or "file"
        base, ext = os.path.splitext(fn)
        if not ext:
            ext = ".jpg" if kind == "image" else ".mp4"
        unique = f"{base}_{uuid.uuid4().hex[:8]}{ext}"
        section = (request.form.get("section") or "").strip().lower()
        if section == "stretching" and kind == "video":
            folder = "stretching"
            allowed = ALLOWED_VIDEO | {"application/octet-stream"}
            if f.content_type and f.content_type not in allowed:
                return jsonify({"error": "invalid video type"}), 400
        elif kind == "image":
            folder = "photos"
            if f.content_type and f.content_type not in ALLOWED_IMAGE:
                return jsonify({"error": "invalid image type"}), 400
        else:
            folder = "videos"
            allowed = ALLOWED_VIDEO | {"application/octet-stream"}
            if f.content_type and f.content_type not in allowed:
                return jsonify({"error": "invalid video type"}), 400
        dest_dir = team_dir / folder
        dest_dir.mkdir(exist_ok=True)
        dest = dest_dir / unique
        f.save(str(dest))
        path = f"{folder}/{unique}"
        return jsonify({"ok": True, "path": path})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------- Upload document (word, excel, pptx, pdf) -> documents/<folder>/ ----------
DOC_EXT = {".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"}
DOC_MIME = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
}


def _safe_folder_name(name: str) -> str:
    base = "".join(c for c in name if c.isalnum() or c in " -_").strip() or "doc"
    return base[:50]


@app.route("/api/teams/<name>/upload-document", methods=["POST"])
def upload_document(name):
    """Upload PDF/Word/Excel/PPTX to team/documents/<folder_name>/."""
    try:
        team_dir = _team_path(name)
        team_dir.mkdir(parents=True, exist_ok=True)
        docs_dir = team_dir / "documents"
        docs_dir.mkdir(exist_ok=True)
        if "file" not in request.files:
            return jsonify({"error": "file required"}), 400
        f = request.files["file"]
        if not f or not f.filename:
            return jsonify({"error": "no file selected"}), 400
        fn = (f.filename or "").strip()
        base, ext = os.path.splitext(fn)
        ext = ext.lower()
        if ext not in DOC_EXT:
            return jsonify({"error": "allowed: pdf, docx, doc, xlsx, xls, pptx, ppt"}), 400
        folder_name = _safe_folder_name(base) + "_" + uuid.uuid4().hex[:8]
        dest_dir = docs_dir / folder_name
        dest_dir.mkdir(parents=True, exist_ok=True)
        safe_fn = secure_filename(fn) or base + ext
        dest_file = dest_dir / safe_fn
        f.save(str(dest_file))
        path = f"documents/{folder_name}"
        return jsonify({"ok": True, "path": path})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/teams/<name>/upload-canteen-pdf", methods=["POST"])
def upload_canteen_pdf(name):
    """Upload PDF to team/canteen_menu/pdfs/ for menu popup. Returns path relative to canteen_menu/."""
    try:
        if not WORKSPACE_DIR.exists():
            return jsonify({"error": "WORKSPACE nu există (verifică WORKSPACE_PATH în .env)"}), 500
        team_dir = _team_path(name)
        team_dir.mkdir(parents=True, exist_ok=True)
        canteen_dir = team_dir / "canteen_menu"
        canteen_dir.mkdir(exist_ok=True)
        pdfs_dir = canteen_dir / "pdfs"
        pdfs_dir.mkdir(exist_ok=True)
        if "file" not in request.files:
            return jsonify({"error": "file required"}), 400
        f = request.files["file"]
        if not f or not f.filename:
            return jsonify({"error": "no file selected"}), 400
        fn = (f.filename or "").strip()
        base, ext = os.path.splitext(fn)
        ext = ext.lower()
        if ext != ".pdf":
            return jsonify({"error": "only PDF allowed"}), 400
        base_name = "".join(c for c in base if c.isalnum() or c in " -_").strip() or "meniu"
        unique = f"{base_name}_{uuid.uuid4().hex[:8]}.pdf"
        dest_file = pdfs_dir / unique
        f.save(str(dest_file))
        path = f"pdfs/{unique}"
        return jsonify({"ok": True, "path": path})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


def _canteen_parse_range(range_str: str, total_pages: int) -> list:
    """Parse range to 1-based page numbers. 'all' -> [1..total], '1-3' -> [1,2,3], '1,3,5' -> [1,3,5]."""
    s = (range_str or "").strip().lower()
    if not s or s == "all":
        return list(range(1, total_pages + 1))
    out = []
    for part in s.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            try:
                lo, hi = int(a.strip()), int(b.strip())
                for p in range(max(1, lo), min(total_pages, hi) + 1):
                    out.append(p)
            except ValueError:
                pass
        else:
            try:
                p = int(part)
                if 1 <= p <= total_pages:
                    out.append(p)
            except ValueError:
                pass
    return sorted(set(out))


def _dashboard_pdf_to_image_dpi() -> float:
    """DPI uniform PDF→PNG (pptx/word/excel convert). X=Y, fără scalare neuniformă."""
    raw = (os.environ.get("DASHBOARD_PDF_TO_IMAGE_DPI") or os.environ.get("PDF_CONVERT_DPI") or "").strip()
    if raw:
        try:
            v = float(str(raw).replace(",", "."))
            if 96 <= v <= 400:
                return v
        except ValueError:
            pass
    return 192.0


def _fitz_page_to_png_pix(page, dpi: float):
    """PyMuPDF: rasterizare fără distorsiune — rotație integrată în conținut, zoom uniform, RGB."""
    import fitz

    # PDF-uri cu /Rotate sau crop ciudat: fără asta, unele pagini ies „strânse”/deformate la pixmap.
    try:
        page.remove_rotation()
    except Exception:
        pass
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    return page.get_pixmap(matrix=mat, alpha=False, colorspace=fitz.csRGB, annots=False)


def _canteen_convert_pdfs_to_images(team_dir: Path, items: list) -> Tuple[bool, int, Optional[str]]:
    """Convert PDFs from menuPdfItems (path + range) to PNGs in team/canteen_menu/menu_pdf/. Returns (ok, count, error)."""
    import fitz
    canteen_dir = team_dir / "canteen_menu"
    menu_pdf_dir = canteen_dir / "menu_pdf"
    menu_pdf_dir.mkdir(parents=True, exist_ok=True)
    for f in menu_pdf_dir.iterdir():
        if f.is_file():
            try:
                f.unlink()
            except Exception:
                pass
    valid = [x for x in (items or []) if x and isinstance(x.get("path"), str) and (x.get("path") or "").strip()]
    if not valid:
        return True, 0, None
    global_idx = 0
    try:
        for item in valid:
            rel = (item.get("path") or "").strip().replace("\\", "/").lstrip("/").replace("..", "")
            if not rel:
                continue
            pdf_path = (canteen_dir / rel).resolve()
            if not str(pdf_path).startswith(str(canteen_dir)) or not pdf_path.is_file():
                continue
            range_str = (item.get("range") or "all").strip() or "all"
            doc = fitz.open(str(pdf_path))
            try:
                total = len(doc)
                if total == 0:
                    doc.close()
                    continue
                page_nums = _canteen_parse_range(range_str, total)
                for p1 in page_nums:
                    if p1 < 1 or p1 > total:
                        continue
                    page = doc.load_page(p1 - 1)
                    pix = _fitz_page_to_png_pix(page, _dashboard_pdf_to_image_dpi())
                    global_idx += 1
                    out_name = f"{global_idx:03d}.png"
                    pix.save(str(menu_pdf_dir / out_name))
            finally:
                doc.close()
        return True, global_idx, None
    except Exception as e:
        return False, 0, str(e)


def _parse_range(range_str: str, total_pages: int) -> list:
    """Parse range string to 1-based page numbers. 'all' -> [1..total], '1,3,5' -> [1,3,5], '2-5' -> [2,3,4,5]."""
    s = (range_str or "").strip().lower()
    if not s or s == "all":
        return list(range(1, total_pages + 1))
    out = []
    for part in s.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            try:
                lo, hi = int(a.strip()), int(b.strip())
                for p in range(max(1, lo), min(total_pages, hi) + 1):
                    out.append(p)
            except ValueError:
                pass
        else:
            try:
                p = int(part)
                if 1 <= p <= total_pages:
                    out.append(p)
            except ValueError:
                pass
    return sorted(set(out))


def _convert_pdf_to_images(pdf_path: Path, page_numbers_1based: list, out_dir: Path) -> int:
    import fitz  # pymupdf

    dpi = _dashboard_pdf_to_image_dpi()
    doc = fitz.open(str(pdf_path))
    count = 0
    try:
        for i, page_1 in enumerate(page_numbers_1based):
            page_0 = page_1 - 1
            if page_0 < 0 or page_0 >= len(doc):
                continue
            page = doc[page_0]
            pix = _fitz_page_to_png_pix(page, dpi)
            out_name = f"{i + 1:03d}.png"
            pix.save(str(out_dir / out_name))
            count += 1
    finally:
        doc.close()
    return count


def _libreoffice_paths():
    """Return list of possible soffice executable paths (PATH + env + Windows install dirs)."""
    candidates = []
    # Explicit path (e.g. portable install)
    env_path = os.environ.get("LIBREOFFICE_PATH", "").strip()
    if env_path:
        p = Path(env_path)
        if p.is_file():
            candidates.append(str(p))
        else:
            for exe_name in ("soffice.exe", "soffice"):
                c = p / exe_name if p.is_dir() else p
                if c.exists():
                    candidates.append(str(c))
                    break
    candidates.extend(["soffice", "libreoffice"])
    if os.name == "nt":
        for base in (
            os.environ.get("ProgramFiles", "C:\\Program Files"),
            os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)"),
        ):
            base_path = Path(base)
            if not base_path.is_dir():
                continue
            # Fixed folder names
            for sub in ("LibreOffice", "LibreOffice 5", "LibreOffice 6", "LibreOffice 7", "LibreOffice 24", "LibreOffice 25"):
                exe = base_path / sub / "program" / "soffice.exe"
                if exe.exists():
                    candidates.append(str(exe))
            # Any "LibreOffice*" folder (e.g. LibreOffice 24.2.1)
            try:
                for entry in base_path.iterdir():
                    if entry.is_dir() and entry.name.startswith("LibreOffice"):
                        exe = entry / "program" / "soffice.exe"
                        if exe.exists():
                            candidates.append(str(exe))
            except OSError:
                pass
    return candidates


def _dispatch_office_app(win32com_client, prog_id: str):
    """Dispatch Office COM: încercare implicită, apoi server 32-bit și 64-bit (potrivire Python ↔ Office)."""
    import pythoncom

    def _should_retry_affinity(msg: str) -> bool:
        m = msg.lower()
        return (
            "com object" in m
            or "0x80040154" in m
            or "class not registered" in m
            or "can not be converted" in m
            or "cannot be converted" in m
        )

    try:
        app = win32com_client.Dispatch(prog_id)
        return app, None
    except Exception as e:
        first = str(e).strip()
        if not _should_retry_affinity(first):
            return None, first
        last = first
        for clsctx in (
            pythoncom.CLSCTX_ACTIVATE_32_BIT_SERVER,
            getattr(pythoncom, "CLSCTX_ACTIVATE_64_BIT_SERVER", None),
        ):
            if clsctx is None:
                continue
            try:
                app = win32com_client.Dispatch(prog_id, clsctx=clsctx)
                return app, None
            except Exception as e2:
                last = str(e2).strip()
        return None, last


def _convert_office_to_pdf_win32(office_path: Path, out_dir: Path) -> Tuple[Optional[Path], Optional[str]]:
    """Convert Word/Excel/PPTX to PDF using Microsoft Office (Windows only). Returns (pdf_path, error_message)."""
    if os.name != "nt":
        return None, "Not Windows."
    try:
        import pythoncom
        import win32com.client
    except ImportError:
        return None, "pywin32 not installed. Run: pip install pywin32"
    # Office requires STA (Single-Threaded Apartment)
    try:
        pythoncom.CoInitializeEx(pythoncom.COINIT_APARTMENTTHREADED)
    except Exception:
        pythoncom.CoInitialize()
    app = None
    try:
        suffix = office_path.suffix.lower()
        pdf_path = out_dir / (office_path.stem + ".pdf")
        in_path = os.path.abspath(office_path)
        out_pdf = os.path.abspath(pdf_path)
        if suffix in (".doc", ".docx"):
            wdFormatPDF = 17
            app, disp_err = _dispatch_office_app(win32com.client, "Word.Application")
            if disp_err:
                return None, disp_err
            app.Visible = False
            doc = app.Documents.Open(in_path)
            doc.SaveAs(out_pdf, FileFormat=wdFormatPDF)
            doc.Close(SaveChanges=False)
        elif suffix in (".xls", ".xlsx"):
            xlTypePDF = 0
            app, disp_err = _dispatch_office_app(win32com.client, "Excel.Application")
            if disp_err:
                return None, disp_err
            app.Visible = False
            app.DisplayAlerts = False
            book = app.Workbooks.Open(in_path)
            book.ExportAsFixedFormat(Type=xlTypePDF, Filename=out_pdf)
            book.Close(SaveChanges=False)
        elif suffix in (".ppt", ".pptx"):
            ppFixedFormatTypePDF = 2
            out_dir.mkdir(parents=True, exist_ok=True)
            app, disp_err = _dispatch_office_app(win32com.client, "PowerPoint.Application")
            if disp_err:
                return None, disp_err
            app.Visible = True
            pres = app.Presentations.Open(in_path, WithWindow=False)
            pres.ExportAsFixedFormat(out_pdf, ppFixedFormatTypePDF)
            pres.Close()
        else:
            return None, None
        if app:
            app.Quit()
        return (pdf_path if pdf_path.exists() else None), None
    except Exception as e:
        if app:
            try:
                app.Quit()
            except Exception:
                pass
        err = str(e).strip() or type(e).__name__
        el = err.lower()
        if "com object" in el or "0x80040154" in err or "can not be converted" in el or "cannot be converted" in el:
            err += (
                " — Recomandat: instalează LibreOffice (64-bit) de pe libreoffice.org; opțional LIBREOFFICE_PATH în .env. "
                "Alternativ: același mod (32/64-bit) pentru Python și Microsoft Office, sau exportă PDF din PowerPoint și încarcă PDF."
            )
        return None, err
    finally:
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass


def _libreoffice_pdf_convert_to_args(office_path: Path) -> list:
    """Argumente --convert-to: pentru PPT folosim filtrul Impress (proporții slide mai corecte decât generic pdf)."""
    suf = office_path.suffix.lower()
    if suf in (".ppt", ".pptx"):
        custom = (os.environ.get("LIBREOFFICE_IMPRESS_PDF_FILTER") or "").strip()
        if custom:
            return [custom]
        return [
            "pdf:impress_pdf_Export:Quality=100:ExportNotesPages=false:ExportHiddenSlides=false",
            "pdf",
        ]
    return ["pdf"]


def _convert_office_to_pdf(office_path: Path, out_dir: Path) -> Tuple[Optional[Path], Optional[str]]:
    """Convert to PDF: try LibreOffice first, then on Windows try Microsoft Office. Returns (path, error_msg)."""
    last_lo_note: Optional[str] = None
    for cmd in _libreoffice_paths():
        convert_tos = _libreoffice_pdf_convert_to_args(office_path)
        for conv in convert_tos:
            try:
                r = subprocess.run(
                    [cmd, "--headless", "--convert-to", conv, "--outdir", str(out_dir), str(office_path)],
                    cwd=str(out_dir),
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                pdf_name = office_path.stem + ".pdf"
                pdf_path = out_dir / pdf_name
                if r.returncode == 0 and pdf_path.exists():
                    return pdf_path, None
                err_snip = (r.stderr or r.stdout or "").strip()[:280]
                if err_snip:
                    last_lo_note = f"soffice cod {r.returncode} ({conv[:40]}…): {err_snip}"
                elif r.returncode != 0:
                    last_lo_note = f"soffice cod {r.returncode} ({conv[:40]}…)"
            except FileNotFoundError:
                last_lo_note = f"nu găsesc executabil: {cmd}"
                break
            except subprocess.TimeoutExpired:
                last_lo_note = "LibreOffice: timeout 120s"
                break
    path, err = _convert_office_to_pdf_win32(office_path, out_dir)
    if not path and last_lo_note:
        suffix = " | LibreOffice: " + last_lo_note
        err = (err + suffix) if err else last_lo_note.strip()
    return path, err


@app.route("/api/teams/<name>/convert-document", methods=["POST"])
def convert_document(name):
    """Convert document in src folder to images. Body: { src: 'documents/folder', range: 'all'|'1,3,5'|'2-5' }."""
    try:
        team_dir = _team_path(name)
        data = request.get_json() or {}
        src = (data.get("src") or "").strip().replace("\\", "/").strip("/")
        if not src or ".." in src:
            return jsonify({"error": "invalid src"}), 400
        folder_rel = src.split("/")[0] == "documents" and src or f"documents/{src}"
        folder_abs = (team_dir / folder_rel).resolve()
        if not folder_abs.is_dir() or not str(folder_abs).startswith(str(team_dir)):
            return jsonify({"error": "folder not found"}), 400
        range_str = (data.get("range") or "all").strip()
        doc_file = None
        for f in folder_abs.iterdir():
            if f.is_file() and f.suffix.lower() in DOC_EXT:
                doc_file = f
                break
        if not doc_file:
            return jsonify({"error": "no document file in folder"}), 400
        suffix = doc_file.suffix.lower()
        pdf_path = None
        if suffix == ".pdf":
            pdf_path = doc_file
        else:
            pdf_path, office_err = _convert_office_to_pdf(doc_file, folder_abs)
            if not pdf_path:
                msg = "Install LibreOffice or Microsoft Office to convert Office files. Or upload a PDF instead."
                if office_err:
                    msg += " (Office error: " + office_err[:200] + ")"
                return jsonify({"error": msg}), 400
        import fitz
        doc = fitz.open(str(pdf_path))
        total_pages = len(doc)
        doc.close()
        if total_pages == 0:
            return jsonify({"error": "document has no pages"}), 400
        page_list = _parse_range(range_str, total_pages)
        if not page_list:
            return jsonify({"error": "range resulted in no pages"}), 400
        count = _convert_pdf_to_images(pdf_path, page_list, folder_abs)
        return jsonify({"ok": True, "count": count, "path": folder_rel})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


def _parse_web_range(range_str: str, max_pages: int = 20) -> list:
    """Parse range for web capture: 'all' -> [1], '1-5' or '1' -> list of page numbers (viewport captures)."""
    s = (range_str or "all").strip().lower()
    if s == "all":
        return [1]  # one full-page screenshot
    if "-" in s:
        parts = s.split("-", 1)
        try:
            a, b = int(parts[0].strip()), int(parts[1].strip())
            if 1 <= a <= b:
                return list(range(a, min(b, max_pages) + 1))
        except ValueError:
            pass
        return []
    try:
        n = int(s)
        return [min(max(1, n), max_pages)]
    except ValueError:
        return []


def _try_accept_cookies(page) -> None:
    """Încearcă să dea click pe butonul de accept cookie (diverse formulări comune)."""
    import re
    from playwright.sync_api import TimeoutError as PlaywrightTimeout
    # Buton/link cu text care conține una dintre aceste expresii (case-insensitive)
    cookie_texts = [
        "accept all", "accept cookies", "accept", "agree", "allow all",
        "allow cookies", "allow", "consent", "începe", "continua",
        "sunt de acord", "acceptă", "acceptă toate", "permite toate",
        "ok", "înțeles", "got it",
    ]
    for text in cookie_texts:
        try:
            loc = page.get_by_role("button", name=re.compile(re.escape(text), re.I))
            if loc.count() > 0:
                loc.first.click(timeout=2000)
                page.wait_for_timeout(1500)
                return
        except (PlaywrightTimeout, Exception):
            pass
        try:
            loc = page.locator("a", has_text=re.compile(re.escape(text), re.I))
            if loc.count() > 0:
                loc.first.click(timeout=2000)
                page.wait_for_timeout(1500)
                return
        except (PlaywrightTimeout, Exception):
            pass
    # Selectori comuni pentru overlay-uri cookie
    for sel in [
        "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
        ".qc-cmp2-summary-buttons button",
        "[data-testid*='accept']",
        "[id*='cookie'] button",
        "[class*='cookie-accept']",
        "[class*='cc-accept']",
        "button[aria-label*='cookies i']",
    ]:
        try:
            btn = page.locator(sel).first
            if btn.count() > 0:
                btn.click(timeout=2000)
                page.wait_for_timeout(1500)
                return
        except (PlaywrightTimeout, Exception):
            continue


def _convert_web_to_images(url: str, range_list: list, out_dir: Path) -> int:
    """Capture URL to PNG(s). range_list [1] = full page; [1,2,3,...] = that many viewport screenshots."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise RuntimeError(
            "Playwright not installed. Run: pip install playwright && playwright install chromium"
        )
    count = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(
                viewport={"width": 1920, "height": 1080},
                ignore_https_errors=True,
            )
            page = context.new_page()
            page.goto(url, wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(2000)  # allow JS/render
            _try_accept_cookies(page)
            if range_list == [1]:
                # single full-page screenshot
                out_dir.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(out_dir / "001.png"), full_page=True)
                count = 1
            else:
                # N viewport-sized screenshots (scroll and capture)
                out_dir.mkdir(parents=True, exist_ok=True)
                total = len(range_list)
                for i in range(total):
                    # scroll to i * viewport height
                    page.evaluate(f"window.scrollTo(0, {i * 1080})")
                    page.wait_for_timeout(500)
                    page.screenshot(path=str(out_dir / f"{i + 1:03d}.png"))
                    count += 1
        finally:
            browser.close()
    return count


@app.route("/api/teams/<name>/convert-web", methods=["POST"])
def convert_web(name):
    """Convert web URL to images. Body: { url: 'https://...', range: 'all' | '1' | '1-5' }."""
    try:
        team_dir = _team_path(name)
        data = request.get_json() or {}
        url = (data.get("url") or "").strip()
        if not url or not url.startswith(("http://", "https://")):
            return jsonify({"error": "invalid url"}), 400
        range_str = (data.get("range") or "all").strip()
        range_list = _parse_web_range(range_str)
        if not range_list:
            return jsonify({"error": "invalid range (use all, 1, or 1-5)"}), 400
        folder_name = "web_" + uuid.uuid4().hex[:12]
        folder_rel = f"documents/{folder_name}"
        folder_abs = (team_dir / folder_rel).resolve()
        if not str(folder_abs).startswith(str(team_dir)):
            return jsonify({"error": "invalid path"}), 400
        folder_abs.mkdir(parents=True, exist_ok=True)
        count = _convert_web_to_images(url, range_list, folder_abs)
        return jsonify({"ok": True, "count": count, "path": folder_rel})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ---------- Git: helper commit ----------
def _git_head_commit(cwd: str) -> Optional[str]:
    r = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=5,
    )
    if r.returncode != 0:
        return None
    return (r.stdout or "").strip()


# ---------- Git Connect: verificare + return commit ----------
@app.route("/api/git/connect", methods=["GET", "POST"])
def git_connect():
    """Verifică remote și returnează commit-ul curent."""
    repo_root = _git_repo_root()
    if not repo_root:
        return jsonify({"ok": False, "error": "Nu s-a găsit repository Git (.git)."})
    cwd = str(repo_root)
    try:
        r = subprocess.run(
            ["git", "fetch", "--dry-run"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=15,
        )
        if r.returncode != 0:
            err = (r.stderr or r.stdout or "").strip() or "Git fetch failed."
            return jsonify({"ok": False, "error": err})
        commit = _git_head_commit(cwd)
        return jsonify({"ok": True, "commit": commit or ""})
    except subprocess.TimeoutExpired:
        return jsonify({"ok": False, "error": "Connection timeout."})
    except FileNotFoundError:
        return jsonify({"ok": False, "error": "Git is not installed."})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/git/commit", methods=["GET"])
def git_commit():
    """Returnează commit-ul curent (HEAD)."""
    repo_root = _git_repo_root()
    if not repo_root:
        return jsonify({"ok": False, "error": "No git repo."})
    commit = _git_head_commit(str(repo_root))
    return jsonify({"ok": True, "commit": commit or ""})


@app.route("/api/git/push", methods=["POST"])
def git_push():
    """Add, commit, push. Validates expectedCommit before proceeding."""
    repo_root = _git_repo_root()
    if not repo_root:
        return jsonify({"ok": False, "error": "Nu s-a găsit repository Git (.git). Verifică că proiectul este clonat cu git."})
    cwd = str(repo_root)
    try:
        workspace_rel = str(WORKSPACE_DIR.relative_to(repo_root)).replace("\\", "/")
    except ValueError:
        return jsonify({"ok": False, "error": "WORKSPACE nu este în interiorul repository-ului. Verifică WORKSPACE_PATH în .env."})
    data = request.get_json() or {}
    expected_commit = (data.get("expectedCommit") or "").strip()
    current = _git_head_commit(cwd)
    if expected_commit and current and current != expected_commit:
        return jsonify({
            "ok": False,
            "error": "Changes have been made in the meantime. Please pull first.",
            "needPull": True,
        })
    try:
        r_add = subprocess.run(["git", "add", workspace_rel], cwd=cwd, capture_output=True, text=True, timeout=10)
        if r_add.returncode != 0:
            err = (r_add.stderr or r_add.stdout or "git add failed").strip()
            return jsonify({"ok": False, "error": "git add: " + err})
        r = subprocess.run(
            ["git", "commit", "-m", "Dashboard: update workspace"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=10,
        )
        out = (r.stdout or "") + (r.stderr or "")
        nothing_to_commit = r.returncode != 0 and "nothing to commit" in out.lower()
        if r.returncode != 0 and not nothing_to_commit:
            return jsonify({"ok": False, "error": (r.stderr or r.stdout or "Commit failed.").strip()})
        r2 = subprocess.run(["git", "push"], cwd=cwd, capture_output=True, text=True, timeout=60)
        push_out = (r2.stdout or "") + (r2.stderr or "")
        if r2.returncode != 0:
            err = (r2.stderr or r2.stdout or "Push failed.").strip()
            return jsonify({"ok": False, "error": err})
        new_commit = _git_head_commit(cwd)
        if nothing_to_commit or "everything up-to-date" in push_out.lower():
            return jsonify({
                "ok": True,
                "message": "Nothing to push. Your branch is up to date with origin/master.",
                "commit": new_commit or "",
                "alreadyUpToDate": True,
            })
        return jsonify({"ok": True, "message": "Push successful.", "commit": new_commit or ""})
    except subprocess.TimeoutExpired:
        return jsonify({"ok": False, "error": "Timeout."})
    except FileNotFoundError:
        return jsonify({"ok": False, "error": "Git is not installed."})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/git/pull", methods=["POST"])
def git_pull():
    """Run git pull."""
    repo_root = _git_repo_root()
    if not repo_root:
        return jsonify({"ok": False, "error": "Nu s-a găsit repository Git (.git)."})
    cwd = str(repo_root)
    try:
        r = subprocess.run(["git", "pull"], cwd=cwd, capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            err = (r.stderr or r.stdout or "Pull failed.").strip()
            return jsonify({"ok": False, "error": err})
        return jsonify({"ok": True, "message": "Pull successful."})
    except subprocess.TimeoutExpired:
        return jsonify({"ok": False, "error": "Timeout."})
    except FileNotFoundError:
        return jsonify({"ok": False, "error": "Git is not installed."})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/git/clean-workspace", methods=["POST"])
def clean_workspace():
    """
    Clean WORKSPACE: for each team, delete files/dirs under documents/, photos/, videos/
    that are not referenced in playlist.json. References can be files or directories;
    if a directory is in the playlist, everything inside it is kept (skip).
    """
    if not WORKSPACE_DIR.exists():
        return jsonify({"ok": True, "deleted": [], "teams": [], "message": "Workspace not found."})
    report = {"ok": True, "teams": [], "deleted": [], "errors": []}
    for team_dir in sorted(WORKSPACE_DIR.iterdir()):
        if not team_dir.is_dir() or team_dir.name.startswith("."):
            continue
        team_name = team_dir.name
        pl_path = team_dir / "playlist.json"
        if not pl_path.exists():
            report["teams"].append({"name": team_name, "deleted": [], "skipped": "no playlist.json"})
            continue
        try:
            data = json.loads(pl_path.read_text(encoding="utf-8"))
            slides = data.get("slides") if isinstance(data.get("slides"), list) else []
        except Exception as e:
            report["errors"].append(f"{team_name}: {e}")
            continue
        protected_srcs = set()
        for s in slides:
            src = (s.get("src") or "").strip().replace("\\", "/").strip("/")
            if not src or ".." in src:
                continue
            if src.startswith("documents/") or src.startswith("photos/") or src.startswith("videos/"):
                protected_srcs.add(src)

        def is_protected(rel_path: str) -> bool:
            for s in protected_srcs:
                if s == rel_path or rel_path.startswith(s + "/") or s.startswith(rel_path + "/"):
                    return True
            return False

        to_delete = []
        for sub in ("documents", "photos", "videos"):
            sub_dir = team_dir / sub
            if not sub_dir.is_dir():
                continue
            for root, dirs, files in os.walk(sub_dir, topdown=False):
                root_path = Path(root)
                rel_root = root_path.relative_to(team_dir).as_posix()
                for f in files:
                    rel = (root_path / f).relative_to(team_dir).as_posix()
                    if not is_protected(rel):
                        to_delete.append(rel)
                for d in dirs:
                    rel = (root_path / d).relative_to(team_dir).as_posix()
                    if not is_protected(rel):
                        to_delete.append(rel)
        to_delete.sort(key=lambda p: -p.count("/"))
        team_deleted = []
        for rel in to_delete:
            target = (team_dir / rel).resolve()
            if not str(target).startswith(str(team_dir)) or not target.exists():
                continue
            try:
                if target.is_dir():
                    shutil.rmtree(target)
                else:
                    target.unlink()
                team_deleted.append(rel)
                report["deleted"].append(f"{team_name}/{rel}")
            except Exception as e:
                report["errors"].append(f"{team_name}/{rel}: {e}")
        report["teams"].append({"name": team_name, "deleted": team_deleted})
    return jsonify(report)


def _local_ips():
    """Adrese IP locale pentru afișare la pornire (acces din rețea)."""
    seen = set()
    out = []
    try:
        import socket
        hostname = socket.gethostname()
        for res in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = (res[4][0] if len(res[4]) else "").strip()
            if ip and not ip.startswith("127.") and ip not in seen:
                seen.add(ip)
                out.append(ip)
    except Exception:
        pass
    return out


DASHBOARD_SOURCES_FILE = "dashboard_sources.json"


def _register_dashboard_source(host: str, port: int) -> None:
    """
    Înregistrează acest dashboard în WORKSPACE/dashboard_sources.json și face push în Git.
    Fiecare dispozitiv apare ca Source 1, Source 2, etc. (identificat după hostname).
    Oprit cu REGISTER_DASHBOARD=0 în .env.
    """
    if os.environ.get("REGISTER_DASHBOARD", "1") != "1":
        return
    try:
        import socket
        hostname = (socket.gethostname() or "unknown").strip() or "unknown"
    except Exception:
        hostname = "unknown"
    # Toate adresele pe care asculta dashboard-ul (retea + local); Launcher va incerca pe rand pana gaseste unul care raspunde
    urls = ["http://127.0.0.1:{}".format(port)]
    for ip in _local_ips():
        u = "http://{}:{}".format(ip, port)
        if u not in urls:
            urls.append(u)
    url = urls[1] if len(urls) > 1 else urls[0]  # primul din retea pentru backward compat
    repo_root = _git_repo_root()
    if not repo_root:
        print("  [Dashboard register] Nu exista repo Git; nu se inregistreaza sursa.")
        return
    sources_path = WORKSPACE_DIR / DASHBOARD_SOURCES_FILE
    data = {"sources": []}
    if sources_path.exists():
        try:
            data = json.loads(sources_path.read_text(encoding="utf-8"))
            if not isinstance(data.get("sources"), list):
                data["sources"] = []
        except Exception:
            data = {"sources": []}
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    found = False
    for s in data["sources"]:
        if (s.get("hostname") or "").strip() == hostname:
            s["url"] = url
            s["urls"] = urls
            s["lastSeen"] = now_iso
            found = True
            break
    if not found:
        n = len(data["sources"]) + 1
        data["sources"].append({
            "hostname": hostname,
            "title": "Source {}".format(n),
            "url": url,
            "urls": urls,
            "lastSeen": now_iso,
        })
    try:
        sources_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        print("  [Dashboard register] Eroare scriere fisier:", e)
        return
    cwd = str(repo_root)
    try:
        workspace_rel = str(WORKSPACE_DIR.relative_to(repo_root)).replace("\\", "/")
    except ValueError:
        return
    try:
        subprocess.run(["git", "pull", "--rebase"], cwd=cwd, capture_output=True, text=True, timeout=30)
        subprocess.run(["git", "add", workspace_rel + "/" + DASHBOARD_SOURCES_FILE], cwd=cwd, capture_output=True, text=True, timeout=10)
        rc = subprocess.run(
            ["git", "commit", "-m", "Dashboard register: {} ({})".format(
                next((s["title"] for s in data["sources"] if s.get("hostname") == hostname), "Source"),
                url,
            )],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=10,
        )
        if rc.returncode == 0:
            subprocess.run(["git", "push"], cwd=cwd, capture_output=True, text=True, timeout=60)
            print("  [Dashboard register] Inregistrat in Git: {} -> {} ({} adrese)".format(hostname, url, len(urls)))
        # else: nothing to commit (date neschimbate), nu e eroare
    except subprocess.TimeoutExpired:
        print("  [Dashboard register] Timeout la git push.")
    except Exception as e:
        print("  [Dashboard register] Eroare git:", getattr(e, "message", str(e)))


if __name__ == "__main__":
    host = os.environ.get("FLASK_HOST", "0.0.0.0")
    port = int(os.environ.get("FLASK_PORT", "5000"))
    _register_dashboard_source(host, port)
    print("WORKSPACE_DIR =", WORKSPACE_DIR)
    print("Dashboard: http://127.0.0.1:{} (local)".format(port))
    if host == "0.0.0.0":
        for ip in _local_ips():
            print("             http://{}:{} (retea)".format(ip, port))
        print("  Acces din retea: foloseste http://<IP-acest-PC>:{} din alt browser.".format(port))
    use_waitress = os.environ.get("USE_WAITRESS", "1") == "1"
    if use_waitress:
        try:
            import waitress
            print("  Server: Waitress (WSGI, potrivit pentru retea).")
            waitress.serve(app, host=host, port=port, threads=6)
        except ImportError:
            app.run(host=host, port=port, debug=False)
    else:
        app.run(host=host, port=port, debug=False)
