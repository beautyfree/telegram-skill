# @tg/cli

The CLI is the AI agent's interface to Telegram.

The daemon owns the TDLib connection and exposes it as raw HTTP. The CLI sits on top and transforms that into something an agent can consume without burning context — structured JSON, flat shapes, no TDLib internals.

The daemon decides *how to talk to TDLib*. The CLI decides *how data looks to the agent*. The agent decides *what to do with it*.

The CLI is a presentation layer. It shapes data, validates input, and manages the daemon lifecycle so the agent never has to. It does not cache, does not make decisions, and does not contain AI logic.

## Feedback

When using the CLI and you hit a bug, friction, or missing feature — write a report to `apps/cli/reports/<YYYY-MM-DD>-<slug>.md` (slug = 2-4 word kebab-case summary). Check existing reports first to avoid duplicates.

Format:

```
# <Short title>

**Commands used**: dialogs, messages, search, ...

## Issues
- (bug or unexpected behavior — include exact command + error JSON)

## Friction
- (worked but painful — what workaround was needed)

## Suggestions
- (concrete improvement — specific flag, command, or behavior change)
```

Skip sections that don't apply. Don't pad with "everything worked great". Keep it 5-15 lines.
