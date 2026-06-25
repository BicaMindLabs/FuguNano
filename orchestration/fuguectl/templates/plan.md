Your role: planner ({{MODEL}}). Decompose the goal below into a plan of subtasks that can run in parallel.

Goal: {{GOAL}}

Requirements:
1. List 3-6 subtasks, each annotated: scope (one sentence) + suggested implementer model (by each model's strength) + files to change
2. Mark dependencies/ordering (write out what must be serial); the rest defaults to parallel
3. Give 1 acceptance point per subtask
4. End with one "overall acceptance gate" (a runnable command, e.g. `pytest -q && npm run build`)

Output: **must use the Write tool to write to {{OUTFILE}}** (NOT chat! chat gets lost), Markdown.
