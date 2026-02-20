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
# All tests (40 tests)
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

## 📁 Project Structure

```
├── api/
│   ├── index.js           # Express server + API endpoints
│   └── llm/               # LLM adapters (Claude, Gemini)
├── public/
│   ├── paste.html         # Mobile paste interface (home)
│   ├── index.html         # Desktop version
│   └── analyze.html       # Analysis page
├── tests/
│   ├── unit/              # Unit tests (37 tests)
│   └── integration/       # API health checks (3 tests)
├── .github/
│   └── workflows/
│       ├── deploy.yml     # Auto-deploy to Vercel
│       └── tests.yml      # Run tests on push
├── vercel.json            # Vercel configuration
└── package.json           # Dependencies & scripts
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

- **40 tests total**
  - 37 unit tests (API validation, LLM adapters)
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
- Claude Sonnet 4.5 (latest)
- Vision + text analysis
- Real-time streaming
- Markdown formatting

### Developer Experience
- Auto-deploy on push
- Preview deployments for PRs
- Test suite (40 tests)
- Type checking
- Linting

---

## 📚 Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - 2-minute deploy guide
- **[DEPLOY.md](DEPLOY.md)** - Full deployment docs
- **[READY_TO_DEPLOY.md](READY_TO_DEPLOY.md)** - Pre-deployment checklist
- **[TESTING_SUMMARY.md](TESTING_SUMMARY.md)** - Test documentation
- **[HEALTH_CHECK.md](HEALTH_CHECK.md)** - API health checks

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
