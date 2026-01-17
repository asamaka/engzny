# thinx.fun

A project deployed on Vercel with custom domain configuration.

**Live site**: https://thinx.fun

## For AI Agents

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for complete deployment instructions, including how to make changes, verify deployments, and troubleshoot issues.

## Vercel Deployment

This repository is configured for automatic deployment to Vercel. Push to `main` to deploy.

## Domain Setup: thinx.fun (GoDaddy)

To connect **thinx.fun** from GoDaddy to Vercel, configure these DNS records in your GoDaddy DNS settings:

### Option 1: Using Vercel DNS (Recommended)

Transfer your domain's nameservers to Vercel for the simplest setup:
- Go to Vercel Dashboard → Project → Settings → Domains
- Add `thinx.fun`
- Follow Vercel's instructions to update nameservers in GoDaddy

### Option 2: Keep GoDaddy DNS (Manual Setup)

Add these records in GoDaddy DNS Management:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | @ | `76.76.21.21` | 600 |
| CNAME | www | `cname.vercel-dns.com` | 600 |

**Steps in GoDaddy:**
1. Log in to GoDaddy → My Products → DNS
2. Delete any existing A record for @ (root domain)
3. Add A Record: Name=`@`, Value=`76.76.21.21`
4. Add CNAME Record: Name=`www`, Value=`cname.vercel-dns.com`
5. Save changes (DNS propagation takes up to 48 hours)

### Vercel Project Setup

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Import this GitHub repository
3. Go to Project Settings → Domains
4. Add `thinx.fun` and `www.thinx.fun`
5. Vercel will verify DNS configuration

## Project Structure

```
/
├── api/
│   └── index.js      # Express server
├── public/
│   └── index.html    # Main landing page
├── package.json      # Dependencies
├── vercel.json       # Vercel configuration
└── README.md
```

## Development

To run locally:
```bash
npm install
npm start
```

Then visit http://localhost:3000