# Evaluation

An evaluation asks: can a model with only these tools answer realistic, hard questions? It is ten question–answer pairs plus a harness that runs Claude against the server and scores exact-match answers. The most useful output is Claude's per-task feedback on the tools.

## Writing the ten questions

Every question is:

- **independent:** it does not rely on another question or on an earlier write;
- **read-only:** answering needs only non-destructive, idempotent calls;
- **multi-hop:** several sub-questions and tool calls, often with paging, filtering or aggregation;
- **paraphrased:** it uses no keyword that a single search would hit; it describes the thing instead of naming it;
- **realistic:** something a person working with this service would actually ask;
- **stable:** about closed, historical things (finished projects, archived repos, a fixed date window), never "current" counts or open items.

Every answer is:

- **one value** that can be checked by exact string comparison: a name, id, number, date, `True`/`False`, or `A`/`B`/`C`/`D`;
- **specified in the question** where more than one format is possible ("Answer as YYYY-MM-DD", "Respond True or False");
- **mostly human-readable** (names over opaque ids), with variety across the ten in type and modality;
- **never a list or free text**, unless a specific single rendering is unavoidable.

| Poor | Why | Better |
|---|---|---|
| "How many issues are open?" | changes over time | "How many issues labelled bug were closed in March 2024?" |
| "Who created the PR titled 'Add auth'?" | one keyword search answers it | "Who authored the change that first introduced token refresh, merged in Q1 2024?" |
| "List the Python repos." | list; order and format vary | "Which Python repo created before 2023 has the most stars?" |

## Process

1. **API.** Read the service's API docs for its entities and history (parallelize with subagents if available).
2. **Tools.** List the server's tools and read their schemas, without reading the server's code.
3. **Explore.** Call read-only tools with small `limit`s to find concrete, closed facts worth asking about.
4. **Write.** Write ten questions to `evaluation.xml`.
5. **Solve.** Solve each one yourself with the tools, record the verified answer, and drop any question that needed a write.

```xml
<evaluation>
   <qa_pair>
      <question>Find the repository archived in Q3 2023 that had been the organization's most forked project. What was its primary language?</question>
      <answer>Python</answer>
   </qa_pair>
</evaluation>
```

## Running the harness

```bash
python -m venv .venv-eval && .venv-eval/bin/pip install -r <skill>/scripts/requirements.txt
export ANTHROPIC_API_KEY=...

# connectivity first: lists tools in the Anthropic format; no API key needed
.venv-eval/bin/python <skill>/scripts/evaluation.py --list-tools --cwd <project> -- .venv/bin/python -m acme_mcp

# stdio server: the command goes after --
.venv-eval/bin/python <skill>/scripts/evaluation.py evaluation.xml --cwd <project> -- npx tsx src/stdio.ts

# HTTP server
.venv-eval/bin/python <skill>/scripts/evaluation.py evaluation.xml -u http://127.0.0.1:3000/mcp -H "Authorization: Bearer $TOKEN" -o report.md
```

| Option | Values |
|---|---|
| `--era` | `modern` (default; pins 2026-07-28), `legacy`, `auto` |
| `-m` | the Claude model; defaults to `pins.json` → `eval.default_model` |
| `-e KEY=VALUE` | environment variables for a stdio server |
| `-o` | write the report to a file |

The report gives accuracy, per-task duration and tool-call counts, Claude's step summary, and its tool feedback. Act on the feedback: rename unclear tools, add field descriptions, shrink large results, make errors name the next step. Then re-run.

`scripts/test_evaluation.py` tests the harness offline, with a scripted fake Claude against a real in-memory server: `pytest -q scripts/test_evaluation.py`.
