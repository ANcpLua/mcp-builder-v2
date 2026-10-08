---
max_turns: 20
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
expected_outcome: Writes repos.py without invoking the MCP skill.
---

Write a Python script repos.py that prints the public repositories of a GitHub user given on the command line, using the GitHub REST API and only the standard library.
