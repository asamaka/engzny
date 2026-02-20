# thinx.fun - Project Summary & Status

**Generated**: 2026-02-20 16:47 UTC
**Status**: ✅ Running locally on http://localhost:3000

## What This Project Does

**thinx.fun** is a **Screenshot Intelligence Hub** - an AI-powered web application that analyzes screenshots and images using Claude AI (Anthropic) and Gemini.

### Key Features

1. **Screenshot Analysis** - Upload an image and get AI-powered insights
2. **GIUE (Generative Intent-UI Engine)** - Generates visual interfaces from screenshots
3. **Scan & Share** - Quick image scanning with shareable short codes
4. **Hub Analysis** - Structured analysis with metrics, lists, and visual components

## Current Running Status

### Local Server (Active)
```
Process ID: 5479
Port: 3000
URL: http://localhost:3000
Memory: ~167MB
Status: ✅ Healthy
```

### Recent Activity Logs
```
[dotenv@17.2.3] injecting env (0) from .env
Server running on http://localhost:3000
GET /api/health → 200 OK
GET /api/hub/samples → 200 OK
```

## Available API Endpoints

### Core Endpoints
- `GET /` - Main landing page
- `GET /api/health` - Health check (currently returns: `{"status":"ok"}`)
- `POST /api/upload` - Upload image for analysis (returns job ID)
- `GET /api/job/:jobId/stream` - Server-Sent Events stream for real-time analysis
- `GET /api/job/:jobId/status` - Check job status

### Scan Feature
- `POST /api/scan` - Upload image, get short code
- `GET /api/scan/:code` - Retrieve scanned image
- `GET /s/:code` - View scan page

### Canvas/GIUE Feature
- `GET /canvas` - Canvas generation page
- `POST /api/generate` - Generate visual interface from screenshot
- `GET /api/job/:jobId/canvas` - Stream canvas generation

### Hub Analysis (v2)
- `POST /api/hub/analyze` - Structured screenshot analysis with Gemini
- `GET /api/hub/samples` - List sample screenshots
- `GET /api/hub/sample` - Get sample image

## Architecture

### Backend
- **Framework**: Express.js (Node.js)
- **AI Models**:
  - Claude Sonnet 4 (Anthropic SDK)
  - Gemini (Google AI)
- **Image Processing**: Sharp library
- **Storage**: Upstash Redis (with in-memory fallback)
- **File Upload**: Multer (20MB limit)

### Frontend
- **Static Files**: Served from `/public` directory
- **Real-time**: Server-Sent Events (SSE) for streaming
- **Deployment**: Vercel serverless functions

## Configuration Required

### Environment Variables
The application needs these API keys to function fully:

| Variable | Purpose | Status |
|----------|---------|--------|
| `ANTHROPIC_API_KEY` | Claude AI for image analysis | ⚠️ Not configured |
| `GEMINI_API_KEY` | Google Gemini for hub analysis | ⚠️ Not configured |
| `UPSTASH_REDIS_REST_URL` | Redis storage (optional) | ⚠️ Not configured |
| `UPSTASH_REDIS_REST_TOKEN` | Redis auth (optional) | ⚠️ Not configured |

**Current Status**: Server running without API keys (will error when analyzing images)

## Cloud Deployment to Vercel

### Option 1: Automatic Deployment (Recommended)
This project is already configured for Vercel with auto-deployment:

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Your changes"
   git push origin main
   ```

2. Vercel will automatically:
   - Detect the push to `main` branch
   - Build the project
   - Deploy to https://thinx.fun
   - Show deployment logs in Vercel Dashboard

### Option 2: Manual Deployment via CLI
```bash
# Login to Vercel (one-time)
vercel login

# Deploy to production
vercel --prod

# View logs
vercel logs
```

### Deployment Configuration
The `vercel.json` file is already configured:
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

## Project Statistics

- **Dependencies**: 101 packages
- **Image Upload Limit**: 20MB
- **API Image Limit**: 5MB (auto-compressed)
- **Job TTL**: 1 hour (3600 seconds)
- **Supported Formats**: JPEG, PNG, GIF, WebP

## Sample Files Available

The project includes test screenshots in `/screens`:
```
test_screenshots_img_ - 1.jpeg
test_screenshots_img_ - 10.jpeg
test_screenshots_img_ - 11.jpeg
test_screenshots_img_ - 12.jpeg
test_screenshots_img_ - 13.jpeg
```

## Testing the Local Server

```bash
# Health check
curl http://localhost:3000/api/health

# List sample images
curl http://localhost:3000/api/hub/samples

# View web interface
open http://localhost:3000
```

## Stopping the Server

```bash
# Find the process
ps aux | grep "node api/index.js"

# Stop it
pkill -f "node api/index.js"
```

## Next Steps

To deploy this to the cloud (Vercel):

1. **Set up API keys** in Vercel Dashboard
   - Go to: https://vercel.com/asamaks-projects/engzny/settings/environment-variables
   - Add `ANTHROPIC_API_KEY` and `GEMINI_API_KEY`

2. **Commit and push** your code
   - Changes pushed to `main` auto-deploy to https://thinx.fun

3. **View deployment logs** in Vercel Dashboard
   - https://vercel.com/asamaks-projects/engzny/deployments

## Links

- **Live Site**: https://thinx.fun
- **GitHub Repo**: asamaka/engzny
- **Vercel Dashboard**: https://vercel.com/asamaks-projects/engzny
- **Local Server**: http://localhost:3000

---

**Summary**: The application is successfully running locally. It's a sophisticated AI-powered screenshot analysis tool that integrates with Claude and Gemini APIs to provide intelligent image analysis, visual interface generation, and shareable scan results.
