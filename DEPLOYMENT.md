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
├── package-lock.json # Locked dependency versions
├── vercel.json       # Vercel build configuration
├── DEPLOYMENT.md     # This file
└── README.md
```

## Required Environment Variables

The following environment variables **must be configured** in Vercel before deployment:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for AI image analysis (starts with `sk-ant-...`) |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JOB_QUEUE_CONCURRENCY` | `2` | Number of analysis jobs to run in parallel |
| `JOB_QUEUE_MAX` | `50` | Max number of queued jobs before rejecting new uploads |
| `JOB_TTL_SECONDS` | `3600` | How long to keep job data before expiring |
| `MAX_IMAGE_BYTES` | `5242880` | Max image size accepted for analysis (5MB) |
| `JOB_STREAM_POLL_INTERVAL_MS` | `1000` | SSE polling interval for cross-instance updates |

### Setting Up Environment Variables in Vercel

1. Go to **Vercel Dashboard**: https://vercel.com/asamaks-projects/engzny
2. Navigate to **Settings** → **Environment Variables**
3. Add each required variable:
   - Click **Add New**
   - Enter the variable **Name** (e.g., `ANTHROPIC_API_KEY`)
   - Enter the **Value** (your API key)
   - Select environments: **Production**, **Preview**, **Development**
   - Click **Save**

**Important**: After adding/changing environment variables, you must trigger a new deployment for changes to take effect.

### Getting API Keys

- **Claude API Key**: Sign up at [console.anthropic.com](https://console.anthropic.com), navigate to API Keys, and create a new key.

## Full Deployment Process

### Step 1: Ensure Environment Variables are Set

Before deploying features that require API keys, verify they are configured in Vercel:

```bash
# Check if the feature requires environment variables by looking at api/index.js
grep -n "process.env" api/index.js
```

### Step 2: Make Changes

Edit files as needed. Common changes:
- **UI changes**: Edit `public/index.html` or add files to `public/`
- **API routes**: Edit `api/index.js` to add Express routes
- **Dependencies**: Update `package.json` and run `npm install`

### Step 3: Test Locally (Optional but Recommended)

```bash
# Install dependencies
npm install

# Set environment variables for local testing
export ANTHROPIC_API_KEY="your-api-key-here"

# Start the server
npm start

# Server runs at http://localhost:3000
```

### Step 4: Commit and Push to Main

```bash
git add -A
git commit -m "Your descriptive commit message"
git push origin main
```

**Important**: Pushing to `main` automatically triggers a Vercel deployment.

### Step 5: Wait for Deployment (15-60 seconds)

Vercel typically takes 15-60 seconds to build and deploy. Wait before verifying.

### Step 6: Verify Deployment Status

Check deployment status via GitHub API:

```bash
# Wait and check status
sleep 20 && gh api repos/asamaka/engzny/commits/main/status --jq '{state: .state, description: .statuses[0].description}'
```

Expected successful response:
```json
{
  "state": "success",
  "description": "Deployment has completed"
}
```

If status is `pending`, wait longer and check again:
```bash
sleep 30 && gh api repos/asamaka/engzny/commits/main/status --jq '.state'
```

### Step 7: Verify Live Site Content

**Always verify changes are visible** by fetching the live site:

```bash
# Fetch the live site and check it returns the updated HTML
curl -sL https://thinx.fun | head -30

# Verify the page title
curl -sL https://thinx.fun | grep -i "<title>"
```

### Step 8: Test API Endpoints

```bash
# Test health endpoint
curl -sL https://thinx.fun/api/health

# Expected response:
# {"status":"ok","timestamp":"2026-01-17T..."}
```

### Step 9: Test Feature-Specific Functionality

For the image analysis feature:
```bash
# Test the analyze endpoint (should return error without image)
curl -sL -X POST https://thinx.fun/api/analyze

# Expected: {"error":"No image uploaded"}
```

## Complete Deployment Script

Run this one-liner for a complete deployment with verification:

```bash
git add -A && \
git commit -m "Your commit message" && \
git push origin main && \
echo "Waiting for deployment..." && \
sleep 30 && \
gh api repos/asamaka/engzny/commits/main/status --jq '.state' && \
echo "Testing health endpoint:" && \
curl -sL https://thinx.fun/api/health && \
echo "" && \
echo "Checking page loads:" && \
curl -sL https://thinx.fun | grep -o "<title>.*</title>"
```

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

### Adding Environment Variables

1. Add the variable to Vercel Dashboard (see above)
2. Access in code:
   ```javascript
   const apiKey = process.env.MY_API_KEY;
   ```
3. Document the variable in this file's "Required Environment Variables" section

## Troubleshooting

### Deployment Failed

1. Check build logs: https://vercel.com/asamaks-projects/engzny
2. Verify `package.json` has valid syntax: `node -e "require('./package.json')"`
3. Ensure all dependencies are listed in `package.json`
4. Check `vercel.json` configuration

### API Returns 500 Error

1. Check if required environment variables are set in Vercel
2. View function logs in Vercel Dashboard → Deployments → Functions tab
3. Test locally with environment variables set

### "ANTHROPIC_API_KEY not set" Error

1. Verify the key is added in Vercel Dashboard → Settings → Environment Variables
2. Ensure the key is enabled for the correct environment (Production)
3. Trigger a redeployment after adding the variable:
   ```bash
   git commit --allow-empty -m "Trigger redeploy" && git push origin main
   ```

### Common Errors

| Error | Solution |
|-------|----------|
| `Cannot read properties of undefined (reading 'fsPath')` | Remove or fix `vercel.json`, ensure Express preset is configured |
| `Module not found` | Run `npm install` and commit `package-lock.json` |
| `Build timeout` | Optimize build or increase timeout in Vercel settings |
| `ANTHROPIC_API_KEY environment variable is not set` | Add the key in Vercel Dashboard → Settings → Environment Variables |
| `401 Unauthorized` from Claude API | Verify your API key is correct and has available credits |

### Checking Deployment Status

```bash
# Get latest deployment status
gh api repos/asamaka/engzny/commits/main/status

# Get recent deployments
gh api repos/asamaka/engzny/deployments --jq '.[0:3] | .[] | {id, environment, created_at}'

# View Vercel deployment logs (in browser)
# https://vercel.com/asamaks-projects/engzny/deployments
```

## DNS Configuration (Reference)

Domain `thinx.fun` is configured in GoDaddy with:

| Type | Name | Value |
|------|------|-------|
| A | @ | 76.76.21.21 |
| CNAME | www | cname.vercel-dns.com |

## Quick Reference Commands

```bash
# Deploy (push to main)
git add -A && git commit -m "message" && git push origin main

# Check deployment status
gh api repos/asamaka/engzny/commits/main/status --jq '.state'

# Verify live site is serving content
curl -sL https://thinx.fun | head -10

# Test health endpoint
curl -sL https://thinx.fun/api/health

# Test image analysis endpoint (error expected without image)
curl -sL -X POST https://thinx.fun/api/analyze

# Verify specific content on live site
curl -sL https://thinx.fun | grep -i "expected text"

# Full deployment + verification (one-liner)
git push origin main && sleep 30 && gh api repos/asamaka/engzny/commits/main/status --jq '.state' && curl -sL https://thinx.fun/api/health

# View recent commits
git log --oneline -5

# Test locally (requires ANTHROPIC_API_KEY env var)
export ANTHROPIC_API_KEY="sk-ant-..." && npm install && npm start

# Trigger redeploy without changes
git commit --allow-empty -m "Trigger redeploy" && git push origin main
```

## Current Features

### Image Analysis (`/api/analyze`)

- **Method**: POST
- **Content-Type**: `multipart/form-data` or `application/json`
- **Fields (multipart)**:
  - `image` (required): Image file (JPEG, PNG, GIF, WebP, max 5MB)
  - `question` (optional): Specific question about the image
- **Fields (JSON)**:
  - `imageBase64` / `imageData` / `dataUrl` (required): Base64 image data
  - `mediaType` (required for raw base64): e.g. `image/png`
  - `question` (optional): Specific question about the image
- **Requires**: `ANTHROPIC_API_KEY` environment variable
- **Returns**: JSON with AI analysis of the image

### API Upload with Progress Tracking (`/api/upload`)

Upload an image via API and get a job ID to track analysis progress.

- **Method**: POST
- **Content-Type**: `multipart/form-data` or `application/json`
- **Fields (multipart)**:
  - `image` (required): Image file (JPEG, PNG, GIF, WebP, max 5MB)
  - `question` (optional): Specific question about the image
- **Fields (JSON)**:
  - `imageBase64` / `imageData` / `dataUrl` (required): Base64 image data
  - `mediaType` (required for raw base64): e.g. `image/png`
  - `question` (optional): Specific question about the image
- **Requires**: `ANTHROPIC_API_KEY` environment variable
- **Returns**: JSON with job ID, queue info, and URLs

**Example Request:**
```bash
curl -X POST https://thinx.fun/api/upload \
  -F "image=@screenshot.png" \
  -F "question=What does this show?"
```

**Example JSON Request:**
```bash
curl -X POST https://thinx.fun/api/upload \
  -H "Content-Type: application/json" \
  -d '{"imageBase64":"<base64>","mediaType":"image/png","question":"What does this show?"}'
```

**Example Response:**
```json
{
  "success": true,
  "jobId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "statusUrl": "/api/job/a1b2c3d4-e5f6-7890-abcd-ef1234567890/status",
  "viewUrl": "/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "message": "Job created successfully. Visit viewUrl to track progress."
}
```

### Job Status (`/api/job/:jobId/status`)

Get the current status and results of an analysis job.

- **Method**: GET
- **Returns**: JSON with job status, progress, and results (when complete)

**Example Request:**
```bash
curl https://thinx.fun/api/job/a1b2c3d4-e5f6-7890-abcd-ef1234567890/status
```

**Example Response (Processing):**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "processing",
  "progress": 50,
  "progressMessage": "Claude is analyzing the image...",
  "createdAt": "2026-01-17T12:00:00.000Z",
  "completedAt": null,
  "question": "What does this show?",
  "result": null,
  "error": null
}
```

**Example Response (Completed):**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "completed",
  "progress": 100,
  "progressMessage": "Analysis complete!",
  "createdAt": "2026-01-17T12:00:00.000Z",
  "completedAt": "2026-01-17T12:00:15.000Z",
  "question": "What does this show?",
  "result": {
    "analysis": "This image shows...",
    "model": "claude-sonnet-4-20250514",
    "usage": {"input_tokens": 1500, "output_tokens": 500}
  },
  "error": null
}
```

### Job Progress Page (`/:jobId`)

Visit `https://thinx.fun/{jobId}` in a browser to see a real-time progress page that:
- Shows current analysis status
- Displays a progress bar with percentage
- Shows step-by-step progress indicators
- Automatically displays results when complete
- Allows copying results to clipboard

### List Jobs (`/api/jobs`)

Debug endpoint to list all jobs (useful for development).

- **Method**: GET
- **Returns**: JSON array of all jobs with their status

## Testing

### Test Images

Test images are available in the `test-images/` directory:
- `test-chart.svg` - A bar chart graphic
- `test-text.svg` - A newspaper article mockup
- `test-pattern.png` - A simple pattern
- `test-gradient.png` - A gradient image
- `test-tiny.png` - A 1x1 pixel test image

### API Test Script

Run the test script to validate all API endpoints:

```bash
# Test locally
./scripts/test-api.sh http://localhost:3000

# Test production
./scripts/test-api.sh https://thinx.fun
```

## Contact

For issues with Vercel deployment, check:
- Vercel Dashboard: https://vercel.com/asamaks-projects/engzny
- GitHub Repository: https://github.com/asamaka/engzny
