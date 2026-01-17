# AI Agent Deployment Guide

This document provides instructions for AI agents to deploy changes to thinx.fun via Vercel.

## Overview

- **Repository**: `asamaka/engzny`
- **Hosting**: Vercel (Express.js preset)
- **Domain**: thinx.fun
- **Auto-deploy**: Enabled on `main` branch

## Project Structure

```
/
├── api/
│   └── index.js      # Express server (Vercel serverless function)
├── public/
│   └── index.html    # Static files served by Express
├── package.json      # Node.js dependencies
├── vercel.json       # Vercel build configuration
└── README.md
```

## Deployment Process

### Step 1: Make Changes

Edit files as needed. Common changes:
- **UI changes**: Edit `public/index.html` or add files to `public/`
- **API routes**: Edit `api/index.js` to add Express routes
- **Dependencies**: Update `package.json`

### Step 2: Commit and Push to Main

```bash
git add -A
git commit -m "Your descriptive commit message"
git push origin main
```

**Important**: Pushing to `main` automatically triggers a Vercel deployment.

### Step 3: Verify Deployment

Check deployment status via GitHub API:

```bash
gh api repos/asamaka/engzny/commits/main/status --jq '{state: .state, description: .statuses[0].description}'
```

Expected successful response:
```json
{
  "state": "success",
  "description": "Deployment has completed"
}
```

### Step 4: Verify Live Site

The site is live at:
- **Production**: https://thinx.fun
- **Vercel URL**: https://engzny.vercel.app

## Vercel Configuration

The `vercel.json` configuration:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "api/index.js"
    }
  ]
}
```

This routes all requests through the Express server in `api/index.js`.

## Adding New Features

### Adding a New Page

1. Create the HTML file in `public/`:
   ```bash
   touch public/about.html
   ```

2. The Express server already serves static files from `public/`

### Adding an API Endpoint

Edit `api/index.js` to add new routes:

```javascript
app.get('/api/example', (req, res) => {
  res.json({ message: 'Hello from API' });
});
```

### Adding Dependencies

```bash
npm install <package-name>
```

Then commit both `package.json` and `package-lock.json`.

## Troubleshooting

### Deployment Failed

1. Check build logs in Vercel dashboard
2. Verify `package.json` has valid syntax
3. Ensure all dependencies are listed
4. Check `vercel.json` configuration

### Common Errors

| Error | Solution |
|-------|----------|
| `Cannot read properties of undefined (reading 'fsPath')` | Remove or fix `vercel.json`, ensure Express preset is configured |
| `Module not found` | Run `npm install` and commit `package-lock.json` |
| `Build timeout` | Optimize build or increase timeout in Vercel settings |

### Checking Deployment Status

```bash
# Get latest deployment status
gh api repos/asamaka/engzny/commits/main/status

# Get recent deployments
gh api repos/asamaka/engzny/deployments --jq '.[0:3] | .[] | {id, environment, created_at}'
```

## DNS Configuration (Reference)

Domain `thinx.fun` is configured in GoDaddy with:

| Type | Name | Value |
|------|------|-------|
| A | @ | 76.76.21.21 |
| CNAME | www | cname.vercel-dns.com |

## Environment Variables

To add environment variables:
1. Go to Vercel Dashboard → Project Settings → Environment Variables
2. Add variables for Production/Preview/Development
3. Redeploy to apply changes

Access in code:
```javascript
const apiKey = process.env.API_KEY;
```

## Quick Reference Commands

```bash
# Deploy (push to main)
git add -A && git commit -m "message" && git push origin main

# Check deployment status
gh api repos/asamaka/engzny/commits/main/status --jq '.state'

# View recent commits
git log --oneline -5

# Test locally
npm install && npm start
```

## Contact

For issues with Vercel deployment, check:
- Vercel Dashboard: https://vercel.com/asamaks-projects/engzny
- GitHub Repository: https://github.com/asamaka/engzny
