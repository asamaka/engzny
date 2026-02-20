# 🚀 Deploy thinx.fun to Vercel

## Quick Deploy (5 minutes)

### 1. **Push to GitHub**
```bash
git add -A
git commit -m "Ready for deployment"  
git push origin main
```

### 2. **Deploy to Vercel**

#### Option A: Vercel CLI (Fastest)
```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel
```

#### Option B: Vercel Dashboard
1. Go to [vercel.com](https://vercel.com)
2. Click **"New Project"**
3. Import your GitHub repo
4. Click **"Deploy"**

### 3. **Add Environment Variable**

In Vercel Dashboard → Settings → Environment Variables:

```
ANTHROPIC_API_KEY = sk-ant-api03-your-actual-key-here
```

**Get API key:** https://console.anthropic.com/settings/keys

### 4. **Redeploy**
Deployments → Click 3 dots → **"Redeploy"**

---

## ✅ Done!

Your mobile paste page is live at:
```
https://your-project.vercel.app
```

---

## 📱 How to Use

1. Take a screenshot on your phone
2. Open your deployed URL
3. Tap the paste zone
4. Watch Claude analyze it!

---

## 🧪 Test Locally First

```bash
# Add API key to .env
echo "ANTHROPIC_API_KEY=sk-ant-api03-your-key" >> .env

# Start server
npm start

# Test health check
npm run test:health
```

---

## 💰 Cost

- **Vercel:** Free for personal projects
- **Claude API:** ~$0.003 per screenshot (~$9/month for 100 daily analyses)

---

## 🚨 Troubleshooting

**"API key not found"**  
→ Add `ANTHROPIC_API_KEY` in Vercel and redeploy

**"Cannot read clipboard"**  
→ Grant clipboard permissions in browser

**"Stream connection lost"**  
→ Refresh the page

---

**Ready?** Run `vercel` now! 🚀
