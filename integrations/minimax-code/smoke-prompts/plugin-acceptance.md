# Installed Plugin acceptance test

Run this test from a temporary directory, not from the repository, to verify that the installed
Plugin does not depend on the project Skill:

```bash
TEST_DIR="/tmp/minimax-code-you-web-test"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"
mcode
```

Paste this exact prompt into the interactive TUI:

```text
请进行插件验收，只使用已安装的 you-web Plugin，不要使用 web_search 或 web_fetch。第一步调用
you-search，查询“Bun official release notes”，返回一个官方 Bun 页面 URL。第二步必须调用
you-contents，读取你刚才返回的其中一个官方 URL。最后报告：实际调用的 namespaced 工具名称、
每次调用的 URL、成功/失败状态，以及 you-contents 返回的页面标题。
```

Pass criteria:

- `you-search` is called and succeeds.
- `you-contents` is called with one of the official URLs returned by `you-search`, and succeeds with
  page content and a title.
- The report contains namespaced MCP tool names such as `...you_search...` and `...you_contents...`.
- No API key, `.env` content, or other credential appears in the repository or test output.

Latest local result (2026-08-24): after replacing the local `YDC_API_KEY` placeholder,
`you-search` succeeded and
returned `https://bun.com/blog`, `https://bun.com/`, and `https://github.com/oven-sh/bun/releases`.
`you-contents` then succeeded for `https://bun.com/blog` and returned the page title `Bun`. Both
calls used the `you-web` namespace; the test did not use `you-free`.

### Actual local test result

The test was run with `mcode` 0.2.1 from the empty directory
`/tmp/minimax-code-you-web-plugin-acceptance` after configuring the local Plugin `mcp.json` with
the user's own Key. The exact tool results were:

| Step | Namespaced tool | Input | Result |
| --- | --- | --- | --- |
| 1 | `mcp__you_web_h186b429e2ac0153e67bd__you_search_hfc37ad83aad3131832cf` | `Bun official release notes` | ✅ Success; returned official Bun URLs |
| 2 | `mcp__you_web_h186b429e2ac0153e67bd__you_contents_hbbb8418d4083cdd2f06f` | `https://bun.com/blog` | ✅ Success; title `Bun` |

No `you-free`, `web_search`, or `web_fetch` tool was called. The Key value is intentionally not
included in this report.

If either call fails with an authentication error, check the local `mcp.json` configuration
described in [`../plugin/README.md`](../plugin/README.md), restart `mcode`, and rerun the test. Do
not add the key to this repository.
