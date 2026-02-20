# Incident Report: 404 Errors and Vercel Routing Issues

**Date:** February 20, 2026
**Duration:** ~2 hours
**Severity:** High (Production site inaccessible)
**Status:** Resolved

## Executive Summary

Production deployment (thinx.fun) experienced a series of routing failures after merging keypoint extraction feature (PR #10). Root path and static pages returned 404 errors due to misconfigured Vercel routing and Express route handlers.

**Impact:**
- Root path (`/`) returned 404
- All static HTML pages (`/analyze.html`, `/keypoints.html`, etc.) became inaccessible
- User workflows broken (analyze feature, keypoints feature)

**Root Cause:**
1. Express served non-existent `index.html` instead of `paste.html` at root
2. Vercel routing configuration conflicted with Express static file serving
3. Incorrect route priority in `vercel.json` caused all requests to be handled by Express instead of serving static files directly

---

## Timeline of Events

### Incident Start
**21:40 UTC** - User reports 404 error on root path after successful deployment of keypoint extraction feature

### Issue #1: Root Path 404
**Problem:** Root path (`/`) returns 404
**Diagnosis:** Express route at line 294 of `api/index.js` serves `index.html` which doesn't exist

```javascript
// BEFORE (broken)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// AFTER (fixed)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'paste.html'));
});
```

**Fix:** PR #11 - Changed Express route to serve `paste.html`
**Result:** Root path still returned 404 due to Vercel routing issue

### Issue #2: Vercel Routing Conflict
**21:48 UTC** - PR #11 merged, but issue persists

**Problem:** Vercel `vercel.json` had conflicting route trying to serve `/public/paste.html` as static file

```json
// BROKEN ROUTE
{
  "src": "/",
  "dest": "/public/paste.html"  // This path doesn't exist in Vercel's output
}
```

**Diagnosis:**
- Vercel doesn't serve files from `/public/` subdirectory by default
- Route tried to serve non-existent path
- Catch-all route `/(.*)" → api/index.js` was meant to handle all other requests

**Fix:** PR #12 - Removed conflicting root route
**Result:** Fix deployed but new issue emerged

### Issue #3: All HTML Files Return 307 Redirects
**21:59 UTC** - User reports analyze.html and all static pages broken

**Problem:** After removing the root route, ALL HTML files returned HTTP 307 (Temporary Redirect)

**Diagnosis:**
- Simplified routing sent all requests to Express via catch-all route
- Express static middleware didn't serve files correctly in Vercel
- No static file builder configured in `vercel.json`

**Fix Attempt #1 (PR #13):**
```json
// Added static builder and regex routing
{
  "builds": [
    {"src": "api/index.js", "use": "@vercel/node"},
    {"src": "public/**", "use": "@vercel/static"}
  ],
  "routes": [
    {"src": "/api/(.*)", "dest": "api/index.js"},
    {"src": "/(.*\\.(html|css|js|png|jpg|jpeg|gif|svg|ico|json))", "dest": "/public/$1"},
    {"src": "/(.*)", "dest": "api/index.js"}
  ]
}
```

**Result:** Still failed - capture group `$1` didn't work as expected

### Issue #4: Complex Regex Routing Failed
**22:15 UTC** - User still reports errors accessing analyze.html

**Problem:** Complex regex route with capture groups didn't map files correctly

**Final Fix (PR #14):**
Simplified to standard Vercel pattern - let `@vercel/static` builder handle file serving automatically

```json
{
  "version": 2,
  "builds": [
    {"src": "public/**", "use": "@vercel/static"},  // Build static first
    {"src": "api/index.js", "use": "@vercel/node"}
  ],
  "routes": [
    {"src": "/api/(.*)", "dest": "/api/index.js"},  // API routes
    {"src": "/(.*)", "dest": "/api/index.js"}       // Dynamic routes
  ]
}
```

**Result:** ✅ All pages working correctly

---

## Root Causes

### 1. **Incorrect Express Route Configuration**
- **File:** `api/index.js` line 294
- **Issue:** Served non-existent file
- **Why it happened:** File was renamed/removed but route not updated

### 2. **Misunderstanding of Vercel Static File Serving**
- **File:** `vercel.json`
- **Issue:** Tried to manually route to static files instead of using Vercel's built-in static file serving
- **Why it happened:** Lack of understanding of Vercel's `@vercel/static` builder behavior

### 3. **Route Priority Issues**
- **File:** `vercel.json`
- **Issue:** Catch-all routes overriding static file serving
- **Why it happened:** Incorrect route ordering and over-complication

---

## Fixes Applied

### PR #11: Fix Express Route
```bash
# File: api/index.js line 294
- res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
+ res.sendFile(path.join(__dirname, '..', 'public', 'paste.html'));
```

### PR #12: Remove Conflicting Vercel Route
```bash
# File: vercel.json
# Removed:
{
  "src": "/",
  "dest": "/public/paste.html"
}
```

### PR #13: Add Static Builder (Failed Attempt)
- Added `@vercel/static` builder
- Added regex routing with capture groups
- **Issue:** Capture group mapping didn't work correctly

### PR #14: Simplify to Standard Pattern (Final Fix)
```json
{
  "builds": [
    {"src": "public/**", "use": "@vercel/static"},  // Priority 1: Static files
    {"src": "api/index.js", "use": "@vercel/node"}  // Priority 2: API
  ],
  "routes": [
    {"src": "/api/(.*)", "dest": "/api/index.js"},  // API routes
    {"src": "/(.*)", "dest": "/api/index.js"}       // Everything else to Express
  ]
}
```

**Key insight:** When using `@vercel/static`, Vercel automatically serves files from the `public` directory at the root path. No need for complex routing rules.

---

## Validation Steps

After deployment, verify all endpoints:

```bash
# 1. Root path
curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://thinx.fun/"
# Expected: HTTP 200

# 2. Static pages
curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://thinx.fun/analyze.html"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://thinx.fun/keypoints.html"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://thinx.fun/paste.html"
# Expected: HTTP 200 for all

# 3. API endpoints
curl -s "https://thinx.fun/api/health"
# Expected: {"status":"ok","timestamp":"..."}

# 4. Dynamic routes (UUID job pages)
curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://thinx.fun/12345678-1234-1234-1234-123456789012"
# Expected: HTTP 200 (serves job.html)
```

---

## Prevention Measures

### 1. **Pre-Deployment Validation**
Add to CI/CD pipeline:
```bash
# Verify critical pages return 200
npm run validate:deployment
```

Create `scripts/validate-deployment.sh`:
```bash
#!/bin/bash
SITE_URL="${1:-https://thinx.fun}"

# Test endpoints
test_url() {
  local url=$1
  local expected=$2
  local code=$(curl -s -o /dev/null -w "%{http_code}" "$url")

  if [ "$code" = "$expected" ]; then
    echo "✅ $url - HTTP $code"
  else
    echo "❌ $url - Expected $expected, got $code"
    exit 1
  fi
}

test_url "$SITE_URL/" "200"
test_url "$SITE_URL/analyze.html" "200"
test_url "$SITE_URL/keypoints.html" "200"
test_url "$SITE_URL/api/health" "200"
```

### 2. **Vercel Configuration Best Practices**

**DO:**
- ✅ Use `@vercel/static` for all static files
- ✅ Keep routing simple - let Vercel handle static file serving
- ✅ Test configuration changes in preview deployments first
- ✅ Build static files before API functions in the builds array

**DON'T:**
- ❌ Manually route static files with complex regex
- ❌ Use capture groups unless absolutely necessary
- ❌ Serve static files through Express in Vercel (performance issue)
- ❌ Reference `/public/` in Vercel routes (files are at root after build)

### 3. **Express Route Validation**
Before changing route handlers, verify file exists:
```javascript
// Good pattern
const filePath = path.join(__dirname, '..', 'public', 'paste.html');
if (!fs.existsSync(filePath)) {
  throw new Error(`File not found: ${filePath}`);
}
app.get('/', (req, res) => {
  res.sendFile(filePath);
});
```

### 4. **Monitoring & Alerts**
Set up:
- [ ] Uptime monitoring for critical pages (/, /analyze.html, /keypoints.html)
- [ ] Alert on 404 rate spike
- [ ] Vercel deployment notifications to Slack
- [ ] Automated smoke tests after deployment

---

## Troubleshooting Guide

### Symptom: Root Path Returns 404

**Diagnostic Steps:**
1. Check Express route handler in `api/index.js`
   ```bash
   grep -A 3 "app.get('/'," api/index.js
   ```
2. Verify file exists:
   ```bash
   ls -la public/paste.html
   ```
3. Check Vercel logs:
   ```bash
   vercel logs thinx.fun --follow
   ```

**Common Causes:**
- File doesn't exist at specified path
- Route handler serving wrong file
- Vercel routing override

**Fix:**
Update Express route to serve correct file or add file

---

### Symptom: Static HTML Files Return 307 or 404

**Diagnostic Steps:**
1. Check `vercel.json` configuration
   ```bash
   cat vercel.json | jq '.builds, .routes'
   ```
2. Verify `@vercel/static` builder is configured
3. Check route priority (static should come before catch-all)

**Common Causes:**
- Missing `@vercel/static` builder
- Catch-all route overriding static files
- Incorrect route patterns

**Fix:**
```json
{
  "builds": [
    {"src": "public/**", "use": "@vercel/static"},  // Must be present
    {"src": "api/index.js", "use": "@vercel/node"}
  ]
}
```

---

### Symptom: API Endpoints Return 404

**Diagnostic Steps:**
1. Check Vercel function deployment
   ```bash
   vercel inspect thinx.fun
   ```
2. Verify API routes in `api/index.js`
3. Check route pattern in `vercel.json`

**Fix:**
Ensure API route pattern is correct:
```json
{"src": "/api/(.*)", "dest": "/api/index.js"}
```

---

## Key Learnings

1. **Vercel Static File Serving:** When using `@vercel/static`, files are automatically served from the output directory at the root path. No manual routing needed.

2. **Route Priority Matters:** In `vercel.json`, routes are evaluated in order. Specific routes should come before catch-all routes.

3. **Simple is Better:** Complex regex routing is error-prone. Use Vercel's built-in patterns when possible.

4. **Test Before Merge:** Preview deployments exist for a reason. Always test critical paths before merging to main.

5. **Incremental Changes:** When fixing production issues, make small, testable changes. Don't combine multiple fixes in one PR.

---

## Reference Links

- [Vercel Configuration Documentation](https://vercel.com/docs/projects/project-configuration)
- [Vercel Static Builds](https://vercel.com/docs/build-step#static-builds)
- [Express Static Files](https://expressjs.com/en/starter/static-files.html)
- Session URL: https://claude.ai/code/session_01WifA1TU4H8uVqZpFToKKwZ

---

## Follow-up Actions

- [ ] Add automated validation tests
- [ ] Set up Vercel deployment alerts
- [ ] Document Vercel configuration standards
- [ ] Add pre-commit hook to validate Express routes
- [ ] Create runbook for common deployment issues

---

**Prepared by:** AI Agent (Claude)
**Reviewed by:** [Pending]
**Next Review Date:** [30 days from incident]
