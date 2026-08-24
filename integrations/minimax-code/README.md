# MiniMax Code integration

This repository includes a project Skill at `.minimax/skills/you-web/SKILL.md`. MiniMax Code can load that Skill when the repository is opened as a workspace.

For the portable Plugin installation and local `mcode` usage flow, see [`plugin/README.md`](plugin/README.md).

## MCP setup

Configure the host-local You.com MCP server with the two tools used by this project:

```text
https://api.you.com/mcp?tools=you-search,you-contents
```

Use the authentication method supported by your MiniMax Code installation. For bearer authentication, provide `YDC_API_KEY` through local environment or local MCP configuration. Never commit the key or a machine-specific MCP file to this repository.

## Smoke test

1. Open the repository in MiniMax Code.
2. Confirm the project Skill is available from `.minimax/skills/you-web/SKILL.md`.
3. Confirm both `you-search` and `you-contents` are visible.
4. Run the prompts in `smoke-prompts/search.md` and `smoke-prompts/contents.md`.

For a full installed-Plugin acceptance test from an arbitrary directory, use [`smoke-prompts/plugin-acceptance.md`](smoke-prompts/plugin-acceptance.md).

Expected behavior: the agent searches for sources, reads at least one source page, and returns a concise answer with citations and a source list.

If a tool is missing, check the MCP URL and local authentication first. Do not work around a missing tool by inventing search results.
