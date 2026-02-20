# Level 5 Autonomous AI Agent Access Control System

## Overview

In a Level 5 autonomous world, AI agents need secure, scoped access to perform operations on behalf of users while maintaining security boundaries and audit trails.

## Current State

**Manual Token Usage:**
- GitHub token: `ghp_REDACTED_EXAMPLE_TOKEN_DO_NOT_USE` (hardcoded in session)
- Used directly by agents via command-line tools
- No audit trail or access control
- Token has full repository access

**Existing Secrets:**
- `CLAUDE_API_KEY` - For AI model access
- `GEMINI_API_KEY` - Missing in production (causing analyze failures)

## Security Issues

1. **Over-privileged tokens**: Single token with broad permissions
2. **No audit trail**: Can't track which agent did what
3. **No revocation**: Can't revoke access to specific agents
4. **Token exposure**: Tokens passed directly to agents in sessions
5. **No scope limiting**: Agents have same permissions as humans

---

## Proposed Architecture: Admin Agent + Permission System

### Core Components

```
┌─────────────────────────────────────────────────────────┐
│                    Admin Agent                          │
│  - Controls all privileged operations                   │
│  - Issues short-lived, scoped tokens                   │
│  - Maintains audit log                                  │
│  - Enforces rate limits                                 │
└─────────────────────────────────────────────────────────┘
                         ↓
        ┌────────────────────────────────┐
        │   Permission Request System     │
        │  - Agent requests permission    │
        │  - Admin evaluates & approves   │
        │  - Issues time-limited token    │
        └────────────────────────────────┘
                         ↓
        ┌────────────────────────────────┐
        │    Worker Agents (Sonnet)      │
        │  - Request permissions          │
        │  - Use scoped tokens            │
        │  - Operations logged            │
        └────────────────────────────────┘
```

### Permission Request Flow

```javascript
// 1. Agent requests permission
const request = {
  agent_id: "claude-sonnet-session-abc123",
  operation: "github.pr.merge",
  scope: {
    repository: "asamaka/engzny",
    pr_number: 15,
    reason: "Deploy fix for URL length issue"
  },
  duration: 300 // 5 minutes
};

// 2. Admin Agent evaluates
const evaluation = await adminAgent.evaluate(request);
// Checks:
// - Is operation allowed for this agent type?
// - Is the reason valid?
// - Does it match expected workflow?
// - Are there any safety concerns?

// 3. If approved, issue scoped token
const scopedToken = await adminAgent.issueToken({
  agent_id: request.agent_id,
  permissions: ["pr:merge"],
  repository: "asamaka/engzny",
  pr_numbers: [15],
  expires_at: Date.now() + 300000,
  audit_id: "audit-12345"
});

// 4. Agent uses scoped token
await mergeP R(scopedToken, 15);

// 5. Audit log entry created
{
  timestamp: "2026-02-20T22:15:00Z",
  agent_id: "claude-sonnet-session-abc123",
  operation: "github.pr.merge",
  pr_number: 15,
  result: "success",
  audit_id: "audit-12345"
}
```

---

## Implementation Plan

### Phase 1: GitHub App (Recommended Approach)

Instead of personal access tokens, use a **GitHub App** for agent access:

**Benefits:**
- Fine-grained permissions
- Per-repository installation
- Audit trail built-in
- Revocable at any time
- Can be scoped to specific operations

**Setup:**
```bash
# 1. Create GitHub App
# Go to: https://github.com/settings/apps/new

# 2. Configure permissions:
- Repository permissions:
  - Contents: Read & Write
  - Pull requests: Read & Write
  - Issues: Read & Write
  - Actions: Read
  - Metadata: Read

# 3. Generate private key
# 4. Install app on repository
# 5. Store credentials as secrets:
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY=<pem>
GITHUB_APP_INSTALLATION_ID=789012
```

**Agent Usage:**
```javascript
// Admin agent generates installation token
const token = await getGitHubAppToken({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
  installationId: process.env.GITHUB_APP_INSTALLATION_ID
});

// Token is short-lived (1 hour) and scoped
// No need for manual revocation
```

### Phase 2: Admin Agent Service

**Create Admin Agent API:**

```javascript
// .claude/admin-agent/server.js
const express = require('express');
const jwt = require('jsonwebtoken');

const app = express();

// Permission request endpoint
app.post('/api/admin/request-permission', async (req, res) => {
  const { agent_id, operation, scope, reason } = req.body;

  // Evaluate request
  const allowed = await evaluatePermissionRequest({
    agent_id,
    operation,
    scope,
    reason
  });

  if (!allowed.approved) {
    return res.status(403).json({
      error: 'Permission denied',
      reason: allowed.reason
    });
  }

  // Issue scoped token
  const token = jwt.sign({
    agent_id,
    operation,
    scope,
    exp: Math.floor(Date.now() / 1000) + 300 // 5 min
  }, process.env.ADMIN_AGENT_SECRET);

  // Log audit trail
  await logAuditEntry({
    agent_id,
    operation,
    scope,
    approved: true,
    token_id: token.substring(0, 8)
  });

  res.json({
    token,
    expires_in: 300
  });
});

// Permission evaluation logic
async function evaluatePermissionRequest({ agent_id, operation, scope, reason }) {
  // Check agent type
  if (!agent_id.startsWith('claude-')) {
    return { approved: false, reason: 'Unknown agent type' };
  }

  // Check operation whitelist
  const allowedOperations = {
    'claude-sonnet': ['github.pr.create', 'github.pr.merge', 'git.push'],
    'claude-opus': ['github.pr.create', 'github.pr.merge', 'git.push', 'github.secrets.update'],
    'claude-haiku': ['git.fetch', 'git.read']
  };

  const agentType = agent_id.split('-')[1];
  if (!allowedOperations[agentType]?.includes(operation)) {
    return { approved: false, reason: 'Operation not allowed for agent type' };
  }

  // Check rate limits
  const recentOps = await getRecentOperations(agent_id);
  if (recentOps.length > 10) {
    return { approved: false, reason: 'Rate limit exceeded' };
  }

  // Check scope validity
  if (scope.repository && !scope.repository.startsWith('asamaka/')) {
    return { approved: false, reason: 'Invalid repository scope' };
  }

  return { approved: true };
}
```

### Phase 3: Agent SDK Integration

**Update Claude Code to use permission system:**

```javascript
// .claude/sdk/permissions.js
class PermissionManager {
  constructor(adminAgentUrl) {
    this.adminUrl = adminAgentUrl;
    this.agentId = process.env.CLAUDE_SESSION_ID;
  }

  async requestPermission(operation, scope, reason) {
    const response = await fetch(`${this.adminUrl}/api/admin/request-permission`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: this.agentId,
        operation,
        scope,
        reason
      })
    });

    if (!response.ok) {
      throw new Error(`Permission denied: ${await response.text()}`);
    }

    const { token, expires_in } = await response.json();
    return token;
  }

  async executeGitHubOperation(operation, scope, callback) {
    // Request permission
    const token = await this.requestPermission(
      `github.${operation}`,
      scope,
      `Autonomous ${operation} as part of deployment workflow`
    );

    // Execute with scoped token
    try {
      return await callback(token);
    } finally {
      // Token auto-expires, no need to revoke
    }
  }
}

// Usage in agent code
const pm = new PermissionManager(process.env.ADMIN_AGENT_URL);

// Agent requests permission before merging PR
await pm.executeGitHubOperation('pr.merge', {
  repository: 'asamaka/engzny',
  pr_number: 15
}, async (token) => {
  // Use scoped token
  await mergePR(token, 15);
});
```

---

## Immediate Actions

### 1. Store GitHub Token as Secret (Temporary Solution)

While we build the full admin agent system, store the token securely:

**NOTE:** The token `ghp_REDACTED_EXAMPLE_TOKEN_DO_NOT_USE` should be:
1. **Scoped to minimum permissions** (just PR and code access)
2. **Time-limited** (create a new token with 90-day expiration)
3. **Replaced with GitHub App** (permanent solution)

**Do NOT store this token as a GitHub secret** because:
- It's a personal access token (tied to user account)
- If compromised, it gives full access to all repos
- Cannot be scoped per-repository
- Better to use GitHub App tokens

### 2. Add GEMINI_API_KEY to Vercel

The analyze feature needs this immediately:

```bash
# Via Vercel CLI
vercel env add GEMINI_API_KEY production

# Or via Vercel Dashboard:
# https://vercel.com/asamaka/engzny/settings/environment-variables
```

### 3. Set up GitHub App (Recommended)

Create a GitHub App specifically for agent operations:

1. Go to: https://github.com/settings/apps/new
2. Name: "thinx.fun Agent"
3. Homepage: https://thinx.fun
4. Permissions:
   - Repository: Contents (Read & Write)
   - Pull Requests (Read & Write)
   - Workflows (Read)
5. Generate private key
6. Install on `asamaka/engzny`
7. Add secrets to GitHub:
   ```bash
   AGENT_GITHUB_APP_ID
   AGENT_GITHUB_APP_PRIVATE_KEY
   AGENT_GITHUB_APP_INSTALLATION_ID
   ```

---

## Security Best Practices

### For Autonomous Agents

1. **Principle of Least Privilege**
   - Agents only get permissions they need
   - Time-limited tokens (5-15 minutes)
   - Scope to specific repositories/PRs

2. **Audit Everything**
   - Log all permission requests
   - Log all operations performed
   - Include agent_id, operation, result, timestamp

3. **Rate Limiting**
   - Max 10 operations per agent per hour
   - Max 50 operations per repository per day
   - Exponential backoff on failures

4. **Human Override**
   - Critical operations require human approval
   - Examples: Deleting branches, force-pushing, changing secrets
   - Admin agent can require confirmation

5. **Separation of Concerns**
   - Worker agents (Sonnet/Haiku): Execute tasks
   - Admin agent (Opus): Grant permissions, audit
   - Human: Strategic decisions, approve critical ops

---

## Example Workflows

### Workflow 1: Deploy Fix (Current Issue)

```
1. Sonnet agent identifies issue (404 error)
2. Sonnet writes fix, commits locally
3. Sonnet requests permission to create PR
   → Admin agent evaluates: ✅ Allowed
   → Issues 5-min token scoped to PR creation
4. Sonnet creates PR using token
5. Sonnet requests permission to merge PR
   → Admin agent evaluates: ✅ Allowed (tests passed)
   → Issues 5-min token scoped to PR #15 merge
6. Sonnet merges PR
7. Audit log records both operations
```

### Workflow 2: Critical Operation (Requires Human)

```
1. Agent needs to update GitHub secrets
2. Agent requests permission
   → Admin agent evaluates: ❌ Requires human approval
   → Sends notification to user
   → Waits for approval
3. Human reviews request, approves
4. Admin agent issues token
5. Agent updates secret
6. Audit log records operation + human approval
```

---

## Migration Path

**Current (Unsafe):**
```bash
# Agent uses hardcoded token
export GITHUB_TOKEN="ghp_..."
gh pr merge 15 --squash
```

**Phase 1 (GitHub App):**
```bash
# Agent requests app token
TOKEN=$(get_github_app_token)
gh pr merge 15 --squash --token "$TOKEN"
```

**Phase 2 (Admin Agent):**
```bash
# Agent requests permission
TOKEN=$(request_permission "pr.merge" "pr=15" "Deploy fix")
gh pr merge 15 --squash --token "$TOKEN"
```

**Phase 3 (Full Autonomy):**
```bash
# Agent uses SDK, admin agent auto-approves safe operations
claude-deploy --pr 15 --reason "Fix URL length issue"
# Behind the scenes:
# - Agent requests permission
# - Admin agent evaluates (tests passed? recent commits safe? deployment window ok?)
# - Auto-approves or requires human approval
# - Executes with audit trail
```

---

## Monitoring & Alerts

### Metrics to Track

- Permission requests per hour/day
- Approval rate (auto vs human)
- Failed operations
- Average token lifetime
- Operations by agent type

### Alerts

- > 5 permission denials in 1 hour
- Critical operation attempted without human approval
- Token used after expiration
- Unusual operation pattern (e.g., agent trying to access different repo)

---

## Summary

**Level 5 Autonomous Access Control = GitHub App + Admin Agent + Audit Trail**

**Key Principles:**
1. **Never use personal tokens** → Use GitHub Apps
2. **Never grant permanent access** → Time-limited tokens
3. **Never skip audit** → Log everything
4. **Never auto-approve critical ops** → Require human for sensitive actions
5. **Always scope permissions** → Minimum necessary access

**Next Steps:**
1. ✅ Document architecture (this file)
2. ⏳ Create GitHub App for agent access
3. ⏳ Add GEMINI_API_KEY to Vercel
4. ⏳ Build admin agent service
5. ⏳ Integrate permission SDK with Claude Code
6. ⏳ Deploy monitoring & alerts

---

**For On-Call Rotation:**

When an agent requests access:
1. Check audit log for recent operations
2. Verify operation matches expected workflow
3. Approve if safe, deny if suspicious
4. Escalate unusual patterns to security team

**Emergency Procedures:**

If agent misbehaves:
1. Revoke GitHub App installation (cuts off all access immediately)
2. Review audit logs
3. Identify root cause
4. Update admin agent rules
5. Re-enable with tighter controls
