# 🎯 thinx.fun - Mobile Screenshot Intelligence

AI-powered screenshot analysis with Claude, optimized for mobile.

[![🚀 Deploy](https://github.com/asamaka/engzny/workflows/Deploy%20to%20Vercel/badge.svg)](https://github.com/asamaka/engzny/actions)
[![🧪 Tests](https://github.com/asamaka/engzny/workflows/Tests/badge.svg)](https://github.com/asamaka/engzny/actions)

---

## ⚡ Quick Start

### 🚀 Auto-Deploy (Easiest!)

**Just push to GitHub - it auto-deploys!**

```bash
git push origin main
```

GitHub Actions will:
- ✅ Run all tests
- ✅ Deploy to Vercel
- ✅ Update your live site

**First time?** See [Setup](#-setup) below.

---

## 📱 What It Does

Mobile-first screenshot analyzer powered by Claude AI:

1. **Take a screenshot** on your phone
2. **Open** your site
3. **Tap to paste**
4. **Watch** Claude analyze it in real-time

### Features
- ✅ **Tap to paste** - One-tap clipboard access
- ✅ **Sci-fi scanner** - Cool animation while analyzing
- ✅ **Real-time streaming** - See Claude think
- ✅ **Auto-scroll** - Smart scrolling with manual control
- ✅ **Mobile-optimized** - Perfect for phones
- ✨ **Dynamic Layouts** - LLM-chosen layout types (editorial, dashboard, product, social, investigation)
- 🎯 **Parallel Research** - Multiple LLMs research different cards simultaneously
- 📊 **13 Card Types** - hero, metric, fact-check, person, product, timeline, quote, comparison, warning, action, list, extract, location
- 🔄 **Progressive Loading** - Cards appear as placeholders, animate in as research completes

---

## 🏗️ Architecture: Multi-Agent Pipeline

```
Screenshot
    |
    v
[Layout Designer LLM] ─── Vision analysis
    |                      - Content type detection
    |                      - Intent identification
    |                      - Best layout selection
    |                      - Placeholder card blueprint
    v
[SSE: blueprint] ─── Client renders placeholder cards immediately
    |
    v
[Card Researcher LLMs] ─── Run in PARALLEL (one per card)
    |   |   |   |           - Each follows card type contract
    |   |   |   |           - Populates card with researched data
    v   v   v   v
[SSE: card events] ─── Each card animates in as it completes
    |
    v
[Complete] ─── All cards populated
```

### Agent Specifications

This project uses specialized Claude Code agents with clear responsibilities:

| Agent | Spec | Responsibility |
|-------|------|---------------|
| **Deployment Agent** | [`.claude/agents/deployment.md`](.claude/agents/deployment.md) | SOLE agent for production pushes. Runs tests, pushes, monitors deploys, handles failures. |
| **Feature Development Agent** | [`.claude/agents/feature-development.md`](.claude/agents/feature-development.md) | Implements features and fixes. Does NOT deploy. |
| **Research Agent** | [`.claude/agents/research.md`](.claude/agents/research.md) | Investigates issues, debugs failures, analyzes code. Does NOT modify or deploy. |

See [`CLAUDE.md`](CLAUDE.md) for the full agent routing document and architecture overview.

---

## 🛠️ Setup

### 1. Fork & Clone

```bash
git clone https://github.com/YOUR_USERNAME/engzny.git
cd engzny
```

### 2. Add GitHub Secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Description | How to Get |
|--------|-------------|------------|
| `VERCEL_TOKEN` | Vercel deployment token | [Create token](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | Your Vercel org ID | Run `vercel` locally, copy from `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | Your project ID | Run `vercel` locally, copy from `.vercel/project.json` |
| `CLAUDE_API_KEY` | Claude API key (for tests) | [Get key](https://console.anthropic.com/settings/keys) |

#### Quick Setup:

```bash
# Install Vercel CLI
npm i -g vercel

# Link your project (creates .vercel/project.json)
vercel link

# Copy IDs from .vercel/project.json to GitHub Secrets
cat .vercel/project.json
```

### 3. Add Vercel Environment Variable

In **Vercel Dashboard → Settings → Environment Variables**:

```
ANTHROPIC_API_KEY = sk-ant-api03-your-key-here
```

Get your key: https://console.anthropic.com/settings/keys

### 4. Push to Deploy

```bash
git push origin main
```

**That's it!** 🎉 Your site auto-deploys on every push!

---

## 🎯 Usage

### Live Site

After deployment:
```
https://your-project.vercel.app
```

### Local Development

```bash
# Install dependencies
npm install

# Add API key
echo "ANTHROPIC_API_KEY=sk-ant-api03-your-key" >> .env

# Start server
npm start

# Visit http://localhost:3000
```

### Run Tests

```bash
# All tests (52 tests)
npm test

# Health check only (real API calls)
npm run test:health

# Unit tests only (mocked, fast)
npm run test:unit

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

---

## 🔍 Keypoints Feature

The keypoints extraction feature provides structured, card-based insights from your screenshots.

### How It Works

1. **Upload a screenshot** via the paste interface
2. **Wait for analysis** to complete
3. **Click "View Keypoints"** button
4. **Explore insights** organized into trails:
   - 👥 **People** - Names, profiles, @handles
   - 📅 **Events** - What happened, when, where
   - 📊 **Facts** - Statistics, data, claims to verify
   - 🛍️ **Products** - Items, prices, features
   - 📍 **Locations** - Places, addresses, maps
   - ⏰ **Dates** - Timelines, schedules
   - 💬 **Context** - Background information
   - ✓ **Claims** - Statements to fact-check

### Card-Based Navigation

Each keypoint shows:
- **Question** - The obvious question you'd ask ("Who is this?", "What's this product?")
- **Quick Answer** - Immediate response based on visible info
- **Deep Dive** - Follow-up questions for exploration
- **Priority** - How important this keypoint is
- **Verification Badge** - If it needs fact-checking

### API Endpoint

```bash
POST /api/keypoints
Content-Type: application/json

{
  "image": "data:image/png;base64,..."
}
```

Response:
```json
{
  "overview": {
    "mainTopic": "What this screenshot is about",
    "immediateAnswer": "Quick summary"
  },
  "keypoints": [
    {
      "title": "Keypoint title",
      "obviousQuestion": "What is this?",
      "quickAnswer": "This is...",
      "trail": "people",
      "priority": "high"
    }
  ],
  "trails": {
    "people": { "count": 2, "keypointIds": [...] }
  }
}
```

---

## 📁 Project Structure

```
├── api/
│   ├── index.js                  # Express server + all API routes
│   ├── agents/
│   │   ├── orchestrator-v2.js    # Pipeline coordinator
│   │   ├── layout-designer.js    # Vision LLM: designs card layouts
│   │   └── card-researcher.js    # Research LLM: populates cards in parallel
│   ├── contracts/
│   │   └── card-types.js         # Card type schemas + layout definitions
│   ├── generators/
│   │   ├── vision-analyzer.js    # Screenshot hotspot detection
│   │   ├── canvas-generator.js   # GIUE canvas generation
│   │   ├── keypoint-extractor.js # Structured keypoint extraction
│   │   └── style-manager.js      # Theme/color extraction
│   └── llm/
│       ├── adapter.js            # Base LLM interface
│       ├── claude.js             # Claude adapter (claude-opus-4-6)
│       ├── gemini.js             # Gemini adapter (fallback)
│       └── index.js              # Provider factory
├── public/
│   ├── hub-v2.html               # Main page (served at /)
│   └── keypoints.html            # Keypoint card navigation
├── tests/
│   ├── unit/                     # 49 unit tests (mocked)
│   └── integration/              # 3 health checks (real API)
├── .claude/
│   └── agents/
│       ├── deployment.md         # Deployment Agent spec
│       ├── feature-development.md # Feature Dev Agent spec
│       └── research.md           # Research Agent spec
├── CLAUDE.md                     # Agent routing + architecture overview
├── .github/workflows/
│   ├── deploy.yml                # CI/CD deploy to Vercel
│   ├── auto-deploy-production.yml # Auto-deploy on claude/* push
│   └── tests.yml                 # Test runner
├── vercel.json                   # Vercel configuration
└── package.json                  # Dependencies & scripts
```

---

## 🚀 Deployment

### Auto-Deploy (GitHub Actions)

**Automatic deployment on:**
- ✅ Push to `main` → Production
- ✅ Push to `develop` → Production
- ✅ Push to `claude/**` → Production
- ✅ Pull requests → Preview deployment

### Manual Deploy

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

### Deployment Flow

1. **Push code** → GitHub
2. **GitHub Actions** runs tests
3. **Tests pass** → Deploy to Vercel
4. **Live!** → https://your-project.vercel.app

---

## 🧪 Testing

### Test Suite

- **52 tests total**
  - 49 unit tests (API validation, LLM adapters, keypoint extraction)
  - 3 health checks (real API calls)

### CI/CD

- ✅ Runs on every push
- ✅ Runs on every PR
- ✅ Must pass before deploy

### Health Checks

```bash
npm run test:health
```

Verifies:
- ✅ Claude API token is valid
- ✅ Vision API working
- ✅ Streaming functional

---

## 💰 Cost

### Vercel
- **Free** for personal projects
- Unlimited deployments
- 100GB bandwidth/month

### Claude API
- **~$0.003 per screenshot**
- 10 daily: ~$1/month
- 100 daily: ~$9/month

**Total:** Basically free for personal use! 🎉

---

## 🎨 Features

### Mobile Interface
- One-tap clipboard paste
- Touch-optimized UI
- Responsive design
- Sci-fi scanning animation

### AI Analysis
- Claude Opus 4.6 (latest)
- Vision + text analysis
- Real-time streaming
- Multi-agent parallel research
- 13 card types with typed contracts
- 6 layout types (LLM-selected)

### Developer Experience
- Auto-deploy on push to `claude/*` branches
- Preview deployments for PRs
- Test suite (52 tests)
- Agent specifications for clear task delegation

---

## 📚 Documentation

- **[CLAUDE.md](CLAUDE.md)** - Agent routing + architecture overview
- **[.claude/agents/deployment.md](.claude/agents/deployment.md)** - Deployment Agent spec
- **[.claude/agents/feature-development.md](.claude/agents/feature-development.md)** - Feature Dev Agent spec
- **[.claude/agents/research.md](.claude/agents/research.md)** - Research Agent spec
- **[QUICKSTART.md](QUICKSTART.md)** - 2-minute deploy guide
- **[DEPLOY.md](DEPLOY.md)** - Full deployment docs
- **[TESTING_SUMMARY.md](TESTING_SUMMARY.md)** - Test documentation

---

## 🔧 Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | ✅ Yes | Claude API key |
| `PORT` | ❌ No | Server port (default: 3000) |
| `UPSTASH_REDIS_REST_URL` | ❌ No | Redis URL (optional) |
| `UPSTASH_REDIS_REST_TOKEN` | ❌ No | Redis token (optional) |

### Vercel Configuration

`vercel.json`:
```json
{
  "routes": [
    { "src": "/", "dest": "/public/paste.html" },
    { "src": "/api/(.*)", "dest": "api/index.js" },
    { "src": "/(.*)", "dest": "api/index.js" }
  ]
}
```

---

## 🚨 Troubleshooting

### Deployment Issues

**"Vercel token not found"**
→ Add `VERCEL_TOKEN` in GitHub Secrets

**"Tests failing"**
→ Check test logs in GitHub Actions
→ Run `npm test` locally

**"API key not found"**
→ Add `ANTHROPIC_API_KEY` in Vercel dashboard

### Runtime Issues

**"Cannot read clipboard"**
→ Grant clipboard permissions in browser

**"Upload failed"**
→ Check image size (max 20MB)

**"Stream connection lost"**
→ Refresh the page

---

## 🤝 Contributing

1. Fork the repo
2. Create your feature branch
3. Make your changes
4. Push to your fork
5. Create a Pull Request

**GitHub Actions will:**
- Run all tests
- Deploy preview
- Comment preview URL on PR

---

## 📄 License

MIT License - see LICENSE file

---

## 🌟 Show Your Support

Give a ⭐️ if this project helped you!

---

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/asamaka/engzny/issues)
- **Docs:** See `DEPLOY.md` for full documentation

---

**Made with ❤️ using Claude AI**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/asamaka/engzny)
