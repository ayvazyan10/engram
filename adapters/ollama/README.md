# Engram memory proxy for Ollama and any OpenAI-compatible API

`@engram-ai-memory/adapter-ollama` sits in front of Ollama or any
OpenAI-compatible upstream, injects recalled Engram memory into chat requests,
and stores each exchange. Point the client at `http://localhost:11435`.

```bash
ENGRAM_UPSTREAM=http://localhost:11434 \
ENGRAM_API=http://localhost:4901 \
node adapters/ollama/dist/proxy.js
```

`ENGRAM_UPSTREAM` is the preferred upstream URL. `OLLAMA_TARGET` still works as
its older name, and `ENGRAM_UPSTREAM` wins when both are set. A target path is
kept as a prefix, so `https://openrouter.ai/api` receives
`/api/v1/chat/completions`.

## Other OpenAI-compatible upstreams

LM Studio:

```bash
ENGRAM_UPSTREAM=http://localhost:1234
```

OpenRouter — the client keeps its own credentials, and the proxy forwards the
`Authorization` header unchanged:

```bash
ENGRAM_UPSTREAM=https://openrouter.ai/api
# client: Authorization: Bearer <key>
```

OpenAI Python SDK:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:11435/v1",
    api_key="not-used-by-the-proxy",
)
```

Set `ENGRAM_API_KEY` to the Engram API key; the proxy sends it to Engram as the
`X-API-Key` header.
