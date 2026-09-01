# EGYPT — Five Thousand Years on the Nile

A 26-page A4 photo book: ten pages on ancient Egypt, ten on the modern nation,
built from freely-licensed photographs on Wikimedia Commons.

```bash
pip install reportlab pillow requests
python3 fetch_photos.py     # downloads photos/ + writes photos/credits.csv
python3 egypt_book.py       # writes Egypt-Five-Thousand-Years-on-the-Nile.pdf
```

## How it fits together

| File | Role |
|------|------|
| `content.py` | All the text: parts, page copy, captions, fact strips. Edit here. |
| `fetch_photos.py` | Slot → Commons file. Accepts only public domain / CC0 / CC BY / CC BY-SA, rejects anything under 700 px, records licence + author in `photos/credits.csv`. |
| `egypt_book.py` | Lays out the PDF with reportlab. |

Each page owns one image *slot* (`photos/<slot>.jpg`). Drop your own file in
with the right slot name and it is used as-is — that is how to replace a fetched
photograph, or fill a slot the fetcher could not. Any slot with no file falls
back to a drawn plate, so the book always builds.

Images are cropped to fill their frame, downsampled to 200 dpi and re-encoded as
JPEG, which keeps the finished PDF a few megabytes rather than fifty. The final
page prints the credits from `credits.csv` — CC BY and CC BY-SA require that
attribution in print.

## Notes on fetching

Wikimedia throttles shared egress IPs hard (HTTP 429), so `fetch_photos.py`
paces itself: one request every 12 seconds, with long backoff. A full run takes
a while. It is resumable — slots already present in `photos/` are skipped, so
just run it again to fill whatever failed.
