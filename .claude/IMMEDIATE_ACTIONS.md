# Immediate Actions Required

## Current Issues

### 1. ❌ GEMINI_API_KEY Missing in Production
**Impact:** Analyze feature fails with "Get your API key from https://ai.google.dev/"
**Status:** Blocking analyze functionality
**Owner:** Human action required

### 2. ⚠️ GitHub Token Security
**Impact:** Token hardcoded in session, no access control
**Status:** Security risk
**Owner:** Human action required

### 3. ℹ️  Model Switch Request
**Impact:** User requested Claude Opus 4.6
**Status:** Cannot be done by agent
**Owner:** User action required

---

## Actions for Human

### Action 1: Add GEMINI_API_KEY to Vercel (URGENT)

**Via Vercel Dashboard (Easiest):**
1. Go to: https://vercel.com/asamaka/engzny/settings/environment-variables
2. Click "Add New"
3. Name: `GEMINI_API_KEY`
4. Value: [Your Gemini API key from https://ai.google.dev/]
5. Environment: Production (and Preview if desired)
6. Click "Save"
7. Redeploy: https://vercel.com/asamaka/engzny/deployments → Click latest → "Redeploy"

**Via Vercel CLI:**
```bash
vercel env add GEMINI_API_KEY production
# Paste your Gemini API key when prompted
vercel --prod  # Trigger redeployment
```

**Validation:**
```bash
# After deployment, test:
curl -X POST "https://thinx.fun/api/hub/analyze" \
  -H "Content-Type: application/json" \
  -d '{"image":"data:image/png;base64,iVBOR..."}'
# Should not return API key error
```

---

### Action 2: Create GitHub App for Agent Access (RECOMMENDED)

**Why GitHub App > Personal Access Token:**
- ✅ Scoped permissions per repository
- ✅ Revocable without affecting your account
- ✅ Audit trail built-in
- ✅ Can be automated safely
- ❌ Personal tokens give full account access

**Steps:**
1. Go to: https://github.com/settings/apps/new
2. Fill in:
   - **Name:** thinx.fun-agent
   - **Homepage URL:** https://thinx.fun
   - **Webhook:** Leave unchecked
3. **Repository permissions:**
   - Contents: Read & Write
   - Pull requests: Read & Write
   - Workflows: Read
   - Metadata: Read
4. **Where can this GitHub App be installed?**
   - Select "Only on this account"
5. Click "Create GitHub App"
6. On the app page:
   - Click "Generate a private key" (downloads .pem file)
   - Note the **App ID** (shown at top)
7. Click "Install App" → Select `asamaka/engzny`
   - Note the **Installation ID** from URL: `.../installations/[ID]`
8. Add secrets to GitHub repository:
   ```bash
   # Via GitHub web UI: https://github.com/asamaka/engzny/settings/secrets/actions
   # Add these secrets:
   GITHUB_APP_ID=<app_id>
   GITHUB_APP_PRIVATE_KEY=<contents of .pem file>
   GITHUB_APP_INSTALLATION_ID=<installation_id>
   ```

**Agent Usage (Future):**
Agents will request tokens from admin agent, which generates short-lived installation tokens instead of using personal tokens.

---

### Action 3: Switch to Claude Opus 4.6 (Optional)

**Note:** AI agents cannot switch models themselves.

**To switch:**
1. In Claude Code, use command: `/model opus-4-6`
2. Or update your Claude Code configuration
3. New conversations will use Opus 4.6

**When to use Opus 4.6:**
- Complex planning tasks
- Multi-step reasoning
- Critical deployments
- Security-sensitive operations

**When to use Sonnet 4.5 (current):**
- Most development tasks (faster, lower cost)
- Routine deployments
- Code writing and testing

---

### Action 4: Remove Hardcoded GitHub Token (Security)

**Current state:**
```bash
# Token visible in session:
ghp_REDACTED_EXAMPLE_TOKEN_DO_NOT_USE
```

**This token should:**
1. ❌ **NOT be stored in code or documentation**
2. ❌ **NOT be committed to repository**
3. ❌ **NOT be shared with agents directly**
4. ✅ **BE REVOKED after GitHub App is set up**
5. ✅ **BE REPLACED with GitHub App tokens**

**To revoke:**
1. Go to: https://github.com/settings/tokens
2. Find token `ghp_REDACTED_EXAMPLE_TOKEN_DO_NOT_USE`
3. Click "Delete"
4. Confirm deletion

**After GitHub App is set up, agents will:**
- Request permissions from admin agent
- Receive short-lived (5-15 min) installation tokens
- Operations logged in audit trail
- Tokens auto-expire (no manual revocation needed)

---

## Actions for Agent (Already Done)

### ✅ Document URL Length Fix
- Created INCIDENT_REPORT.md with full timeline
- Documented sessionStorage solution
- Added validation procedures

### ✅ Document Agent Access Control
- Created .claude/AGENT_ACCESS_CONTROL.md
- Designed Level 5 autonomous architecture
- Explained admin agent pattern

### ✅ Fix All Production Issues
- PR #11: Fixed Express route (404 error)
- PR #12: Fixed Vercel routing
- PR #13: Added static file builder
- PR #14: Simplified Vercel config
- PR #15: Fixed URL length issue (sessionStorage)
- PR #16: Added incident report

---

## Verification Checklist

After completing human actions:

- [ ] GEMINI_API_KEY added to Vercel
- [ ] Analyze feature works (no API key error)
- [ ] GitHub App created and installed
- [ ] App secrets added to repository
- [ ] Old personal token revoked
- [ ] Admin agent can generate installation tokens
- [ ] Audit logging enabled

**Test Command:**
```bash
# Test analyze feature
curl -X POST "https://thinx.fun/api/hub/analyze" \
  -H "Content-Type: application/json" \
  -d '{"image":"data:image/png;base64,iVBOR..."}'

# Should return: {
#   "success": true,
#   "toolCalls": [...]
# }
```

---

## What Cannot Be Automated

1. **Adding Vercel environment variables**
   - Requires Vercel account access
   - No API for environment variables without Vercel token

2. **Creating GitHub Apps**
   - Requires GitHub account authorization
   - Cannot be done via API

3. **Switching AI models**
   - Agent cannot change its own model
   - User must configure Claude Code

4. **Adding GitHub repository secrets via API**
   - Requires `libsodium` or `pynacl` for encryption
   - Not available in current environment
   - Easier to do via GitHub web UI

---

## Next Steps

**Priority 1 (Today):**
1. Add GEMINI_API_KEY to Vercel
2. Test analyze feature

**Priority 2 (This Week):**
1. Create GitHub App
2. Add app secrets to repository
3. Revoke personal token

**Priority 3 (Next Sprint):**
1. Build admin agent service
2. Implement permission SDK
3. Integrate with Claude Code
4. Enable Level 5 autonomous operations

---

## Questions?

- See: `.claude/AGENT_ACCESS_CONTROL.md` for full architecture
- See: `INCIDENT_REPORT.md` for deployment issues guide
- See: `PRODUCTION_DEPLOY.md` for deployment procedures
