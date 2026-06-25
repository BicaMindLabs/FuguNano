# Agent Team — multi-model planning + hierarchical sub-agents

Two plays: (1) use multiple models to **plan in parallel**, and (2) split into **sub-agents** under a team. Both are workable; the key is **picking the right substrate**.

## Two Substrates

| Substrate                                | Top-level cross-model                                  | Hierarchy / sub-agent                                                                                              | Multi-model source                                                                              | Practicality                                     |
| ---------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **fugue-cc fleet** (this repo's parallel dispatch) | Yes — each fugue-cc agent = an independent CC instance | Members can spawn their own sub-agents, but **same model**; nesting again through the provider is **very fragile** | 9 vendors in provider config                                                                    | Strong at top level, weak when nested            |
| **Claude Code native subagent**          | Custom agents via the Bash bridge                      | The `Agent` tool natively supports spawning sub-agents + hierarchy                                                 | **Already-existing** custom agents like `cn-dispatch` (Chinese models) / `codex-rescue` (Codex) | **The right substrate for hierarchy/sub-agents** |

**Key**: this machine already has `cn-dispatch` (routes Chinese models) and `codex-rescue` (hands off to Codex), two custom subagent types. So Claude Code's native Agent system + these two = a natural "multi-model + hierarchical" team, cleaner than forcing provider nesting.

## (1) Multi-Model Planning (planning panel)

Send "decompose the goal" to several vendors at once, get different perspectives, then synthesize. Two routes:

- **fuguectl route** (this repo's tooling):
  ```bash
  fuguectl plan "<goal>" --models cc-deepseek,cc-kimi,coder
  # Each model Writes its decomposition to .fuguectl-cache/plans/<model>.plan.md; the planner synthesizes into Phase 1
  ```
- **Native route** (Claude Code Agent tool): the planner spawns N subagents in parallel, each with `agentType: cn-dispatch` (carrying a different model hint) or a different custom agent, each producing one decomposition, and the planner synthesizes.

Synthesis = the planner (you/Claude) reads the N plans, takes the intersection + fills the blind spots, and sets the final plan. This is the **design panel** pattern (research shows it is more complete than single-track planning).

## (2) Sub-Agents Under a Team (hierarchy)

**The realistic 2-layer structure** (strong enough; don't chase arbitrary nesting):

```
Top team:   planner(Claude)
            |- Member A = cn-dispatch -> Chinese model (implements subtasks)
            |- Member B = codex-rescue -> Codex (review/hard problems)
            \- Member C = Explore -> read-only search
   When a member's task is complex (the member is itself a full agent loop):
            Member A -- spawns its own sub-agent for further decomposition
```

- The top level uses the `Agent` tool to spawn members (`subagent_type` picks cn-dispatch / codex-rescue / Explore / general-purpose).
- If a member is a full agent, it can spawn sub-agents internally (hierarchy +1).
- For **deterministic orchestration** (parallel dispatch/pipeline/loop) use the `Workflow` tool: `agent(prompt, {agentType:'cn-dispatch'})` points a member at a Chinese model; `pipeline()` chains "implement -> review".

## Honest Constraints (avoid the traps)

1. **Native subagents run Claude by default**; for multi-model you can only go through Bash-bridge custom agents (`cn-dispatch`/`codex-rescue`).
2. **`Workflow` nesting is allowed only 1 level deep** (calling `workflow()` again inside a child workflow throws). For more depth use the `Agent` tool's subagent-spawning-subagent.
3. **Provider nesting** (dispatching again through the fugue-cc provider from inside a fugue-cc agent) is unverified and fragile — don't use it.
4. **Honor no-Gemini**: no team member/reviewer routes to Gemini (agy = Gemini, frontend implementation only, does not enter team review).

## Which to Pick

| Scenario                                                                              | Use                                                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Real parallel **implementation** (multi-file, each with its own worktree, persistent) | **fugue-cc fleet** (this repo's parallel dispatch + cache/barrier)           |
| **Hierarchical team / sub-agent / deterministic orchestration**                       | **Claude Code native** (Agent tool + cn-dispatch/codex + Workflow) |
| Multi-model **planning**                                                              | Either works (`fuguectl plan` or native parallel subagents)          |
| Cross-model **review**                                                                | `coder`(Codex); never Gemini                                       |

> See the example in `orchestration/agent-team/team-review.workflow.mjs` (a Workflow script: plan panel -> cross-model implementation -> Codex review, deterministic orchestration).

## Landed: Workspace context isolation (inspired by Zleap-Agent)

Zleap's "don't feed a small model all the context" has landed in this repo: `orchestration/fuguectl/workspaces/*.workspace` define workstations (main/code/sql/chinese/review/web), and `fuguectl workspace context <name>` assembles, per **Context = System + Workspace + Tools + Memory + History**, the layered context that workstation **and only it should see**:

```bash
fuguectl workspace list                       # list workstations
fuguectl workspace context code --task "..."   # view the code workstation's layered context
fuguectl dispatch cc-minimax --workspace code --template impl --set ...  # prefix-inject on dispatch
```

Each workstation binds: a dedicated prompt + enabled tools + memory scope + bench-recommended model (`models: @bench:code` auto-routes through allocation). This upgrades `allocation.tsv` (model mapping only) into a full **context profile** — a weak model is no longer drowned by the full tool/memory/rule set on each subtask. Zleap has no license + a heterogeneous stack, so **we only borrow the idea, implementing the code independently**.

### Experience memory (the "experience" of Zleap's tripartite memory)

Task completes -> distill the reusable method -> sanitize -> store per workstation -> **auto-replay** into the Memory segment of future similar tasks' workspace context:

```bash
echo "use a defensive copy to avoid mutating the input range" | fuguectl experience add code "defensive-copy trick"   # sanitization gate (plaintext keys rejected)
fuguectl experience recall code              # recall this workstation's experience
fuguectl workspace context code              # the Memory segment has auto-injected the experience above
```

The store lives in `${FUGUE_STATE:-~/.config/fugue}/experience/<ws>/` (not in the repo, accumulated at runtime). This is isomorphic to Leo's habit of "distilling skills" — completed work settles into a reusable method.
