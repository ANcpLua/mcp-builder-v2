---
type: regex
weight: 2
target:
  source: file
  path: pyproject.toml
pattern: '["'']mcp(\[[^\]]*\])?\s*(>=|~=|==)\s*2'
---
