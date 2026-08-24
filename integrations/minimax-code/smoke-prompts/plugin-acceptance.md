# Installed Plugin acceptance test

Run this test from a temporary directory, not from the repository, to verify that the installed
Plugin does not depend on the project Skill:

```bash
TEST_DIR="/tmp/minimax-code-you-web-test"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"
mcode
```

Paste this prompt into the interactive TUI:

```text
Use the installed you-web Plugin only. First call you-search with the query "Bun official release
notes". Then call you-contents on https://bun.com/blog. Do not use web_search, web_fetch, or any
other built-in web tool. Report the exact namespaced tool names, each URL, and whether each call
succeeded.
```

Pass criteria:

- `you-search` is called and succeeds.
- `you-contents` is called for `https://bun.com/blog` and succeeds with page content.
- The report contains namespaced MCP tool names such as `...you_search...` and `...you_contents...`.
- No API key, `.env` content, or other credential appears in the repository or test output.

If either call fails with an authentication error, check the host-local MCP configuration described
in [`../plugin/README.md`](../plugin/README.md), restart `mcode`, and rerun the test. Do not add the
key to this repository.
