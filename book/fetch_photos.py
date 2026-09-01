#!/usr/bin/env python3
"""Fetch freely-licensed photographs for the Egypt book from Wikimedia Commons.

Everything on Commons is freely licensed, but the terms differ, so each file's
licence and author are read off its wikitext and written to photos/credits.csv —
the book prints them on its final page, which is what CC BY / CC BY-SA require.

Endpoint choice matters: commons.wikimedia.org/w/api.php is aggressively
rate-limited (HTTP 429) from shared egress IPs, while the REST search endpoint,
`action=raw` wikitext and Special:FilePath downloads are not. So this script
uses those three and only falls back to api.php if REST search comes up empty.
"""
import csv, os, re, sys, time
import requests
from PIL import Image

BASE = "https://commons.wikimedia.org"
WP = "https://en.wikipedia.org"      # same file repository, separate rate limiter
UA = {"User-Agent": "EgyptBookBot/1.0 (https://github.com/asamaka/engzny) python-requests"}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "photos")
MIN_WIDTH = 700
TARGET_WIDTH = 2000
MIN_GAP = 4.0                     # polite pacing between requests
IMAGE_EXT = (".jpg", ".jpeg", ".png")

S = requests.Session(); S.headers.update(UA)
_last = [0.0]


def _get(url, **kw):
    err = "?"
    for attempt in range(3):
        gap = MIN_GAP - (time.time() - _last[0])
        if gap > 0:
            time.sleep(gap)
        try:
            r = S.get(url, timeout=30, **kw)
            _last[0] = time.time()
            if r.status_code == 200:
                return r
            err = f"HTTP {r.status_code}"
            if r.status_code in (400, 403, 404, 410):
                break                       # a miss, not a throttle — don't retry
        except Exception as exc:
            _last[0] = time.time()
            err = repr(exc)[:60]
        time.sleep(8.0 * (attempt + 1))
    print(f"    ! {err}", flush=True)
    return None


# ─────────────────────────── Commons plumbing ───────────────────────────

def rest_search(query, limit=10):
    """Titles for a query, via the REST search endpoint (not rate-limited)."""
    r = _get(f"{BASE}/w/rest.php/v1/search/page", params={"q": query, "limit": limit})
    if not r:
        return []
    try:
        pages = r.json().get("pages", [])
    except ValueError:
        return []
    out = []
    for p in pages:
        key = (p.get("key") or "").replace("_", " ")
        if key.startswith("File:") and key.lower().endswith(IMAGE_EXT):
            out.append(key)
    return out


def wikipedia_images(article, limit=30):
    """Files used by an English Wikipedia article. Commons-hosted, curated by editors,
    and served by a host with its own (much friendlier) rate limit."""
    if not article:
        return []
    r = _get(f"{WP}/w/api.php", params={"action": "query", "format": "json", "prop": "images",
                                        "titles": article, "imlimit": 50})
    if not r:
        return []
    try:
        pages = r.json().get("query", {}).get("pages", {})
    except ValueError:
        return []
    out = []
    for p in pages.values():
        for im in p.get("images", []):
            t = im.get("title", "")
            if t.lower().endswith(IMAGE_EXT):
                out.append(t)
    return out[:limit]


def meta_via_wikipedia(title):
    """Licence + author from the shared-repo metadata, via en.wikipedia."""
    r = _get(f"{WP}/w/api.php", params={"action": "query", "format": "json", "titles": title,
                                        "prop": "imageinfo", "iiprop": "extmetadata"})
    if not r:
        return None
    try:
        pages = r.json().get("query", {}).get("pages", {})
    except ValueError:
        return None
    for p in pages.values():
        ii = (p.get("imageinfo") or [{}])[0]
        em = ii.get("extmetadata", {}) or {}
        lic = _clean(em.get("LicenseShortName", {}).get("value", ""))
        author = _clean(em.get("Artist", {}).get("value", ""))
        if lic or author:
            return {"licence": lic or "see Commons file page",
                    "author": (author or "unknown")[:120]}
    return None


def category_files(category, limit=30):
    """File titles listed on a category page. A plain page view, so it keeps working
    when both search endpoints are being throttled."""
    r = _get(f"{BASE}/wiki/Category:" + requests.utils.quote(category.replace(" ", "_")))
    if not r:
        return []
    seen, out = set(), []
    for m in re.finditer(r'href="/wiki/(File:[^"?#]+)"', r.text):
        title = requests.utils.unquote(m.group(1)).replace("_", " ")
        if title.lower().endswith(IMAGE_EXT) and title not in seen:
            seen.add(title); out.append(title)
        if len(out) >= limit:
            break
    return out


def api_search(query, limit=8):
    """Old-API fallback; often 429s, so it is only tried when REST finds nothing."""
    r = _get(f"{BASE}/w/api.php", params={"action": "query", "format": "json",
                                          "generator": "search", "gsrsearch": query,
                                          "gsrnamespace": 6, "gsrlimit": limit})
    if not r:
        return []
    try:
        pages = r.json().get("query", {}).get("pages", {})
    except ValueError:
        return []
    return [p["title"] for p in pages.values()
            if p.get("title", "").lower().endswith(IMAGE_EXT)]


LICENCE_PATTERNS = [
    (re.compile(r"^cc[-_ ]by[-_ ]sa[-_ ]?([\d.]+)", re.I), lambda m: f"CC BY-SA {m.group(1)}"),
    (re.compile(r"^cc[-_ ]by[-_ ]?([\d.]+)", re.I),        lambda m: f"CC BY {m.group(1)}"),
    (re.compile(r"^cc[-_ ]?zero|^cc0", re.I),              lambda m: "CC0"),
    (re.compile(r"^pd[-_ ]|^public domain", re.I),         lambda m: "Public domain"),
    (re.compile(r"^copyrighted free use", re.I),           lambda m: "Copyrighted free use"),
    (re.compile(r"^attribution$", re.I),                   lambda m: "Attribution"),
]


def _clean(value):
    value = re.sub(r"\{\{\s*(?:creator|user|u)\s*[:|]\s*([^{}|]+)\}\}", r"\1", value, flags=re.I)
    value = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", value)
    value = re.sub(r"\[\[([^\]]*)\]\]", r"\1", value)
    value = re.sub(r"\{\{[^{}]*\}\}", " ", value)
    value = re.sub(r"</?[^>]+>", " ", value)
    value = value.replace("[", "").replace("]", "").replace("|", " ")
    return re.sub(r"\s+", " ", value).strip(" .;,")


def wikitext_meta(title):
    """Licence + author read straight off the file page's wikitext."""
    r = _get(f"{BASE}/w/index.php", params={"title": title.replace(" ", "_"), "action": "raw"})
    if not r:
        return None
    text = r.text
    licence = ""
    for token in re.findall(r"\{\{([^{}]*)\}\}", text):
        for part in token.split("|"):
            part = part.strip()
            for pattern, fmt in LICENCE_PATTERNS:
                m = pattern.match(part)
                if m:
                    licence = licence or fmt(m)
                    break
            if licence:
                break
        if licence:
            break
    m = re.search(r"\|\s*(?:author|artist)\s*=\s*(.+)", text, re.I)
    author = _clean(m.group(1)) if m else ""
    author = re.sub(r"\s+talk$", "", author, flags=re.I)
    if not author or author.lower() in ("unknown author", "unknown", "anonymous"):
        author = "unknown"
    if not licence:
        licence = licence_from_html(title)
    return {"licence": licence or "see Commons file page", "author": author[:120]}


def licence_from_html(title):
    """Rendered file page — resolves user licence templates the wikitext only transcludes."""
    r = _get(f"{BASE}/wiki/" + requests.utils.quote(title.replace(" ", "_")))
    if not r:
        return ""
    m = re.search(r'class="licensetpl_short"[^>]*>([^<]{2,40})<', r.text)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip()
    if re.search(r"public\s*domain", r.text, re.I):
        return "Public domain"
    return ""


def download(title, dest):
    name = requests.utils.quote(title.split(":", 1)[1].replace(" ", "_"))
    r = (_get(f"{WP}/wiki/Special:FilePath/{name}", params={"width": TARGET_WIDTH})
         or _get(f"{BASE}/wiki/Special:FilePath/{name}", params={"width": TARGET_WIDTH}))
    if not r or not r.headers.get("content-type", "").startswith("image/"):
        return False
    with open(dest, "wb") as fh:
        fh.write(r.content)
    try:
        im = Image.open(dest); im.load()
        if im.width < MIN_WIDTH:
            raise ValueError(f"only {im.width}px wide")
        if im.mode != "RGB":
            im.convert("RGB").save(dest, "JPEG", quality=90)
    except Exception as exc:
        print(f"    - rejected {title}: {exc}", flush=True)
        if os.path.exists(dest):
            os.remove(dest)
        return False
    return True


def rank(found, query, already):
    """A page's images come back alphabetically; put the ones that actually match first."""
    terms = [w for w in re.findall(r"[a-z0-9]+", query.lower()) if len(w) > 3]
    scored = []
    for t in found:
        if t in already:
            continue
        words = set(re.findall(r"[a-z0-9]+", t.lower()))
        scored.append((-sum(1 for w in terms if w in words), t))
    scored.sort(key=lambda p: p[0])
    return [t for _, t in scored]


def fetch(slot, titles, query, category="", article=""):
    """Hand-picked titles first, then a category listing, then search."""
    dest = os.path.join(OUT, slot + ".jpg")
    print(f"  · {slot}", flush=True)
    candidates = list(titles)
    if len(candidates) < 3:
        found = (wikipedia_images(article) or (category_files(category) if category else [])
                 or rest_search(query) or api_search(query))
        candidates += rank(found, query, candidates)
    for title in candidates[:10]:
        if not title.lower().endswith(IMAGE_EXT):
            continue
        if download(title, dest):
            meta = (meta_via_wikipedia(title) or wikitext_meta(title)
                    or {"licence": "see Commons file page", "author": "unknown"})
            print(f"    -> {title}  [{meta['licence']}]", flush=True)
            return {"slot": slot, "file": slot + ".jpg", "commons_title": title,
                    "licence": meta["licence"], "author": meta["author"],
                    "url": f"{BASE}/wiki/" + title.replace(" ", "_")}
    print("    -> nothing usable; the book will draw its fallback plate", flush=True)
    return None


# slot -> (hand-picked Commons titles, fallback search)
SLOTS = [
    ("cover",        ["File:Pyramids of the Giza Necropolis.jpg"], "Giza pyramids panorama Egypt"),
    ("part1",        ["File:Karnak Tempel Chnum 08.jpg"], "Karnak hypostyle hall columns Luxor"),
    ("part2",        [], "Cairo skyline Nile river"),
    ("nile",         ["File:Nile River, Feluccas, Aswan, Egypt.jpg"], "Nile river Aswan felucca"),
    ("narmer",       ["File:Narmer Palette smiting side.jpg", "File:Narmer palette (obverse).jpg"],
                     "Narmer Palette"),
    ("djoser",       ["File:Pyramid of Djoser 2010.jpg"], "Pyramid of Djoser Saqqara"),
    ("khufu",        [], "Great Pyramid of Khufu Giza"),
    ("hatshepsut",   ["File:Temple of Hatshepsut, Deir el-Bahari, Luxor, Egypt.jpg"],
                     "Mortuary Temple of Hatshepsut Deir el-Bahari"),
    ("akhenaten",    ["File:Nofretete Neues Museum.jpg", "File:Nefertiti bust - Altes Museum - Berlin.jpg"],
                     "Nefertiti bust Berlin"),
    ("tutankhamun",  ["File:Mask of Tutankhamun in 2025.jpg",
                      "File:CairoEgMuseumTaaMaskMostlyPhotographed.jpg"], "Mask of Tutankhamun"),
    ("ramesses",     [], "Abu Simbel Great Temple Ramesses II facade"),
    ("cleopatra",    ["File:Dendera Tempel 14.JPG"], "Dendera temple Hathor relief"),
    ("hunefer",      ["File:Book of the Dead of Hunefer sheet 3.jpg",
                      "File:Book of the Dead of Hunefer sheet 1.jpg"], "Book of the Dead Hunefer"),
    ("muhammadali",  ["File:ModernEgypt, Muhammad Ali by Auguste Couder, BAP 17996.jpg"],
                     "Muhammad Ali Pasha of Egypt portrait"),
    ("suez1869",     ["File:Открытие Суэцкого канала, 1869.jpg"], "Opening of the Suez Canal 1869"),
    ("carter1922",   ["File:Howard Carter and Arthur Callender in Tutankhamun's tomb.jpg"],
                     "Howard Carter Tutankhamun tomb 1922"),
    ("revolution1952", [], "Muhammad Naguib Gamal Abdel Nasser 1952 revolution Egypt",
                     "Egyptian revolution of 1952", "Egyptian revolution of 1952"),
    ("nasser",       ["File:Gamal Abdel Nasser Portrait 1962 (3x4 cropped).jpg"],
                     "Gamal Abdel Nasser portrait"),
    ("aswan",        ["File:Aswan Dam 21-2-08.jpg"], "Aswan High Dam Egypt"),
    ("war1973",      ["File:Egyptians Crossing Suez Canal.jpg",
                      "File:Egyptian forces crossing the Suez Canal.jpg"],
                     "Egyptian forces crossing Suez Canal October War"),
    ("campdavid",    [], "Camp David Accords 1978 Sadat Begin Carter", "Camp David Accords",
                     "Camp David Accords"),
    ("tahrir2011",   [], "Tahrir Square February 2011 Cairo protest",
                     "Tahrir Square during the Egyptian revolution of 2011",
                     "Egyptian revolution of 2011"),
    ("gem2025",      ["File:View of Pyramids of Giza from Grand Egyptian Museum.jpg"],
                     "Grand Egyptian Museum Giza", "Grand Egyptian Museum",
                     "Grand Egyptian Museum"),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])
    csv_path = os.path.join(OUT, "credits.csv")
    rows = []
    if os.path.exists(csv_path):
        with open(csv_path, newline="", encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
    print(f"Fetching into {OUT}")
    for entry in SLOTS:
        slot, titles, query = entry[0], entry[1], entry[2]
        category = entry[3] if len(entry) > 3 else ""
        article = entry[4] if len(entry) > 4 else ""
        if only and slot not in only:
            continue
        have = os.path.join(OUT, slot + ".jpg")
        if slot not in only and os.path.exists(have) and any(r["slot"] == slot for r in rows):
            print(f"  = {slot} (already have it)")
            continue
        row = fetch(slot, titles, query, category, article)
        if row:
            rows = [r for r in rows if r["slot"] != slot] + [row]
            with open(csv_path, "w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, ["slot", "file", "commons_title", "licence", "author", "url"])
                w.writeheader(); w.writerows(rows)
    stale = [r for r in rows if r["licence"] == "see Commons file page"]
    for r in stale:
        meta = meta_via_wikipedia(r["commons_title"]) or wikitext_meta(r["commons_title"])
        if meta and meta["licence"] != "see Commons file page":
            r.update(licence=meta["licence"], author=meta["author"])
            print(f"  ~ {r['slot']} licence resolved: {meta['licence']}")
    if stale:
        with open(csv_path, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, ["slot", "file", "commons_title", "licence", "author", "url"])
            w.writeheader(); w.writerows(rows)
    print(f"\n{len(rows)}/{len(SLOTS)} slots filled — credits in {csv_path}")


if __name__ == "__main__":
    main()
