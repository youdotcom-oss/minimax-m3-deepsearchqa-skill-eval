# MiniMax Code 集成

仓库提供了项目级 Skill：`.minimax/skills/you-web/SKILL.md`。用 MiniMax Code 打开本仓库时，可以加载该 Skill。

## MCP 配置

本项目只使用 You.com 的两个 MCP 工具：

```text
https://api.you.com/mcp?tools=you-search,you-contents
```

请根据本地 MiniMax Code 版本支持的方式配置认证。使用 Bearer 认证时，通过本地环境或本地 MCP 配置提供 `YDC_API_KEY`。不要把 Key 或机器相关的 MCP 配置提交到仓库。

## Smoke Test

1. 用 MiniMax Code 打开本仓库。
2. 确认项目 Skill `.minimax/skills/you-web/SKILL.md` 已加载。
3. 确认可以看到 `you-search` 和 `you-contents`。
4. 依次运行 `smoke-prompts/search.md` 和 `smoke-prompts/contents.md` 中的提示词。

预期结果：模型先搜索来源，再至少读取一个页面，最后输出带引用和来源列表的简洁答案。

如果工具缺失，先检查 MCP URL 和本地认证，不要通过编造搜索结果来绕过缺失的工具。
