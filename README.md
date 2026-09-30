# dsh-reasoning-pruner

A small DeepSeek Harness (DSH) plugin that removes historical assistant reasoning blocks from ordinary conversation requests before they reach the model.

It does not modify persisted session history. Assistant final answers, system messages, tool calls, tool results, images, attachments, and current-turn reasoning remain intact.

Each outbound model request that has reasoning removed adds a visible `reasoning-pruner` status entry showing how many historical reasoning blocks and estimated tokens were omitted.

## Purpose

This plugin is for reasoning models running in local setups, with tight context windows. The thinking can be extremely verbose (e.g. for Qwen family models). Retaining every completed reasoning block rapidly consumes the available context. That leaves less room for the current turn's reasoning and answer, or forces the backend to truncate useful history.

Completed reasoning is usually lower-value than the conversation record it produced. The plugin retains user messages, assistant final answers, tool calls and results, and attachments while removing old scratchpad reasoning from the outbound request. This preserves the useful record of the conversation and frees context for the active turn.

## Compatibility

Developed and verified with `@deepseek-ai/dsh` `0.2.0-rc.2`.

## Install

From the npm registry after publication:

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-reasoning-pruner
```

From a local checkout:

```sh
npx @deepseek-ai/dsh plugin --profile web add /absolute/path/to/dsh-reasoning-pruner
```

Start DSH as usual:

```sh
npx @deepseek-ai/dsh web
```

The package declares a DSH bundle, so `dsh plugin add` registers it in the selected profile automatically.

## Behavior

For a request containing:

```text
user 1
assistant reasoning 1
assistant answer 1
user 2
assistant reasoning 2
assistant answer 2
user 3
```

The model receives:

```text
user 1
assistant answer 1
user 2
assistant answer 2
user 3
```

The plugin only handles frozen, session-backed DSH agent-loop requests. It bypasses explicit auxiliary requests such as compaction and session-title generation.

## Cache implications

Pruning changes a request in the middle of its history, so the next request is not a strict append of the previous request. Given a previous request containing:

```text
system
user A
assistant reasoning A
assistant answer A
```

and a later pruned request:

```text
system
user A
assistant answer A
user B
```

a prefix/KV cache can reuse the exact common prefix through `system` and `user A`, provided that the backend supports it and the prefix satisfies its cache length and lifetime requirements. It cannot reuse the old cached sequence from `assistant reasoning A` onward, because the token sequence diverges there.

For the intended local-LLM use case, context capacity takes priority over maximizing cache reuse. The cache behavior is backend-specific and an optimization rather than a guarantee; pruning prevents verbose historical reasoning from repeatedly occupying the limited context window.

## Configuration

The bundle enables itself silently by default:

```yaml
- id: reasoning-pruner
  name: dsh-reasoning-pruner
  config:
    enabled: true
    debug: false
```

Set `enabled: false` in a later profile patch to disable it. Set `debug: true` only for troubleshooting.

## Development

```sh
npm test
npm pack --dry-run
```

## License

Released under the Unlicense. See [UNLICENSE](UNLICENSE).
