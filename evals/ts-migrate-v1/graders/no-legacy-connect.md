---
type: regex
weight: 2
target:
  source: file
  path: src/index.ts
pattern: 'new\s+StdioServerTransport\s*\('
match: not_contains
---
