# 🚀 API Key Setup - Two Easy Options!

Your app supports **TWO AI providers**. Choose either one:

---

## ✨ **Option A: Anthropic Claude** (Recommended - Default)

### Why Claude?
- ✅ **Default provider** in your app
- ✅ **Latest Claude Sonnet 4** model
- ✅ **Excellent vision capabilities**
- ✅ **More accurate for complex analysis**

### Steps to Get Claude API Key:

1. **Visit**: https://console.anthropic.com/
2. **Sign up** or sign in
3. **Go to**: API Keys section
4. **Create** a new API key
5. **Copy** your key (starts with `sk-ant-...`)
6. **Add to `.env`**:
```bash
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Test Your Key:
```bash
node scripts/validate-api-keys.js
```

You should see:
```
✅ Status: Anthropic API is working!
📦 Model: claude-sonnet-4-20250514
```

---

## 📊 **Option B: Google Gemini** (Alternative)

### Why Gemini?
- ✅ **Free tier available**
- ✅ **Fast responses**
- ✅ **Good for basic analysis**

### Steps to Get Gemini API Key:

1. **Visit**: https://ai.google.dev/
2. **Click**: "Get API Key" (blue button)
3. **Sign in** with Google
4. **Create** new project or use existing
5. **Copy** your key (starts with `AIza...`)
6. **Add to `.env`**:
```bash
GEMINI_API_KEY=AIzaSyDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Test Your Key:
```bash
node scripts/validate-api-keys.js
```

---

## 🔧 **Using GitHub Secrets** (Optional)

If your API key is stored in GitHub Secrets:

### Check Available Secrets:
```bash
# List all secrets
gh secret list

# View specific secret (if you have access)
gh secret list --repo asamaka/engzny
```

### Common Secret Names:
- `ANTHROPIC_API_KEY`
- `CLAUDE_API_KEY`
- `GEMINI_API_KEY`
- `GOOGLE_AI_API_KEY`

### Add Secret to .env:
If you find a secret, manually copy it to your `.env` file.

---

## 📱 **Quick Comparison**

| Feature | Claude (Option A) | Gemini (Option B) |
|---------|------------------|-------------------|
| Cost | Pay-per-use | Free tier available |
| Speed | Fast | Very fast |
| Accuracy | Excellent | Good |
| Vision | ✅ Advanced | ✅ Good |
| Default | ✅ **Yes** | No |

---

## ✅ **After Adding Your Key**

1. **Validate**:
```bash
node scripts/validate-api-keys.js
```

2. **Start Server**:
```bash
npm start
```

3. **Visit on Phone**:
```
http://localhost:3000
```

4. **Paste Your Screenshot** and watch the magic! ✨

---

## 🆘 **Need Help?**

### Check Environment Variables:
```bash
cat .env
```

### Validate Connection:
```bash
node scripts/validate-api-keys.js
```

### View Demo (No Key Needed):
```
http://localhost:3000/demo.html
```

---

**Ready?** Pick your provider and add the key! 🎯
