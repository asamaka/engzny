#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build EGYPT — Five Thousand Years on the Nile (A4 PDF).

Photographs are read from photos/<slot>.jpg (see fetch_photos.py) and cropped to
fill their frame. Any slot with no file falls back to a drawn plate, so the book
always builds. Credits from photos/credits.csv are printed on the final page,
which is what CC BY / CC BY-SA require in print.
"""
import csv, io, os, re
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rlcanvas

import content

HERE = os.path.dirname(os.path.abspath(__file__))
PHOTOS = os.path.join(HERE, "photos")
OUTPUT = os.path.join(HERE, "Egypt-Five-Thousand-Years-on-the-Nile.pdf")
DPI = 200        # print-usable without a 50 MB file
JPEG_Q = 82

W, H = A4
M = 48.0                      # page margin
CW = W - 2 * M                # content width
GUT = 20.0                    # column gutter
COLW = (CW - GUT) / 2

INK    = HexColor("#14110D")
BODY   = HexColor("#2A2620")
MUTED  = HexColor("#6E6558")
RULE   = HexColor("#C9BCA4")
GOLD   = HexColor("#9A7B33")
SAND   = HexColor("#F4EEE2")
DEEP   = HexColor("#1B2A33")
PAPER  = HexColor("#FBF8F1")

FONTS = {
    "serif":   ("/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf", "BookSerif"),
    "serifb":  ("/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",    "BookSerif-Bold"),
    "serifi":  ("/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf",  "BookSerif-Italic"),
    "display": ("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",            "BookDisplay"),
    "sans":    ("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",  "BookSans"),
    "sansb":   ("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",     "BookSans-Bold"),
}
F = {}
for key, (path, name) in FONTS.items():
    if os.path.exists(path):
        pdfmetrics.registerFont(TTFont(name, path)); F[key] = name
    else:                                            # built-in fallbacks
        F[key] = {"serif": "Times-Roman", "serifb": "Times-Bold", "serifi": "Times-Italic",
                  "display": "Times-Bold", "sans": "Helvetica", "sansb": "Helvetica-Bold"}[key]


# ─────────────────────────────── primitives ───────────────────────────────

def caps(c, text, x, y, font, size, tracking=1.6, color=MUTED, center=False):
    """Letterspaced label (canvas has no setCharSpace; text objects do)."""
    if center:
        wid = c.stringWidth(text, font, size) + tracking * max(len(text) - 1, 0)
        x -= wid / 2
    t = c.beginText(); t.setFont(font, size); t.setCharSpace(tracking)
    t.setFillColor(color); t.setTextOrigin(x, y); t.textOut(text)
    t.setCharSpace(0); t.setWordSpace(0)
    c.drawText(t)


def rule(c, x, y, w, color=RULE, lw=0.6):
    c.setStrokeColor(color); c.setLineWidth(lw); c.line(x, y, x + w, y)


def sq(text):
    """Straight apostrophes/quotes -> typographic ones."""
    out, prev = [], " "
    for ch in text:
        if ch == "'":
            out.append("\u2019" if prev.isalnum() else "\u2018")
        elif ch == '"':
            out.append("\u201d" if prev.isalnum() else "\u201c")
        else:
            out.append(ch)
        prev = ch
    return "".join(out)


def wrap(c, text, font, size, width_for_line, start_index=0):
    """Greedy wrap. width_for_line(i) -> usable width for line i."""
    words, lines, cur, i = sq(text).split(), [], [], start_index
    for w_ in words:
        trial = cur + [w_]
        if c.stringWidth(" ".join(trial), font, size) <= width_for_line(i) or not cur:
            cur = trial
        else:
            lines.append(cur); i += 1; cur = [w_]
    if cur:
        lines.append(cur)
    return lines


def draw_justified(c, lines, x, y, font, size, leading, width_for_line, first_index=0,
                   color=BODY, indents=None):
    """Draw pre-wrapped lines, justified except the last line of each paragraph."""
    c.setFillColor(color)
    for n, (words, last) in enumerate(lines):
        idx = first_index + n
        ind = (indents or {}).get(idx, 0.0)
        avail = width_for_line(idx) - ind
        t = c.beginText(); t.setFont(font, size); t.setTextOrigin(x + ind, y)
        t.setFillColor(color); t.setCharSpace(0); t.setWordSpace(0)
        if not last and len(words) > 1:
            natural = c.stringWidth(" ".join(words), font, size)
            extra = (avail - natural) / (len(words) - 1)
            if extra > 0:
                t.setWordSpace(min(extra, size * 0.55))
        t.textLine(" ".join(words))
        t.setWordSpace(0)
        c.drawText(t)
        y -= leading
    return y


def paragraphs_to_lines(c, paras, font, size, width_for_line):
    """Wrap a list of paragraphs into [(words, is_last_line_of_para)] with indents."""
    out, indents, i = [], {}, 0
    for p, para in enumerate(paras):
        if p:
            indents[i] = 13.0
        def wfl(k, _p=p, _start=i):
            return width_for_line(k) - (13.0 if (_p and k == _start) else 0.0)
        wrapped = wrap(c, sq(para), font, size, wfl, start_index=i)
        for n, words in enumerate(wrapped):
            out.append((words, n == len(wrapped) - 1))
        i += len(wrapped)
    return out, indents


# ─────────────────────────────── images ───────────────────────────────

def photo_path(slot):
    for ext in (".jpg", ".jpeg", ".png"):
        p = os.path.join(PHOTOS, slot + ext)
        if os.path.exists(p) and os.path.getsize(p) > 20000:
            return p
    return None


def draw_fill(c, path, x, y, w, h, bias=0.42):
    """Draw an image cropped to completely fill the box (centre-weighted, bias upward)."""
    from PIL import Image
    im = Image.open(path)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    iw, ih = im.size
    target = w / h
    if iw / ih > target:                       # too wide -> crop sides
        nw = int(ih * target)
        left = (iw - nw) // 2
        im = im.crop((left, 0, left + nw, ih))
    else:                                      # too tall -> crop top/bottom, favour the top
        nh = int(iw / target)
        top = int((ih - nh) * bias)
        im = im.crop((0, top, iw, top + nh))
    target_px = int(w * DPI / 72.0)
    if im.width > target_px:
        im = im.resize((target_px, max(1, int(target_px * im.height / im.width))), Image.LANCZOS)
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=JPEG_Q, optimize=True)
    buf.seek(0)
    c.drawImage(ImageReader(buf), x, y, w, h, mask=None)
    c.setStrokeColor(Color(0, 0, 0, 0.18)); c.setLineWidth(0.5); c.rect(x, y, w, h)


def draw_contain(c, path, x, y, w, h):
    """Tall artefacts (a palette, a mask, a painted portrait) lose their subject to a
    landscape crop, so show them whole on a sand panel instead."""
    from PIL import Image
    im = Image.open(path)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    scale = min(w / im.width, h / im.height)
    iw, ih = im.width * scale, im.height * scale
    c.setFillColor(SAND); c.rect(x, y, w, h, stroke=0, fill=1)
    c.setStrokeColor(RULE); c.setLineWidth(0.5); c.rect(x, y, w, h, stroke=1, fill=0)
    target_px = int(iw * DPI / 72.0)
    if im.width > target_px:
        im = im.resize((target_px, max(1, int(target_px * im.height / im.width))), Image.LANCZOS)
    buf = io.BytesIO(); im.convert("RGB").save(buf, "JPEG", quality=JPEG_Q, optimize=True)
    buf.seek(0)
    c.drawImage(ImageReader(buf), x + (w - iw) / 2, y + (h - ih) / 2, iw, ih, mask=None)


def plate(c, motif, x, y, w, h):
    """Drawn fallback when no photograph is available for a slot."""
    c.saveState()
    c.setFillColor(SAND); c.rect(x, y, w, h, stroke=0, fill=1)
    c.setStrokeColor(RULE); c.setLineWidth(0.6); c.rect(x, y, w, h, stroke=1, fill=0)
    cx, cy = x + w / 2, y + h / 2
    c.setFillColor(HexColor("#D8C8A6")); c.setStrokeColor(HexColor("#B49A66"))
    if motif == "pyramid":
        c.circle(cx + w * 0.24, y + h * 0.68, h * 0.11, stroke=0, fill=1)
        base = y + h * 0.22
        for cx0, hw, hh in ((cx - w * 0.14, w * 0.20, h * 0.44), (cx + w * 0.13, w * 0.13, h * 0.30)):
            p = c.beginPath(); p.moveTo(cx0 - hw, base); p.lineTo(cx0, base + hh)
            p.lineTo(cx0 + hw, base); p.close(); c.drawPath(p, stroke=0, fill=1)
        rule(c, x + w * 0.08, base, w * 0.84, HexColor("#B49A66"), 1.0)
    elif motif == "wave":
        for i in range(6):
            yy = y + h * (0.24 + i * 0.09)
            p = c.beginPath(); p.moveTo(x + w * 0.08, yy)
            step = (w * 0.84) / 12
            for k in range(12):
                p.curveTo(x + w * 0.08 + step * k + step * 0.3, yy + 5,
                          x + w * 0.08 + step * k + step * 0.7, yy - 5,
                          x + w * 0.08 + step * (k + 1), yy)
            c.setLineWidth(1.1); c.drawPath(p, stroke=1, fill=0)
    elif motif == "column":
        for i in range(5):
            cx0 = x + w * (0.16 + i * 0.17)
            c.rect(cx0 - w * 0.028, y + h * 0.20, w * 0.056, h * 0.50, stroke=0, fill=1)
            c.circle(cx0, y + h * 0.74, w * 0.035, stroke=0, fill=1)
        rule(c, x + w * 0.08, y + h * 0.20, w * 0.84, HexColor("#B49A66"), 1.0)
    elif motif == "sun":
        c.circle(cx, cy + h * 0.05, h * 0.17, stroke=0, fill=1)
        c.setLineWidth(1.0)
        import math
        for k in range(24):
            a = math.radians(k * 15)
            c.line(cx + math.cos(a) * h * 0.20, cy + h * 0.05 + math.sin(a) * h * 0.20,
                   cx + math.cos(a) * h * 0.34, cy + h * 0.05 + math.sin(a) * h * 0.34)
    else:                                       # cartouche
        rw, rh = w * 0.46, h * 0.34
        c.setLineWidth(1.6); c.roundRect(cx - rw / 2, cy - rh / 2, rw, rh, rh / 2, stroke=1, fill=0)
        for i in range(4):
            c.circle(cx - rw * 0.26 + i * rw * 0.17, cy, 4.2, stroke=0, fill=1)
    c.restoreState()


def image_or_plate(c, page, x, y, w, h):
    p = photo_path(page["slot"])
    if p:
        try:
            from PIL import Image
            with Image.open(p) as probe:
                tall = probe.width / probe.height < 0.8
            (draw_contain if tall else draw_fill)(c, p, x, y, w, h)
            return True
        except Exception:
            pass
    plate(c, page.get("motif", "star"), x, y, w, h)
    return False


# ─────────────────────────────── pages ───────────────────────────────

def page_bg(c, color=PAPER):
    c.setFillColor(color); c.rect(0, 0, W, H, stroke=0, fill=1)


def scrim(c, x, y, w, h, top=0.20, bottom=0.82, steps=None):
    """Smooth dark gradient (alpha PNG) so type stays readable over a photograph.

    `top` / `bottom` are alpha at the top and bottom edges of the box.
    """
    from PIL import Image
    n = 256
    img = Image.new("RGBA", (1, n))
    px = img.load()
    for i in range(n):                      # row 0 is the top of the image
        a = top + (bottom - top) * (i / (n - 1.0))
        px[0, i] = (10, 13, 16, int(max(0.0, min(1.0, a)) * 255))
    c.drawImage(ImageReader(img.resize((8, n), Image.BILINEAR)), x, y, w, h, mask="auto")


def cover(c):
    page_bg(c, DEEP)
    if photo_path("cover"):
        try:
            draw_fill(c, photo_path("cover"), 0, 0, W, H, bias=0.35)
        except Exception:
            pass
    else:
        plate(c, "pyramid", 0, 0, W, H)
    scrim(c, 0, 0, W, H * 0.70, top=0.0, bottom=0.90)
    scrim(c, 0, H * 0.80, W, H * 0.20, top=0.55, bottom=0.0)
    caps(c, "AN ILLUSTRATED HISTORY", W / 2, H - 76, F["sansb"], 8.6, 3.4,
         Color(1, 1, 1, 0.85), center=True)
    caps(c, content.TITLE, W / 2, 232, F["display"], 84, 8, Color(1, 1, 1, 0.95), center=True)
    c.setStrokeColor(Color(0.82, 0.68, 0.34, 0.95)); c.setLineWidth(1.4)
    c.line(W / 2 - 92, 208, W / 2 + 92, 208)
    c.setFont(F["serifi"], 19); c.setFillColor(Color(1, 1, 1, 0.92))
    c.drawCentredString(W / 2, 176, content.SUBTITLE)
    c.setFont(F["serif"], 10.4); c.setFillColor(Color(1, 1, 1, 0.72))
    for i, ln in enumerate(wrap(c, content.BYLINE, F["serif"], 10.4, lambda k: 330)):
        c.drawCentredString(W / 2, 148 - i * 14, " ".join(ln))
    c.showPage()


def title_page(c, credits_note):
    page_bg(c)
    caps(c, content.TITLE, W / 2, H - 250, F["display"], 40, 5, INK, center=True)
    rule(c, W / 2 - 70, H - 268, 140, GOLD, 1.0)
    c.setFont(F["serifi"], 15); c.setFillColor(BODY)
    c.drawCentredString(W / 2, H - 296, content.SUBTITLE)
    c.setFont(F["serif"], 10); c.setFillColor(MUTED)
    for i, ln in enumerate(wrap(c, content.BYLINE, F["serif"], 10, lambda k: 300)):
        c.drawCentredString(W / 2, H - 322 - i * 13, " ".join(ln))
    c.setFont(F["serif"], 8.6); c.setFillColor(MUTED)
    note = ("Text compiled 2026. Photographs are reproduced from Wikimedia Commons under public "
            "domain, CC0, CC BY or CC BY-SA terms; each is credited on the final page. "
            + credits_note)
    y = 150
    for ln in wrap(c, note, F["serif"], 8.6, lambda k: 330):
        c.drawCentredString(W / 2, y, " ".join(ln)); y -= 11.6
    c.showPage()


def contents_page(c, pages, folios, credits_folio):
    page_bg(c)
    caps(c, "CONTENTS", M, H - 96, F["sansb"], 10, 3.2, GOLD)
    rule(c, M, H - 108, CW)
    y = H - 146
    part_of = {}
    for i, p in enumerate(pages):
        part_of.setdefault(p["part"], []).append((i, p))
    for pi, part in enumerate(content.PARTS):
        c.setFillColor(INK); c.setFont(F["display"], 13)
        c.drawString(M, y, f"{part['number']}.  {part['title']}")
        c.setFont(F["serifi"], 9.4); c.setFillColor(MUTED)
        c.drawRightString(W - M, y, part["span"])
        y -= 20
        for i, p in part_of.get(pi, []):
            c.setFont(F["serif"], 10.6); c.setFillColor(BODY)
            label = p["title"]
            c.drawString(M + 16, y, label)
            c.setFont(F["serif"], 9.2); c.setFillColor(MUTED)
            era = p["era"]
            lw = c.stringWidth(label, F["serif"], 10.6)
            folio = str(folios[i])
            fw = c.stringWidth(folio, F["serif"], 9.2)
            ew = c.stringWidth(era, F["serif"], 9.2)
            c.drawString(W - M - fw - 10 - ew, y, era)
            dots_x0, dots_x1 = M + 22 + lw, W - M - fw - 16 - ew
            if dots_x1 > dots_x0:
                c.setStrokeColor(HexColor("#DCD2C0")); c.setLineWidth(0.5)
                c.setDash(0.7, 3.2); c.line(dots_x0, y + 2.6, dots_x1, y + 2.6); c.setDash()
            c.setFillColor(MUTED); c.setFont(F["serif"], 9.2)
            c.drawRightString(W - M, y, folio)
            y -= 16.4
        y -= 16
    c.setFont(F["serifi"], 9.4); c.setFillColor(MUTED)
    c.drawString(M, 96, "Photograph credits and licences")
    c.drawRightString(W - M, 96, str(credits_folio))
    rule(c, M, 108, CW)
    c.showPage()


def part_page(c, part):
    page_bg(c, DEEP)
    p = photo_path(part["image"]) or photo_path(part.get("fallback", ""))
    if p:
        try:
            draw_fill(c, p, 0, 0, W, H, bias=0.4)
        except Exception:
            pass
    else:
        plate(c, part["motif"], 0, 0, W, H)
    scrim(c, 0, 0, W, H, top=0.72, bottom=0.72, steps=2)
    c.setFillColor(Color(1, 1, 1, 0.55)); c.setFont(F["display"], 120)
    c.drawCentredString(W / 2, H / 2 + 40, part["number"])
    c.setStrokeColor(Color(0.82, 0.68, 0.34, 0.9)); c.setLineWidth(1.2)
    c.line(W / 2 - 60, H / 2 + 18, W / 2 + 60, H / 2 + 18)
    caps(c, part["title"], W / 2, H / 2 - 22, F["sansb"], 15, 5.0, Color(1, 1, 1, 0.96), center=True)
    caps(c, part["span"], W / 2, H / 2 - 48, F["sans"], 9.2, 3.0, Color(1, 1, 1, 0.75), center=True)
    c.setFont(F["serifi"], 11.4); c.setFillColor(Color(1, 1, 1, 0.86))
    y = H / 2 - 92
    for ln in wrap(c, part["blurb"], F["serifi"], 11.4, lambda k: 340):
        c.drawCentredString(W / 2, y, " ".join(ln)); y -= 16
    c.showPage()


def content_page(c, page, folio):
    """One story per page: picture, caption, headline, standfirst, two columns, facts."""
    page_bg(c)
    caps(c, page["era"].upper(), M, H - 60, F["sansb"], 8.2, 2.6, GOLD)
    lbl = content.PARTS[page["part"]]["title"]
    lw = c.stringWidth(lbl, F["sans"], 8.2) + 2.6 * (len(lbl) - 1)
    caps(c, lbl, W - M - lw, H - 60, F["sans"], 8.2, 2.6, MUTED)
    rule(c, M, H - 70, CW)

    have_photo = photo_path(page["slot"]) is not None
    cap_text = page["caption"] if have_photo else (
        "Drawn plate. No freely-licensed photograph was available for this page.")

    # ── measure everything before committing to a picture height
    t_size = 30.0
    while c.stringWidth(page["title"], F["display"], t_size) > CW and t_size > 16:
        t_size -= 1
    cap_lines = wrap(c, cap_text, F["serifi"], 7.9, lambda k: CW - 40)
    deck_lines = wrap(c, page["deck"], F["serifi"], 12.2, lambda k: CW - 30)
    facts_y = 104.0
    facts_top = facts_y + 34.0
    img_top = H - 84.0

    fixed = (13.0 + 10.2 * len(cap_lines)          # caption
             + t_size * 0.80 + 12.0                # headline
             + 16.0 + 20.0                         # gold rule + air
             + 16.4 * len(deck_lines) + 16.0)      # standfirst
    chosen = None
    for size_b in (10.0, 9.75, 9.5, 9.25, 9.0, 8.8, 8.6):
        leading = size_b * 1.42
        lines, indents = paragraphs_to_lines(c, page["body"], F["serif"], size_b, lambda k: COLW)
        per_col = (len(lines) + 1) // 2
        body_h = per_col * leading
        img_h = img_top - facts_top - fixed - body_h
        if img_h >= 214 or size_b == 8.6:
            chosen = (size_b, leading, lines, indents, per_col, body_h, min(img_h, 372.0))
            break
    size_b, leading, lines, indents, per_col, body_h, img_h = chosen
    if img_h < 214:
        print(f"  tight page: {page['slot']} (body {size_b}pt, picture {img_h:.0f}pt)")
    img_h = max(img_h, 200.0)
    img_y = img_top - img_h

    # ── picture + caption
    image_or_plate(c, page, M, img_y, CW, img_h)
    y = img_y - 13
    c.setFont(F["serifi"], 7.9); c.setFillColor(MUTED)
    for ln in cap_lines:
        c.drawString(M, y, " ".join(ln)); y -= 10.2

    # ── headline + standfirst
    y -= t_size * 0.80 + 12.0 - 10.2
    c.setFillColor(INK); c.setFont(F["display"], t_size)
    c.drawString(M, y, page["title"])
    y -= 16
    rule(c, M, y, 64, GOLD, 1.2)
    y -= 20
    c.setFillColor(HexColor("#3D372E")); c.setFont(F["serifi"], 12.2)
    for ln in deck_lines:
        c.drawString(M, y, " ".join(ln)); y -= 16.4

    # ── body, bottom-aligned onto the fact strip
    body_top = max(facts_top + body_h - leading * 0.25, y - 16.0)
    body_top = min(body_top, y - 16.0)
    split = min(per_col, len(lines))
    draw_justified(c, lines[:split], M, body_top, F["serif"], size_b, leading,
                   lambda k: COLW, first_index=0, indents=indents)
    draw_justified(c, lines[split:], M + COLW + GUT, body_top, F["serif"], size_b, leading,
                   lambda k: COLW, first_index=split, indents=indents)

    # ── fact strip
    rule(c, M, facts_y + 24, CW)
    slot_w = CW / 3
    for i, (value, label) in enumerate(page["facts"]):
        x = M + i * slot_w
        c.setFillColor(INK); c.setFont(F["display"], 12.4)
        c.drawString(x, facts_y + 6, value)
        caps(c, label.upper(), x, facts_y - 8, F["sans"], 7.0, 1.4, MUTED)
        if i:
            c.setStrokeColor(RULE); c.setLineWidth(0.5)
            c.line(x - 12, facts_y - 12, x - 12, facts_y + 16)

    c.setFont(F["serif"], 9); c.setFillColor(MUTED)
    c.drawCentredString(W / 2, 46, str(folio))
    c.showPage()


def credits_page(c, rows, folio):
    page_bg(c)
    caps(c, "PHOTOGRAPH CREDITS", M, H - 96, F["sansb"], 10, 3.2, GOLD)
    rule(c, M, H - 108, CW)
    c.setFont(F["serif"], 9.2); c.setFillColor(BODY)
    intro = ("Every photograph in this book comes from Wikimedia Commons and is used under the "
             "licence shown. Public-domain and CC0 images carry no conditions; CC BY and CC BY-SA "
             "images require the attribution printed here, and CC BY-SA additionally requires that "
             "any adapted version be shared under the same terms.")
    y = H - 130
    for ln in wrap(c, intro, F["serif"], 9.2, lambda k: CW):
        c.drawString(M, y, " ".join(ln)); y -= 12.4
    y -= 12
    slot_titles = {p["slot"]: p["title"] for p in content.PAGES}
    slot_titles["cover"] = "Cover"
    for pt in content.PARTS:
        slot_titles[pt["image"]] = f"Part {pt['number']} opener"
    for r in rows:
        if y < 90:
            c.setFont(F["serif"], 9); c.setFillColor(MUTED)
            c.drawCentredString(W / 2, 46, str(folio)); c.showPage()
            page_bg(c); folio += 1; y = H - 96
        page_name = slot_titles.get(r["slot"], r["slot"].title())
        c.setFillColor(INK); c.setFont(F["sansb"], 8.2)
        c.drawString(M, y, page_name)
        c.setFillColor(BODY); c.setFont(F["serif"], 8.4)
        author = re.sub(r"\s+", " ", r.get("author", "") or "unknown")
        author = re.sub(r"(?i)^(unknown( author)?|not credited|anonymous)\b.*$", "unknown author", author)
        author = re.sub(r"(?i)\s+talk$", "", author)[:90] or "unknown author"
        title = r["commons_title"].split(":", 1)[-1]
        line = f"{title} — {author} — {r['licence']} — via Wikimedia Commons"
        yy = y - 10.4
        for ln in wrap(c, line, F["serif"], 8.4, lambda k: CW - 10):
            c.drawString(M + 10, yy, " ".join(ln)); yy -= 10.2
        y = yy - 8
    c.setFont(F["serifi"], 8.6); c.setFillColor(MUTED)
    c.drawCentredString(W / 2, 76, "Built with reportlab · sources fetched by fetch_photos.py")
    c.setFont(F["serif"], 9)
    c.drawCentredString(W / 2, 46, str(folio))
    c.showPage()


def load_credits():
    path = os.path.join(PHOTOS, "credits.csv")
    if not os.path.exists(path):
        return []
    order = (["cover"] + [pt["image"] for pt in content.PARTS]
             + [p["slot"] for p in content.PAGES])
    with open(path, newline="", encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh) if photo_path(r["slot"])]
    return sorted(rows, key=lambda r: order.index(r["slot"]) if r["slot"] in order else 99)


def main():
    rows = load_credits()
    missing = [p["slot"] for p in content.PAGES if not photo_path(p["slot"])]
    note = (f"{len(missing)} page(s) use a drawn plate because no suitable photograph was found."
            if missing else "")
    folios, f, last = {}, 3, None
    for i, p in enumerate(content.PAGES):
        if p["part"] != last:
            f += 1; last = p["part"]          # part divider carries no folio
        f += 1
        folios[i] = f
    credits_folio = f + 1

    c = rlcanvas.Canvas(OUTPUT, pagesize=A4, pageCompression=1)
    c.setTitle(f"{content.TITLE} — {content.SUBTITLE}")
    c.setAuthor("Compiled with Claude Code")
    c.setSubject("An illustrated history of Egypt")
    cover(c)
    title_page(c, note)
    contents_page(c, content.PAGES, folios, credits_folio)
    last_part = None
    for i, page in enumerate(content.PAGES):
        if page["part"] != last_part:
            part_page(c, content.PARTS[page["part"]])
            last_part = page["part"]
        content_page(c, page, folios[i])
    credits_page(c, rows, credits_folio)
    c.save()
    print(f"wrote {OUTPUT}  ({os.path.getsize(OUTPUT)/1e6:.1f} MB)")
    if missing:
        print("drawn plates used for:", ", ".join(missing))


if __name__ == "__main__":
    main()
