# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.x (current) | ✅ |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, open a [GitHub Security Advisory](https://github.com/ayvazyan10/engram/security/advisories/new) or email the maintainers directly.

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix if you have one

We aim to acknowledge reports within 48 hours and provide a fix timeline within 7 days.

## Scope

Engram runs entirely locally by default — there is no cloud service or user accounts. The main attack surfaces are:

- The REST API (`apps/server`) — unauthenticated by default, intended for local use. Do not expose port 4901 to the internet without adding authentication.
- The MCP server — runs as a local stdio process, accessible only to the local user.
- The SQLite database file — protected by filesystem permissions.

For production deployments, place the API behind an authenticating reverse proxy (nginx, Caddy, etc.) and restrict the bind address accordingly.
