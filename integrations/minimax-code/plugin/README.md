# You.com Web Search for MiniMax Code

This portable MiniMax Code Plugin provides the `you-web` Skill and connects the You.com MCP server.
It exposes `you-search` and `you-contents`.

## Install from this repository

MiniMax Code 0.2.1 discovers local Plugins from `~/.minimax/plugins`. From the repository root:

```bash
PLUGIN_ROOT="${HOME}/.minimax/plugins"
mkdir -p "$PLUGIN_ROOT"
rsync -a integrations/minimax-code/plugin/ "$PLUGIN_ROOT/you-web/"
mcode plugin enable you-web@local
mcode plugin list
```

The final command should show `you-web@local` as enabled. Restart `mcode` after installing or
updating the Plugin so it reloads the MCP configuration and Skill.

The current CLI does not accept a local filesystem path in `mcode plugin add`; copying the
directory into the local Plugin marketplace is the supported local-development workflow.

## Configure authentication locally

Do not put an API key in this directory, in `plugin.json`, or in a committed MCP file. Configure
the key in the host-local MiniMax MCP configuration. For the You.com MCP endpoint, use the Bearer
header:

```json
{
  "mcpServers": {
    "you-web": {
      "type": "streamable-http",
      "url": "https://api.you.com/mcp?tools=you-search,you-contents",
      "headers": {
        "Authorization": "Bearer <YDC_API_KEY>"
      }
    }
  }
}
```

Replace `<YDC_API_KEY>` only in the local file. Never commit the real value or copy `.env` into
the Plugin directory. Restart `mcode` after changing authentication.

## Use the Plugin

The Plugin works from any working directory. Start the interactive TUI, for example:

```bash
mkdir -p /tmp/minimax-code-you-web-test
cd /tmp/minimax-code-you-web-test
mcode
```

Then ask:

```text
Use the installed you-web Plugin. Call you-search to find the official Bun release notes, then
call you-contents on one official result. Report the actual tool names, URLs, and whether each
call succeeded. Do not use built-in web tools.
```

Use the interactive TUI for end-to-end MCP validation. In MiniMax Code 0.2.1, `mcode exec` is a
headless mode and does not expose the same external MCP tool surface.

## Local acceptance test

Use the reproducible prompt in [`../smoke-prompts/plugin-acceptance.md`](../smoke-prompts/plugin-acceptance.md).
It checks both tools from an empty temporary working directory. Expected results are a successful
`you-search` call and a successful `you-contents` call returning page content.
