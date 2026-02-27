# Screenshot Test Dataset

Test dataset of publicly available mobile phone screenshots for exercising the thinx.fun analysis pipeline.

## Quick Start

```bash
# Fetch the dataset (downloads ~50 screenshots from Wikimedia Commons)
node scripts/fetch-screenshot-dataset.js --verbose

# Fetch a smaller set for quick testing
node scripts/fetch-screenshot-dataset.js --limit 3 --verbose

# Only download curated, hand-picked URLs
node scripts/fetch-screenshot-dataset.js --curated-only --verbose

# Preview what would be downloaded without downloading
node scripts/fetch-screenshot-dataset.js --dry-run

# Fetch specific categories only
node scripts/fetch-screenshot-dataset.js --categories ios,android --limit 5
```

## Categories

| Category    | Description                                |
|-------------|--------------------------------------------|
| `ios`       | iOS device screenshots                     |
| `android`   | Android device screenshots                 |
| `settings`  | Phone settings/system UI                   |
| `social`    | Social media apps (Twitter, Instagram, etc)|
| `messaging` | Messaging apps (Signal, WhatsApp, etc)     |
| `maps`      | Map/navigation apps                        |
| `misc`      | Miscellaneous mobile screenshots           |

## Sources

All images are sourced from publicly licensed content:

- **Wikimedia Commons** — Creative Commons licensed screenshots from various mobile app and device categories
- **Curated URLs** — Hand-picked, freely licensed screenshots from public forums and wikis

## Dataset Structure

```
tests/dataset/
├── manifest.json         # Full metadata for all images
├── README.md             # This file
└── screenshots/
    ├── ios/
    ├── android/
    ├── settings/
    ├── social/
    ├── messaging/
    ├── maps/
    └── misc/
```

## Manifest Format

`manifest.json` contains metadata for every downloaded image:

```json
{
  "name": "thinx-screenshot-test-dataset",
  "version": "1.0.0",
  "totalImages": 42,
  "categories": { "ios": { "count": 8, "totalSize": 1234567 } },
  "images": [
    {
      "filename": "example.png",
      "category": "ios",
      "path": "screenshots/ios/example.png",
      "url": "https://...",
      "source": "Wikimedia Commons",
      "license": "CC BY-SA 4.0",
      "width": 640,
      "height": 1136,
      "format": "png",
      "fileSize": 102400,
      "hash": "a1b2c3d4e5f6..."
    }
  ]
}
```

## Notes

- Downloaded images are excluded from git (see `.gitignore`)
- The `manifest.json` is committed so CI can verify dataset structure
- Max file size per image: 5 MB
- Images are downloaded at 640px width (thumbnails from Wikimedia)
- Rate-limited to ~1 request/second to respect API guidelines
