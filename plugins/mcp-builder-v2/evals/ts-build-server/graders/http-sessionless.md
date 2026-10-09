---
type: regex
target:
  source: file
  path: src/http.ts
pattern: 'sessionIdGenerator|StreamableHTTPServerTransport|mcp-session-id'
flags: i
match: not_contains
---
