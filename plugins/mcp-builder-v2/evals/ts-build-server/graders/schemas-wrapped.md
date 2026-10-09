---
type: regex
target:
  source: file
  path: src/server.ts
pattern: '\b(inputSchema|outputSchema)\s*:\s*\{'
match: not_contains
---
