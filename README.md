# dsh-reasoning-pruner

A small DeepSeek Harness (DSH) plugin that removes historical assistant reasoning blocks from ordinary conversation requests before they reach the model.

It does not modify persisted session history. Assistant final answers, system messages, tool calls, tool results, images, attachments, and current-turn reasoning remain intact.

Each outbound model request that has reasoning removed adds a visible `reasoning-pruner` status entry showing how many historical reasoning blocks and estimated tokens were omitted.

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
