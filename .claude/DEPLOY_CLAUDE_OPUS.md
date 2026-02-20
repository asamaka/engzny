# 🚀 Deploy Claude Opus 4.6 to Production

## Current Status

✅ **Code Changes Complete** - All code updated to use Claude Opus 4.6
✅ **Workflow Added** - Automated secret sync workflow created
✅ **Branch Pushed** - Changes on `claude/summarize-project-8RBlP`
⏳ **Pending** - Merge to main and deployment

## What Was Changed

### 1. **API Adapter** (`api/llm/claude.js`)
- Changed default model from `claude-sonnet-4-20250514` to `claude-opus-4-6`

### 2. **Analyze Endpoint** (`api/index.js`)
- Replaced `GeminiAdapter` with `ClaudeAdapter`
- Updated API key check from `GEMINI_API_KEY` to `ANTHROPIC_API_KEY`
- Updated all error messages and hints

### 3. **Frontend** (`public/analyze.html`)
- Updated error message to reference `ANTHROPIC_API_KEY`

### 4. **Secret Sync Workflow** (`.github/workflows/sync-secrets.yml`)
- Automatically syncs `CLAUDE_API_KEY` (GitHub) → `ANTHROPIC_API_KEY` (Vercel)
- Triggers on:
  - Manual workflow dispatch
  - Push to main branch
- Adds environment variable to all Vercel environments (production, preview, development)

## 🎯 Next Steps to Deploy

### Option 1: Create Pull Request (Recommended)

1. **Go to GitHub**:
   ```
   https://github.com/asamaka/engzny/compare/main...claude/summarize-project-8RBlP
   ```

2. **Create PR with this info**:
   - Title: `🚀 Switch analyze feature to Claude Opus 4.6`
   - Description: See `.claude/DEPLOY_CLAUDE_OPUS.md` for details

3. **Merge the PR**
   - This will automatically:
     - Run tests
     - Trigger secret sync workflow
     - Deploy to Vercel
     - Add `ANTHROPIC_API_KEY` to Vercel

4. **Verify deployment**:
   - Check GitHub Actions: https://github.com/asamaka/engzny/actions
   - Look for "🔐 Sync Secrets to Vercel" workflow
   - Verify it completed successfully

### Option 2: Manual Deployment

If automated workflow fails, manually add environment variable:

1. **Go to Vercel Dashboard**:
   ```
   https://vercel.com/asamaka/engzny/settings/environment-variables
   ```

2. **Add new environment variable**:
   - **Name**: `ANTHROPIC_API_KEY`
   - **Value**: [Same as `CLAUDE_API_KEY` from GitHub secrets]
   - **Environments**: ✅ Production, ✅ Preview, ✅ Development

3. **Get the API key value**:
   - Go to: https://github.com/asamaka/engzny/settings/secrets/actions
   - Find `CLAUDE_API_KEY`
   - Copy its value (or get from: https://console.anthropic.com/settings/keys)

4. **Redeploy**:
   ```bash
   # Via Vercel dashboard
   Go to Deployments → Click "Redeploy" on latest

   # OR via CLI
   vercel --prod
   ```

## 🔍 Verification Steps

Once deployed, test the analyze feature:

1. **Visit**: https://thinx.fun/
2. **Upload an image** or use the analyze button
3. **Check that**:
   - ✅ No error about "GEMINI_API_KEY"
   - ✅ Analysis works
   - ✅ Uses Claude Opus 4.6 (check network tab for model)

## 📊 GitHub Secrets Mapping

| GitHub Secret | Environment Variable | Used In |
|--------------|---------------------|---------|
| `CLAUDE_API_KEY` | `ANTHROPIC_API_KEY` | Vercel, GitHub Actions |
| `VERCEL_TOKEN` | - | Deployment workflow |
| `VERCEL_PROJECT_ID` | - | Deployment workflow |
| `VERCEL_ORG_ID` | - | Deployment workflow |

## ⚠️ Troubleshooting

### Issue: "ANTHROPIC_API_KEY not configured"

**Solution**:
1. Check Vercel environment variables are set
2. Redeploy after adding environment variable
3. Check GitHub Actions logs for workflow errors

### Issue: "API key not valid"

**Solution**:
1. Verify API key value is correct
2. Check key at: https://console.anthropic.com/settings/keys
3. Update both GitHub secret and Vercel environment variable

### Issue: Workflow doesn't run

**Solution**:
1. Manually trigger: https://github.com/asamaka/engzny/actions/workflows/sync-secrets.yml
2. Click "Run workflow" → Select "main" branch → Run
3. Check workflow logs for errors

## 📝 Files Changed

```
api/llm/claude.js              ← Model changed to claude-opus-4-6
api/index.js                   ← Gemini → Claude, API key updates
public/analyze.html            ← Error message updated
.github/workflows/sync-secrets.yml  ← NEW: Automated secret sync
```

## 🎯 Expected Outcome

After deployment:
- ✅ Analyze feature uses Claude Opus 4.6
- ✅ No more "GEMINI_API_KEY" errors
- ✅ Better image analysis quality
- ✅ Same API key used for tests and production

---

**Created**: 2026-02-20
**Branch**: `claude/summarize-project-8RBlP`
**Session**: https://claude.ai/code/session_01WifA1TU4H8uVqZpFToKKwZ
