"""Offline test for evaluation.py: a scripted fake Claude drives a real in-memory MCP server.

    pip install -r requirements.txt pytest && pytest -q test_evaluation.py
"""

from __future__ import annotations

from types import SimpleNamespace as NS

import pytest

from mcp import Client
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

import evaluation as ev


def make_server() -> MCPServer:
    mcp = MCPServer("calc")

    @mcp.tool()
    def add(a: int, b: int) -> int:
        """Add two integers."""
        return a + b

    @mcp.tool()
    def fail() -> str:
        """Always fails."""
        raise ToolError("nope, try add")

    return mcp


def fake_claude(script: list[NS]):
    turns = iter(script)

    async def create(messages):
        return next(turns)

    return create


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def test_pure_helpers() -> None:
    pairs = ev.parse_evaluation("<evaluation><qa_pair><question> Q </question><answer> 3 </answer></qa_pair></evaluation>")
    assert pairs == [ev.QA("Q", "3")]
    assert ev.extract_tag("<response>a</response> x <response>b</response>", "response") == "b"
    report = ev.render_report([ev.TaskResult(qa=pairs[0], actual="3", summary=None, feedback=None, duration_s=0.1)])
    assert "1/1 (100.0%)" in report


@pytest.mark.anyio
@pytest.mark.parametrize("mode", ["2026-07-28", "legacy"])
async def test_agent_loop_answers_every_tool_use_block(mode: str) -> None:
    async with Client(make_server(), mode=mode) as client:
        tools = [ev.to_anthropic_tool(t) for t in (await client.list_tools()).tools]
        assert {t["name"] for t in tools} == {"add", "fail"}
        assert tools[0]["input_schema"]["type"] == "object"

        async def call_tool(name, arguments):
            return ev.tool_result_text(await client.call_tool(name, arguments))

        script = [
            NS(stop_reason="tool_use", content=[
                NS(type="tool_use", id="t1", name="add", input={"a": 1, "b": 2}),
                NS(type="tool_use", id="t2", name="fail", input={}),
            ]),
            NS(stop_reason="end_turn", content=[NS(type="text", text="<summary>s</summary><feedback>f</feedback><response>3</response>")]),
        ]
        seen = []
        create = fake_claude(script)

        async def recording_create(messages):
            seen.append(messages[-1])
            return await create(messages)

        result = await ev.evaluate(ev.QA("1+2?", "3"), recording_create, call_tool)
        assert result.correct and result.num_tool_calls == 2
        tool_results = seen[1]["content"]
        assert [r["tool_use_id"] for r in tool_results] == ["t1", "t2"]
        assert tool_results[0]["content"] == '{"result": 3}' and tool_results[0]["is_error"] is False
        assert tool_results[1]["is_error"] is True and "try add" in tool_results[1]["content"]
