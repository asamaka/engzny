# 🧪 Test Suite Plan for thinx.fun

## Overview
Comprehensive testing strategy with GitHub Actions integration.

---

## 📋 **Proposed Tests**

### 1. **API Key Validation Tests** ✅
**What:** Test that API keys are properly validated
```javascript
- ✓ Valid Claude API key works
- ✓ Invalid Claude API key fails gracefully
- ✓ Valid Gemini API key works (if available)
- ✓ Missing API key returns proper error
```

### 2. **LLM Adapter Tests** 🤖
**What:** Test Claude and Gemini adapters
```javascript
- ✓ ClaudeAdapter initializes correctly
- ✓ ClaudeAdapter analyzes images
- ✓ GeminiAdapter works (if key available)
- ✓ Error handling for API failures
- ✓ Streaming works properly
```

### 3. **Vision Analysis Tests** 👁️
**What:** Test screenshot analysis with real API
```javascript
- ✓ Analyze sample screenshot
- ✓ Extract structured insights
- ✓ Generate quick answers
- ✓ Handle invalid images
- ✓ Test different image formats (PNG, JPG, WebP)
```

### 4. **API Endpoint Tests** 🌐
**What:** Test Express API endpoints
```javascript
- ✓ POST /api/analyze works
- ✓ POST /api/chat works
- ✓ GET /api/health works
- ✓ Error responses are proper
- ✓ File upload handling
```

### 5. **Frontend Tests** 🎨
**What:** Basic UI functionality tests
```javascript
- ✓ Home page loads
- ✓ Analyze page loads
- ✓ Demo page works without API key
- ✓ Paste detection works
- ✓ Chat input appears
```

### 6. **Integration Tests** 🔗
**What:** End-to-end workflow tests
```javascript
- ✓ Upload screenshot → Get analysis
- ✓ Ask follow-up question → Get response
- ✓ Click "Dig Deeper" → Get detailed answer
- ✓ Full mobile flow works
```

---

## 🎯 **GitHub Actions Workflows**

### **Workflow 1: Quick Tests** (On every push)
```yaml
✓ Lint code
✓ API key validation
✓ Unit tests for adapters
✓ Basic endpoint tests
Duration: ~2 minutes
```

### **Workflow 2: Full Test Suite** (On PR & main)
```yaml
✓ All quick tests
✓ Vision analysis tests (uses CLAUDE_API_KEY secret)
✓ Integration tests
✓ Screenshot analysis tests
Duration: ~5 minutes
```

### **Workflow 3: Nightly Tests** (Daily at midnight)
```yaml
✓ Full test suite
✓ Performance benchmarks
✓ Test with multiple image types
✓ API rate limit tests
Duration: ~10 minutes
```

---

## 🔑 **GitHub Secrets Usage**

The workflows will use:
- `CLAUDE_API_KEY` (already added!) ✅
- Optional: `GEMINI_API_KEY` for cross-testing

---

## 📁 **File Structure**

```
/tests
  /unit
    - llm-adapters.test.js
    - vision-analyzer.test.js
    - api-validation.test.js
  /integration
    - analyze-flow.test.js
    - chat-flow.test.js
  /e2e
    - mobile-workflow.test.js
  /fixtures
    - sample-screenshot.png
    - test-images/
  - setup.js

/.github
  /workflows
    - quick-tests.yml
    - full-tests.yml
    - nightly.yml
```

---

## 🛠️ **Test Framework**

**Recommendation:** Jest + Supertest
- ✅ Fast and reliable
- ✅ Great for Node.js APIs
- ✅ Easy mocking for API calls
- ✅ Built-in code coverage

**Alternative:** Vitest (faster, modern)

---

## 📊 **What Gets Tested**

### Critical Path (MUST pass):
1. ✅ API keys validate correctly
2. ✅ Claude API responds to vision queries
3. ✅ Screenshot analysis returns structured data
4. ✅ Chat endpoint works
5. ✅ Error handling is graceful

### Nice to Have:
6. ⭐ Performance benchmarks
7. ⭐ Cross-browser testing
8. ⭐ Mobile device testing
9. ⭐ Load testing

---

## 🚀 **Implementation Plan**

### Phase 1: Core Tests (30 min)
- Set up Jest
- API validation tests
- LLM adapter tests
- Basic GitHub Action

### Phase 2: Integration (30 min)
- API endpoint tests
- Vision analysis tests
- Full workflow tests

### Phase 3: Advanced (optional)
- E2E tests with Playwright
- Performance benchmarks
- Multi-device testing

---

## ❓ **Questions for You**

1. **Which test framework?**
   - Jest (standard, reliable) ← Recommended
   - Vitest (faster, modern)
   - Other?

2. **How comprehensive?**
   - Quick (Phases 1 only - basic tests)
   - Standard (Phases 1 + 2 - recommended) ← This!
   - Complete (All phases - thorough)

3. **Test sample images?**
   - Use included test screenshots ✅
   - Use real screenshots from your use cases
   - Both

4. **CI/CD preferences?**
   - Run on every push (fast feedback)
   - Run only on PRs (save Actions minutes) ← Recommended
   - Both workflows

---

## 💬 **Ready to Build?**

Let me know:
- ✅ "Looks good, build it!" → I'll implement Phase 1 + 2
- 🔧 "Change X" → I'll adjust the plan
- ❓ "I have questions" → Ask away!
