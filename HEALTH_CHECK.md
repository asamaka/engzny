# 🏥 API Health Check

## Quick Token Test

Want to quickly verify your Claude API token works? Run:

```bash
npm run test:health
```

This will:
- ✅ Make a real API call to Claude with Haiku (cheapest model)
- ✅ Verify your token is valid and working
- ✅ Test vision capabilities
- ✅ Show token usage (minimal cost: ~1-2 cents)

---

## What It Tests

### 1. **Basic API Health**
```
✓ Valid Claude API token check
✓ Invalid token detection
```

### 2. **Vision API Health**
```
✓ Vision capabilities working
✓ Image analysis functional
```

---

## Example Output

### ✅ Success:
```bash
$ npm run test:health

PASS tests/integration/api-health.test.js
  API Health Checks
    Claude API Token
      ✓ should have a valid working Claude API token (523ms)
        ✅ Claude API token is valid and working!
           Model: claude-haiku-3-5-20250226
           Tokens used: 8 in, 6 out
      ✓ should detect invalid Claude API token (234ms)
        ✅ Invalid token correctly rejected
    Claude Vision API
      ✓ should have working vision capabilities (892ms)
        ✅ Claude Vision API is working!
           Response: The image shows a small red square...
           Tokens used: 112 in, 12 out

Tests: 3 passed, 3 total
```

### ❌ No Token:
```bash
⚠️  No CLAUDE_API_KEY found - skipping health check
```

### ❌ Invalid Token:
```bash
Error: Invalid API key provided
```

---

## Setup

Add your API key to environment:

```bash
# Option 1: .env file
echo "ANTHROPIC_API_KEY=sk-ant-api03-your-key-here" >> .env

# Option 2: Export in terminal
export ANTHROPIC_API_KEY=sk-ant-api03-your-key-here

# Option 3: Run inline
ANTHROPIC_API_KEY=sk-ant-api03-your-key npm run test:health
```

---

## Cost Estimate

This health check is designed to be **ultra-cheap**:

- Basic test: ~10 tokens = **$0.0001** (less than a penny)
- Vision test: ~130 tokens = **$0.001** (one-tenth of a penny)
- **Total: ~$0.0011 per run** (basically free!)

Using `claude-haiku-3-5-20250226` (fastest + cheapest model).

---

## CI/CD Integration

### GitHub Actions

Already integrated! The workflow uses:
```yaml
env:
  ANTHROPIC_API_KEY: ${{ secrets.CLAUDE_API_KEY }}
```

### Local Development

```bash
# Quick health check
npm run test:health

# All tests (unit + health)
npm test

# Only unit tests (no API calls)
npm run test:unit
```

---

## Troubleshooting

### "No API key found"
- Add `ANTHROPIC_API_KEY` to `.env`
- Or export it in your terminal

### "Invalid API key"
- Check your key starts with `sk-ant-api03-`
- Verify it's not expired in Anthropic console
- Ensure no extra spaces or quotes

### "Request failed"
- Check internet connection
- Verify Anthropic API is up: https://status.anthropic.com
- Try again in a few seconds (rate limiting)

---

## Advanced Usage

### Test specific health check:

```bash
# Just test basic token
npm run test:health -- -t "valid working Claude API token"

# Just test vision
npm run test:health -- -t "vision capabilities"

# Verbose output
npm run test:health -- --verbose
```

### In CI/CD:

```bash
# Fail fast if token is invalid
npm run test:health || exit 1

# Continue even if health check fails
npm run test:health || true
```

---

## What Makes This Different

Unlike the unit tests:
- 🔴 **Real API calls** (not mocked)
- 💰 **Minimal cost** (uses cheapest model + minimal tokens)
- ⚡ **Fast** (~1-2 seconds total)
- 🎯 **Purpose-built** for "is my token working?"

Perfect for:
- ✅ Local development setup
- ✅ Pre-deployment checks
- ✅ Monitoring token validity
- ✅ CI/CD smoke tests

---

## Summary

**One command to verify everything works:**

```bash
npm run test:health
```

That's it! 🚀
