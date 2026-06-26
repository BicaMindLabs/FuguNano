# Agent Team — multi-model planning + hierarchical sub-agents

Two plays: (1) use multiple models to **plan in parallel**, and (2) split into **sub-agents** under a team. Both are workable; the key is **picking the right substrate**.

## Two Substrates

| Substrate                                      | Top-level cross-model                                            | Hierarchy / sub-agent                                                                                        | Multi-model source                                                      | Practicality                                    |
| ---------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------- |
| **fugue runtime profiles** (parallel dispatch) | Yes — each logical profile resolves to `fugue-cc`/Codex/OpenCode | Members can spawn their own sub-agents only if their native runtime supports it; provider nesting is fragile | `AgentRegistry`, `--harness`, and provider config                       | Strong at deterministic top-level orchestration |
| **Native subagent route**                      | Custom agents through the host agent's tool system               | The host agent's native subagent feature may support hierarchy                                               | Existing custom agents like `cn-dispatch` or `codex-rescue`, if present | Best when the host agent owns team hierarchy    |

**Key**: if a machine already has custom subagent types such as `cn-dispatch` or `codex-rescue`, the host agent's native team system can be a natural "multi-model + hierarchical" route. fugue stays strongest as the deterministic execution layer: dispatch, cache, integrate, review, and loop state.

## (1) Multi-Model Planning (planning panel)

Send "decompose the goal" to several vendors at once, get different perspectives, then synthesize. Two routes:

- **fuguectl route** (this repo's tooling):
  ```bash
  fuguectl plan "<goal>" --models cc-deepseek,cc-kimi,coder
  # Each model Writes its decomposition to .fuguectl-cache/plans/<model>.plan.md; the planner synthesizes into Phase 1
  ```
- **Native route** (host agent subagent tool): the planner spawns N subagents in parallel, each with a different custom agent or model hint, each producing one decomposition, and the planner synthesizes.

Synthesis = the planner (you/Claude) reads the N plans, takes the intersection + fills the blind spots, and sets the final plan. This is the **design panel** pattern (research shows it is more complete than single-track planning).

## (2) Sub-Agents Under a Team (hierarchy)

**The realistic 2-layer structure** (strong enough; don't chase arbitrary nesting):

```
Top team:   planner
            |- Member A = cn-dispatch -> Chinese model (implements subtasks)
            |- Member B = codex-rescue -> Codex (review/hard problems)
            \- Member C = Explore -> read-only search
   When a member's task is complex (the member is itself a full agent loop):
            Member A -- spawns its own sub-agent for further decomposition
```

- The top level uses the host agent's subagent tool to spawn members (`subagent_type` picks cn-dispatch / codex-rescue / Explore / general-purpose where available).
- If a member is a full agent, it can spawn sub-agents internally (hierarchy +1).
- For **deterministic orchestration** (parallel dispatch/pipeline/loop) use the `Workflow` tool: `agent(prompt, {agentType:'cn-dispatch'})` points a member at a Chinese model; `pipeline()` chains "implement -> review".

## Honest Constraints (avoid the traps)

1. **Native subagents usually inherit the host model by default**; for multi-model you need explicit custom agents, a Bash bridge, or fugue runtime profiles.
2. **Some workflow engines allow only shallow nesting**. For deeper teams, use the host agent's native subagent-spawning-subagent path when it exists.
3. **Provider nesting** (dispatching again through the fugue-cc provider from inside a fugue-cc agent) is unverified and fragile — don't use it.
4. **Honor no-Gemini**: no team member/reviewer routes to Gemini (agy = Gemini, frontend implementation only, does not enter team review).

## Which to Pick

| Scenario                                                                              | Use                                                                                |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Real parallel **implementation** (multi-file, each with its own worktree, persistent) | **fugue runtime profiles** (`fugue-cc` worktrees plus Codex/OpenCode where useful) |
| **Hierarchical team / sub-agent orchestration**                                       | Host-native subagents plus custom model bridges, when available                    |
| Multi-model **planning**                                                              | Either works (`fuguectl plan` or native parallel subagents)                        |
| Cross-model **review**                                                                | independent Codex/non-Gemini reviewer profile                                      |

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

The store lives in `${FUGUNANO_STATE:-~/.config/fugunano}/experience/<ws>/` (not in the repo, accumulated at runtime). This is isomorphic to Leo's habit of "distilling skills" — completed work settles into a reusable method. `FUGUE_STATE` remains a compatibility fallback for existing local setups.
