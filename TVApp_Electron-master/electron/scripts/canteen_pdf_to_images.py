#!/usr/bin/env python3
"""
Convert canteen menu PDFs to PNGs using PyMuPDF (fitz), same as Dashboard_TVApp.
Called from Electron when Python is available for identical output to playlist.
Usage: python canteen_pdf_to_images.py --workspace <dir> --team <name> --items '<json>'
Items JSON: [{"path": "pdfs/meniu.pdf", "range": "all"}, ...]
Output: OK and count on stdout, or ERROR and message on stderr; exit 0 on success, 1 on failure.
"""
import argparse
import json
import sys
from pathlib import Path


def parse_range(range_str: str, total_pages: int) -> list:
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True, help="Workspace root directory")
    parser.add_argument("--team", required=True, help="Team name")
    parser.add_argument("--items", required=True, help="JSON array of {path, range}")
    parser.add_argument("--scale", type=int, default=3, help="Zoom for render (2=small, 3=sharp, 4=very sharp)")
    args = parser.parse_args()
    zoom = max(1, min(5, args.scale or 3))
    workspace = Path(args.workspace).resolve()
    team = args.team.strip()
    if not team:
        print("ERROR: empty team", file=sys.stderr)
        return 1
    try:
        items = json.loads(args.items)
    except json.JSONDecodeError as e:
        print("ERROR: invalid items JSON: " + str(e), file=sys.stderr)
        return 1
    if not isinstance(items, list):
        print("ERROR: items must be a JSON array", file=sys.stderr)
        return 1

    team_dir = workspace / team
    canteen_dir = team_dir / "canteen_menu"
    menu_pdf_dir = canteen_dir / "menu_pdf"
    menu_pdf_dir.mkdir(parents=True, exist_ok=True)
    for f in menu_pdf_dir.iterdir():
        if f.is_file():
            try:
                f.unlink()
            except Exception:
                pass

    valid = [
        x for x in items
        if x and isinstance(x.get("path"), str) and (x.get("path") or "").strip()
    ]
    if not valid:
        print("OK 0")
        return 0

    try:
        import fitz
    except ImportError:
        print("ERROR: PyMuPDF (fitz) not installed. pip install pymupdf", file=sys.stderr)
        return 1

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
                page_nums = parse_range(range_str, total)
                for p1 in page_nums:
                    if p1 < 1 or p1 > total:
                        continue
                    page = doc.load_page(p1 - 1)
                    mat = fitz.Matrix(zoom, zoom)
                    pix = page.get_pixmap(matrix=mat, alpha=False)
                    global_idx += 1
                    out_name = f"{global_idx:03d}.png"
                    pix.save(str(menu_pdf_dir / out_name))
            finally:
                doc.close()
        print("OK", global_idx)
        return 0
    except Exception as e:
        print("ERROR: " + str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
