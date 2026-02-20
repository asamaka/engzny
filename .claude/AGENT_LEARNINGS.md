# 🎓 Agent Learnings - Production Deployment & Secret Management

## Incident Summary

**Date**: 2026-02-20
**Issue**: Analyze feature showing Gemini API errors in production
**Root Cause**: Code changes not deployed + environment variables not synced

## Key Learnings

### 1. ⚠️ **Local Changes ≠ Production**

**Problem**: Made code changes locally, but production still showed old error messages.

**Why**:
- Changes were on feature branch `claude/summarize-project-8RBlP`
- NOT merged to `main` branch
- Vercel only deploys from `main` branch

**Lesson**:
```
✅ ALWAYS verify deployment status
✅ Check which branch is deployed in production
✅ Merge to main to trigger production deployment
```

### 2. 🔐 **Environment Variables Must Be Synced**

**Problem**: Updated code to use `ANTHROPIC_API_KEY` but Vercel didn't have it.

**Why**:
- GitHub secrets and Vercel environment variables are SEPARATE
- GitHub Actions has `CLAUDE_API_KEY` secret
- Vercel needs `ANTHROPIC_API_KEY` environment variable
- No automatic sync between them

**Solution**:
```yaml
# Create workflow to sync secrets
# See: .github/workflows/sync-secrets.yml
- name: Add ANTHROPIC_API_KEY to Vercel
  env:
    ANTHROPIC_API_KEY: ${{ secrets.CLAUDE_API_KEY }}
  run: |
    curl -X POST "https://api.vercel.com/v10/projects/$VERCEL_PROJECT_ID/env" \
      -H "Authorization: Bearer $VERCEL_TOKEN" \
      -d '{"key": "ANTHROPIC_API_KEY", "value": "'"$ANTHROPIC_API_KEY"'"}'
```

**Lesson**:
```
✅ GitHub secrets != Vercel environment variables
✅ Create automation to sync them
✅ Document the mapping clearly
```

### 3. 🚫 **Branch Permissions Matter**

**Problem**: Couldn't push directly to `main` branch.

**Why**:
- Claude Code agents can only push to `claude/*` branches
- Branch must end with session ID
- Direct push to `main` returns 403 error

**Solution**:
```bash
# ✅ Allowed
git push origin claude/summarize-project-8RBlP

# ❌ Not allowed
git push origin main
```

**Workaround**:
```
1. Push changes to claude/* branch
2. Create Pull Request from feature branch to main
3. Merge PR (triggers deployment)
```

**Lesson**:
```
✅ Use feature branches for development
✅ Create PRs to merge to main
✅ Never assume direct push access
```

### 4. 🔄 **Complete Deployment Checklist**

When making production changes:

```markdown
## Code Changes
- [ ] Update all code files
- [ ] Update error messages
- [ ] Update documentation

## Testing
- [ ] Run tests locally
- [ ] Verify changes on feature branch

## Deployment
- [ ] Push to feature branch (claude/*)
- [ ] Create Pull Request to main
- [ ] Merge PR
- [ ] Verify GitHub Actions runs successfully

## Environment Variables
- [ ] Identify required env vars
- [ ] Add to Vercel (all environments)
- [ ] Add to GitHub secrets (for CI/CD)
- [ ] Create sync workflow if needed

## Verification
- [ ] Check production URL
- [ ] Test the actual feature
- [ ] Verify no error messages
- [ ] Check browser console for errors
```

### 5. 📝 **Documentation Is Critical**

**What Worked**:
- Created `.claude/DEPLOY_CLAUDE_OPUS.md` with exact steps
- Created this learnings document
- Documented all changes and reasoning

**Why Important**:
- Future agents can pick up where you left off
- Users know exactly what to do
- Troubleshooting is easier

**Lesson**:
```
✅ Document EVERYTHING
✅ Include exact commands and URLs
✅ Explain WHY not just WHAT
✅ Create verification steps
```

## 🎯 Best Practices for Future Agents

### When Asked to "Deploy to Production"

1. **Check Current State**:
   ```bash
   git status
   git branch
   git log --oneline -5
   ```

2. **Verify Changes Are Complete**:
   - All code files updated?
   - Tests passing?
   - Documentation updated?

3. **Check Environment Variables**:
   - What env vars does code need?
   - Are they in Vercel?
   - Are they in GitHub secrets?
   - Create sync workflow if needed

4. **Use Proper Git Workflow**:
   - Work on `claude/*` branch
   - Create PR to main
   - Let CI/CD handle deployment
   - DON'T try to push directly to main

5. **Verify Deployment**:
   - Check GitHub Actions
   - Visit production URL
   - Test the actual feature
   - Check for errors in browser console

### When Asked to "Fix Production Issue"

1. **Identify Root Cause**:
   - Is code deployed?
   - Are env vars set?
   - Check logs (Vercel, GitHub Actions)

2. **Make ALL Necessary Changes**:
   - Code fixes
   - Environment variables
   - Documentation
   - Tests

3. **Create Automation**:
   - Don't rely on manual steps
   - Create workflows for repeatability
   - Document the automation

4. **Verify the Fix**:
   - Test in production
   - Check all related features
   - Monitor for new errors

## 🚨 Common Pitfalls

### ❌ Pitfall #1: Assuming Local Changes Are Live
**Reality**: Changes on feature branch != deployed code

### ❌ Pitfall #2: Forgetting Environment Variables
**Reality**: Code + env vars BOTH needed for deployment

### ❌ Pitfall #3: Trying to Push Directly to Main
**Reality**: Use PRs, not direct pushes

### ❌ Pitfall #4: Not Verifying in Production
**Reality**: Always test the actual live site

### ❌ Pitfall #5: Incomplete Documentation
**Reality**: Future agents need ALL context

## 📚 Key Files to Know

### GitHub Secrets
Location: `https://github.com/asamaka/engzny/settings/secrets/actions`

Secrets:
- `CLAUDE_API_KEY` → Maps to `ANTHROPIC_API_KEY`
- `VERCEL_TOKEN` → For deployment
- `VERCEL_PROJECT_ID` → For deployment
- `VERCEL_ORG_ID` → For deployment

### Vercel Environment Variables
Location: `https://vercel.com/asamaka/engzny/settings/environment-variables`

Variables needed:
- `ANTHROPIC_API_KEY` (from GitHub `CLAUDE_API_KEY`)

### Workflows
- `.github/workflows/deploy.yml` - Main deployment
- `.github/workflows/tests.yml` - CI tests
- `.github/workflows/sync-secrets.yml` - Secret syncing

### API Files
- `api/llm/claude.js` - Claude adapter (model config)
- `api/llm/index.js` - LLM provider factory
- `api/index.js` - API routes (analyze endpoint)

## 🔮 Future Improvements

1. **Automated Secret Sync**
   - Current: Manual workflow trigger
   - Future: Auto-sync on secret changes

2. **Deployment Notifications**
   - Current: Check GitHub Actions manually
   - Future: Slack/Discord notifications

3. **Environment Parity**
   - Current: Manual verification
   - Future: Automated env var validation

4. **Rollback Automation**
   - Current: Manual revert
   - Future: One-click rollback

## 📖 References

- Vercel API Docs: https://vercel.com/docs/rest-api
- GitHub Actions: https://docs.github.com/en/actions
- Anthropic API: https://docs.anthropic.com/

---

**Last Updated**: 2026-02-20
**Session**: https://claude.ai/code/session_01WifA1TU4H8uVqZpFToKKwZ
**Next Agent**: Read `.claude/DEPLOY_CLAUDE_OPUS.md` for deployment steps
