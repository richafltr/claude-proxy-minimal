# Claude Proxy Minimal

A minimal, bulletproof OpenAI-compatible proxy for Google Cloud Claude models.

## Features

- OpenAI-compatible `/v1/chat/completions` endpoint
- Maps OpenAI models to Google Cloud Claude models
- Robust Google Auth with multiple fallback strategies
- Health check endpoint at `/health`
- Minimal dependencies and fast startup

## Usage

```bash
# Health check
curl https://your-app-url.ondigitalocean.app/health

# Chat completion
curl -X POST https://your-app-url.ondigitalocean.app/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-4-sonnet",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100
  }'
```

## Models

- `claude-4-opus` → `claude-sonnet-4`
- `claude-4-sonnet` → `claude-sonnet-4`
- `claude-4` → `claude-sonnet-4`
- `claude-3.7-sonnet` → `claude-3-7-sonnet`
- `claude-3-7-sonnet` → `claude-3-7-sonnet`

## Deploy to DigitalOcean

1. Push to GitHub
2. Use the `.do-app.yaml` spec
3. Deploy via DigitalOcean App Platform
