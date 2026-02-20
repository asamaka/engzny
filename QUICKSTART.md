# ⚡ Quick Start - Deploy in 2 Minutes!

## 🚀 Fastest Way to Deploy

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Deploy (it will ask you to login)
vercel

# 3. Add your Claude API key in Vercel dashboard
# Settings → Environment Variables → Add:
# ANTHROPIC_API_KEY = sk-ant-api03-your-key

# 4. Redeploy
vercel --prod
```

**Done!** Your mobile paste page is live! 🎉

---

## 📱 What You Get

A mobile-first screenshot analyzer:
- ✅ Tap to paste from clipboard
- ✅ Real-time Claude AI analysis
- ✅ Sci-fi scanning animation
- ✅ Streaming results

---

## 🔑 Get Your API Key

1. Go to https://console.anthropic.com/settings/keys
2. Create a new key
3. Copy it (starts with `sk-ant-api03-`)
4. Add to Vercel environment variables

---

## 💡 Test Locally First?

```bash
# Add API key to .env
echo "ANTHROPIC_API_KEY=sk-ant-api03-your-key" > .env

# Start server
npm start

# Visit http://localhost:3000
```

---

## 📋 Full Deployment Guide

See `DEPLOY.md` for detailed instructions.

---

**Questions?** Check `DEPLOY.md` troubleshooting section!
