# Engram memory proxy for Ollama and any OpenAI-compatible API

`@engram-ai-memory/adapter-ollama` sits in front of Ollama or any
OpenAI-compatible chat-completions upstream. It injects recalled memory into
`/api/chat`, `/api/generate` and `/v1/chat/completions`. For exchanges with a
user prompt and assistant text, it stores the prompt and the first 1,000 characters
of the reply. Responses on the streaming path over 1 MiB are forwarded in full
and skip storage. Point the client at `http://localhost:11435`.

```bash
ENGRAM_UPSTREAM=http://localhost:11434 \
ENGRAM_API=http://localhost:4901 \
node adapters/ollama/dist/proxy.js
```

`ENGRAM_UPSTREAM` is the preferred upstream URL. `OLLAMA_TARGET` still works as
its older name, and `ENGRAM_UPSTREAM` wins when both are set. With no port,
`ENGRAM_UPSTREAM` uses 80 for HTTP and 443 for HTTPS. `OLLAMA_TARGET` keeps
11434 for HTTP. A target path is
kept as a prefix, so `https://openrouter.ai/api` receives
`/api/v1/chat/completions`.

## Other OpenAI-compatible upstreams

LM Studio:

```bash
ENGRAM_UPSTREAM=http://localhost:1234 node adapters/ollama/dist/proxy.js
```

OpenRouter — the client keeps its own credentials, and the proxy forwards the
`Authorization` header unchanged:

```bash
ENGRAM_UPSTREAM=https://openrouter.ai/api node adapters/ollama/dist/proxy.js
# client: Authorization: Bearer <key>
```

OpenAI Python SDK:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:11435/v1",
    api_key="local",  # Use the upstream key when the upstream requires authentication.
)
```

Set `ENGRAM_API_KEY` to the Engram API key; the proxy sends it to Engram as the
`X-API-Key` header. The proxy binds to `127.0.0.1` by default (`ENGRAM_PROXY_HOST`) and returns 403 for an untrusted Host or Origin. On tool-enabled requests it can retry a missed tool call once. Set `ENGRAM_TOOL_RETRY=false` to disable the retry.
