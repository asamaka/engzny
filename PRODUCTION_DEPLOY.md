# 🚀 Production Deployment Guide

Complete guide for deploying features to thinx.fun via Vercel auto-deployment.

## Quick Deploy to Production

### For AI Agents:

**Current Limitation:** AI agents can only push to `claude/*` branches. Main branch requires human approval for safety.

**Deployment Steps:**

1. **Develop on feature branch** ✅ (Already done for keypoint extraction)
2. **Push to claude/* branch** ✅ (Triggers preview deployment)
3. **Request human merge to main** ⏳ (You are here)

### For Humans:

**Complete the deployment in 3 simple steps:**

```bash
# Option 1: Via GitHub Web (Easiest)
# Go to: https://github.com/asamaka/engzny/compare/main...claude/summarize-project-8RBlP
# Click: Create PR → Merge PR

# Option 2: Via Command Line
git checkout main
git pull origin main
git merge claude/summarize-project-8RBlP
git push origin main
```

## Automated Deployment Pipeline

When code is pushed to `main`:

```
Push to main
    ↓
GitHub Actions: tests.yml
    ├─ Run 52 tests (including 12 new keypoint tests)
    ├─ Test on Node 18 & 20
    └─ Generate coverage report
    ↓
GitHub Actions: deploy.yml
    ├─ Build for production
    ├─ Deploy to Vercel
    └─ Update thinx.fun
    ↓
Live on thinx.fun (2-3 minutes total)
```

## Validation After Deployment

Use these commands to verify the deployment:

```bash
# 1. Health check
curl -s "https://thinx.fun/api/health?cache=$(date +%s)"

# 2. New keypoints endpoint (expects 400 without image - that's correct)
curl -s -X POST "https://thinx.fun/api/keypoints?cache=$(date +%s)" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

# 3. Keypoints UI page
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  "https://thinx.fun/keypoints.html?cache=$(date +%s)"

# 4. Verify paste.html integration
curl -s "https://thinx.fun/paste.html?cache=$(date +%s)" | \
  grep -o "keypointsBtn" | wc -l
```

Expected results:
- Health check: `{"status":"ok","timestamp":"..."}`
- Keypoints endpoint: `{"error":"No image provided"}`
- Keypoints UI: `HTTP 200`
- Paste integration: `> 0` (button code found)

## Current Feature: Keypoint Extraction

**Status:**
- ✅ Code: Committed to `claude/summarize-project-8RBlP`
- ✅ Tests: 12/12 passing
- ✅ Push: Synced to remote
- ⏳ Preview: Available on Vercel (check Actions tab)
- ❌ Production: Awaiting merge to `main`

**Files Changed:**
- Created: `api/generators/keypoint-extractor.js` (550 lines)
- Created: `public/keypoints.html` (600 lines)
- Created: `tests/unit/keypoint-extractor.test.js` (112 lines)
- Modified: `api/index.js`, `public/paste.html`, `README.md`

**To Deploy Now:**

1. Visit: https://github.com/asamaka/engzny/compare/main...claude/summarize-project-8RBlP
2. Click "Create pull request"
3. Review changes
4. Click "Merge pull request"
5. Wait 2-3 minutes for auto-deployment
6. Visit https://thinx.fun and test the keypoints feature!

## Deployment Verification Checklist

After merging to main, verify:

- [ ] GitHub Actions workflows completed successfully
- [ ] Vercel deployment shows success
- [ ] `https://thinx.fun/api/health` responds
- [ ] `https://thinx.fun/keypoints.html` loads (200 status)
- [ ] Paste page has "View Keypoints" button
- [ ] Keypoints API endpoint exists (returns 400 without image)
- [ ] Full flow works: Upload screenshot → Analyze → View Keypoints

## Notes

- **Cache busting:** Always append `?cache=$(date +%s)` to URLs when testing
- **Preview deployments:** Every push to `claude/*` creates a preview
- **Main deployments:** Only merges to `main` update thinx.fun
- **Rollback:** Revert the merge commit and push to restore previous version
