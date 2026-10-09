---
type: regex
target:
  source: file
  path: library_mcp/__main__.py
pattern: 'transport\s*=\s*["'']sse["'']|sse_app\s*\('
match: not_contains
---
