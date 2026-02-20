# 🔐 GitHub Secrets Setup for Auto-Deploy

## Quick Setup (5 minutes)

### Step 1: Get Vercel Token

1. Go to https://vercel.com/account/tokens
2. Click **"Create Token"**
3. Name it: `GitHub Actions`
4. Copy the token (starts with `vercel_...`)

### Step 2: Get Vercel Project IDs

```bash
# Install Vercel CLI (if not installed)
npm i -g vercel

# Link your project
vercel link

# View your project IDs
cat .vercel/project.json
```

You'll see:
```json
{
  "orgId": "team_xxxxxxxxxxxxx",
  "projectId": "prj_xxxxxxxxxxxxx"
}
```

### Step 3: Add to GitHub Secrets

1. Go to your GitHub repo
2. Click **Settings → Secrets and variables → Actions**
3. Click **"New repository secret"**
4. Add these 4 secrets:

| Secret Name | Value | Example |
|------------|-------|---------|
| `VERCEL_TOKEN` | Your Vercel token | `vercel_xxxxxxxxxxxxx` |
| `VERCEL_ORG_ID` | From `.vercel/project.json` | `team_xxxxxxxxxxxxx` |
| `VERCEL_PROJECT_ID` | From `.vercel/project.json` | `prj_xxxxxxxxxxxxx` |
| `CLAUDE_API_KEY` | Your Claude API key | `sk-ant-api03-xxxxx` |

### Step 4: Verify Setup

```bash
# Push to trigger auto-deploy
git push origin main

# Check GitHub Actions
# Go to: Actions tab in GitHub
```

---

## ✅ Done!

Your site will now auto-deploy on every push! 🎉

---

## 🔍 Verify It Works

### Check GitHub Actions

1. Go to **Actions** tab in GitHub
2. You should see workflows running
3. Wait for green checkmarks ✅

### Check Vercel

1. Go to https://vercel.com
2. Find your project
3. See new deployment

---

## 🚨 Troubleshooting

### "Vercel token invalid"
→ Create new token at https://vercel.com/account/tokens  
→ Update `VERCEL_TOKEN` in GitHub Secrets

### "Project not found"
→ Run `vercel link` locally  
→ Copy IDs from `.vercel/project.json`  
→ Update GitHub Secrets

### "Tests failing"
→ Run `npm test` locally first  
→ Fix failing tests  
→ Push again

### "No permission to deploy"
→ Check you're repo owner/admin  
→ Check Vercel token has deploy permissions

---

## 📋 Summary

After setup, every push will:

1. ✅ Run tests (40 tests)
2. ✅ Build project
3. ✅ Deploy to Vercel
4. ✅ Update live site

**No manual deployment needed!** 🚀

---

## 🔐 Security Notes

- Never commit secrets to git
- Use GitHub Secrets for all sensitive data
- Rotate tokens regularly
- Use read-only tokens when possible

---

**Need help?** See `README.md` or `DEPLOY.md`
