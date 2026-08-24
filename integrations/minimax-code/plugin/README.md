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

The repository's `mcp.json` contains the placeholder `<YDC_API_KEY>`. After copying the Plugin,
replace that placeholder only in the local file `~/.minimax/plugins/you-web/mcp.json`:

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

Never commit the real value or copy `.env` into the repository. Restart `mcode` after changing
authentication.

## Use the Plugin

The Plugin works from any working directory. Start the interactive TUI, for example:

```bash
mkdir -p /tmp/minimax-code-you-web-test
cd /tmp/minimax-code-you-web-test
mcode
```

Then ask:

```text
请进行插件验收，只使用已安装的 you-web Plugin，不要使用 web_search 或 web_fetch。第一步调用
you-search，查询“Bun official release notes”，返回一个官方 Bun 页面 URL。第二步必须调用
you-contents，读取你刚才返回的其中一个官方 URL。最后报告：实际调用的 namespaced 工具名称、
每次调用的 URL、成功/失败状态，以及 you-contents 返回的页面标题。
```

Use the interactive TUI for end-to-end MCP validation. In MiniMax Code 0.2.1, `mcode exec` is a
headless mode and does not expose the same external MCP tool surface.

## Local acceptance test

For end-to-end validation, use the reproducible prompt in
[`../smoke-prompts/plugin-acceptance.md`](../smoke-prompts/plugin-acceptance.md).
It checks both tools from an empty temporary working directory. The acceptance report must
distinguish Plugin/tool loading from upstream authentication. The latest local run used the
`you-web` namespace for both calls after replacing the placeholder: `you-search` returned official
Bun URLs and `you-contents` successfully returned page content with the title `Bun`.
