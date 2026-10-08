"""MCP server evaluation harness (MCP Python SDK 2.x, spec 2026-07-28).

Claude answers each question in an evaluation XML file using only the server's tools; the harness
scores the answers and writes a Markdown report with Claude's feedback on the tools.

    pip install -r requirements.txt
    export ANTHROPIC_API_KEY=...
    python evaluation.py eval.xml --cwd ../my-server -- python -m my_server            # stdio: command after --
    python evaluation.py eval.xml -u http://127.0.0.1:8000/mcp -H "Authorization: Bearer $TOKEN"
    python evaluation.py --list-tools -u http://127.0.0.1:8000/mcp                     # connectivity check, no Claude

Layout: pure functions (parse, convert, score, render) on top; effects (MCP client, Anthropic API,
files) at the bottom in `run` and `main`. `agent_loop` takes its two effects as arguments, so it is
testable with fakes.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
import xml.etree.ElementTree as ET
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

PINS = Path(__file__).resolve().parent.parent / "pins.json"
DEFAULT_MODEL = json.loads(PINS.read_text())["eval"]["default_model"] if PINS.exists() else "claude-sonnet-5-5"
ERA_MODES = {"modern": "2026-07-28", "legacy": "legacy", "auto": "auto"}
MAX_TURNS = 40

EVALUATION_PROMPT = """You are an AI assistant with access to tools.

When given a task, you MUST:
1. Use the available tools to complete the task
2. Provide summary of each step in your approach, wrapped in <summary> tags
3. Provide feedback on the tools provided, wrapped in <feedback> tags
4. Provide your final response, wrapped in <response> tags

Summary Requirements:
- In your <summary> tags, you must explain:
  - The steps you took to complete the task
  - Which tools you used, in what order, and why
  - The inputs you provided to each tool
  - The outputs you received from each tool
  - A summary for how you arrived at the response

Feedback Requirements:
- In your <feedback> tags, provide constructive feedback on the tools:
  - Comment on tool names: Are they clear and descriptive?
  - Comment on input parameters: Are they well-documented? Are required vs optional parameters clear?
  - Comment on descriptions: Do they accurately describe what the tool does?
  - Comment on any errors encountered during tool usage: Did the tool fail to execute? Did the tool return too many tokens?
  - Identify specific areas for improvement and explain WHY they would help
  - Be specific and actionable in your suggestions

Response Requirements:
- Your response should be concise and directly address what was asked
- Always wrap your final response in <response> tags
- If you cannot solve the task return <response>NOT_FOUND</response>
- For numeric responses, provide just the number
- For IDs, provide just the ID
- For names or text, provide the exact text requested
- Your response should go last"""


# ---------------------------------------------------------------- pure core


@dataclass(frozen=True)
class QA:
    question: str
    answer: str


@dataclass
class TaskResult:
    qa: QA
    actual: str | None
    summary: str | None
    feedback: str | None
    duration_s: float
    tool_calls: dict[str, list[float]] = field(default_factory=dict)

    @property
    def correct(self) -> bool:
        return self.actual is not None and self.actual == self.qa.answer

    @property
    def num_tool_calls(self) -> int:
        return sum(len(d) for d in self.tool_calls.values())


def parse_evaluation(xml_text: str) -> list[QA]:
    root = ET.fromstring(xml_text)
    pairs = []
    for qa in root.iter("qa_pair"):
        q, a = qa.find("question"), qa.find("answer")
        if q is not None and a is not None:
            pairs.append(QA((q.text or "").strip(), (a.text or "").strip()))
    return pairs


def extract_tag(text: str | None, tag: str) -> str | None:
    matches = re.findall(rf"<{tag}>(.*?)</{tag}>", text or "", re.DOTALL)
    return matches[-1].strip() if matches else None


def to_anthropic_tool(tool: Any) -> dict[str, Any]:
    """MCP Tool (2.x, snake_case) -> Anthropic tool definition."""
    return {"name": tool.name, "description": tool.description or "", "input_schema": tool.input_schema}


def tool_result_text(result: Any) -> tuple[str, bool]:
    """MCP CallToolResult -> (text Claude sees, is_error). Structured content wins when present."""
    if result.structured_content is not None:
        text = json.dumps(result.structured_content)
    else:
        parts = []
        for block in result.content:
            kind = getattr(block, "type", "")
            parts.append(block.text if kind == "text" else f"[{kind} content omitted]")
        text = "\n".join(parts)
    return text, bool(result.is_error)


def render_report(results: list[TaskResult]) -> str:
    n = len(results)
    correct = sum(r.correct for r in results)
    calls = sum(r.num_tool_calls for r in results)
    lines = [
        "# Evaluation Report",
        "",
        "## Summary",
        "",
        f"- **Accuracy**: {correct}/{n} ({(correct / n * 100) if n else 0:.1f}%)",
        f"- **Average Task Duration**: {(sum(r.duration_s for r in results) / n) if n else 0:.2f}s",
        f"- **Average Tool Calls per Task**: {(calls / n) if n else 0:.2f}",
        f"- **Total Tool Calls**: {calls}",
        "",
        "---",
    ]
    for i, r in enumerate(results, 1):
        lines += [
            "",
            f"### Task {i}",
            "",
            f"**Question**: {r.qa.question}",
            f"**Ground Truth Answer**: `{r.qa.answer}`",
            f"**Actual Answer**: `{r.actual or 'N/A'}`",
            f"**Correct**: {'✅' if r.correct else '❌'}",
            f"**Duration**: {r.duration_s:.2f}s",
            f"**Tool Calls**: {json.dumps({k: len(v) for k, v in r.tool_calls.items()})}",
            "",
            "**Summary**",
            r.summary or "N/A",
            "",
            "**Feedback**",
            r.feedback or "N/A",
            "",
            "---",
        ]
    return "\n".join(lines) + "\n"


CreateMessage = Callable[[list[dict[str, Any]]], Awaitable[Any]]
CallTool = Callable[[str, dict[str, Any]], Awaitable[tuple[str, bool]]]


async def agent_loop(question: str, create: CreateMessage, call_tool: CallTool) -> tuple[str | None, dict[str, list[float]]]:
    """Run Claude until it stops asking for tools. Answers every tool_use block in a turn."""
    messages: list[dict[str, Any]] = [{"role": "user", "content": question}]
    metrics: dict[str, list[float]] = {}
    response = await create(messages)
    for _ in range(MAX_TURNS):
        messages.append({"role": "assistant", "content": response.content})
        uses = [b for b in response.content if getattr(b, "type", None) == "tool_use"]
        if response.stop_reason != "tool_use" or not uses:
            break
        results = []
        for use in uses:
            started = time.monotonic()
            try:
                text, is_error = await call_tool(use.name, dict(use.input))
            except Exception as exc:  # protocol errors (MCPError) and transport failures
                text, is_error = f"{type(exc).__name__}: {exc}", True
            metrics.setdefault(use.name, []).append(time.monotonic() - started)
            results.append({"type": "tool_result", "tool_use_id": use.id, "content": text, "is_error": is_error})
        messages.append({"role": "user", "content": results})
        response = await create(messages)
    final = next((b.text for b in response.content if getattr(b, "type", None) == "text"), None)
    return final, metrics


async def evaluate(qa: QA, create: CreateMessage, call_tool: CallTool) -> TaskResult:
    started = time.monotonic()
    text, metrics = await agent_loop(qa.question, create, call_tool)
    return TaskResult(
        qa=qa,
        actual=extract_tag(text, "response"),
        summary=extract_tag(text, "summary"),
        feedback=extract_tag(text, "feedback"),
        duration_s=time.monotonic() - started,
        tool_calls=metrics,
    )


def parse_pairs(items: list[str] | None, sep: str) -> dict[str, str]:
    out = {}
    for item in items or []:
        if sep in item:
            k, v = item.split(sep, 1)
            out[k.strip()] = v.strip()
    return out


# ---------------------------------------------------------------- effects


def mcp_target(args: argparse.Namespace) -> Any:
    """Build the first argument for mcp.Client from CLI flags."""
    if args.url is None:
        from mcp import StdioServerParameters

        if not args.server_command:
            raise SystemExit("give -u URL for HTTP, or the stdio server command after --")
        command, *rest = args.server_command
        return StdioServerParameters(command=command, args=rest, env=parse_pairs(args.env, "=") or None, cwd=args.cwd)
    headers = parse_pairs(args.header, ":")
    if not headers:
        return args.url
    import httpx2
    from mcp.client.streamable_http import streamable_http_client

    return streamable_http_client(args.url, http_client=httpx2.AsyncClient(headers=headers, timeout=httpx2.Timeout(30, read=300)))


async def run(args: argparse.Namespace) -> int:
    from mcp import Client

    async with Client(mcp_target(args), mode=ERA_MODES[args.era]) as client:
        listed = (await client.list_tools()).tools
        print(f"connected: protocol {client.protocol_version}, {len(listed)} tool(s)", file=sys.stderr)
        if args.list_tools:
            print(json.dumps([to_anthropic_tool(t) for t in listed], indent=2))
            return 0
        if not args.eval_file:
            raise SystemExit("an evaluation XML file is required unless --list-tools is given")

        from anthropic import Anthropic

        anthropic = Anthropic()
        tools = [to_anthropic_tool(t) for t in listed]

        async def create(messages: list[dict[str, Any]]) -> Any:
            return await asyncio.to_thread(
                anthropic.messages.create, model=args.model, max_tokens=4096, system=EVALUATION_PROMPT, messages=messages, tools=tools
            )

        async def call_tool(name: str, arguments: dict[str, Any]) -> tuple[str, bool]:
            return tool_result_text(await client.call_tool(name, arguments))

        pairs = parse_evaluation(Path(args.eval_file).read_text())
        results = []
        for i, qa in enumerate(pairs, 1):
            print(f"task {i}/{len(pairs)}: {qa.question[:80]}", file=sys.stderr)
            results.append(await evaluate(qa, create, call_tool))
    report = render_report(results)
    if args.output:
        Path(args.output).write_text(report)
        print(f"report written to {args.output}", file=sys.stderr)
    else:
        print(report)
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Evaluate an MCP server with Claude.")
    p.add_argument("eval_file", nargs="?", help="evaluation XML file")
    p.add_argument("--era", choices=sorted(ERA_MODES), default="modern", help="protocol era to connect in (default: modern = 2026-07-28)")
    p.add_argument("-m", "--model", default=DEFAULT_MODEL, help=f"Claude model (default: {DEFAULT_MODEL})")
    p.add_argument("-e", "--env", nargs="+", help="stdio: KEY=VALUE environment variables")
    p.add_argument("--cwd", help="stdio: working directory for the server process")
    p.add_argument("-u", "--url", help="Streamable HTTP server URL, e.g. http://127.0.0.1:8000/mcp (omit for stdio)")
    p.add_argument("-H", "--header", nargs="+", help="http: 'Name: value' headers")
    p.add_argument("-o", "--output", help="write the report here instead of stdout")
    p.add_argument("--list-tools", action="store_true", help="connect, print tools in Anthropic format, exit (no API key needed)")
    argv = sys.argv[1:]
    dash = argv.index("--") if "--" in argv else len(argv)
    args = p.parse_args(argv[:dash])
    args.server_command = argv[dash + 1 :]
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
