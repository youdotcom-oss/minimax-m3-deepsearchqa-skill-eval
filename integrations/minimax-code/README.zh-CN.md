# MiniMax Code 集成

仓库提供了项目级 Skill：`.minimax/skills/you-web/SKILL.md`。用 MiniMax Code 打开本仓库时，可以加载该 Skill。

可移植 Plugin 的安装、本地鉴权和 `mcode` 使用方式见 [`plugin/README.md`](plugin/README.md)。

## MCP 配置

本项目只使用 You.com 的两个 MCP 工具：

```text
https://api.you.com/mcp?tools=you-search,you-contents
```

请按照 [`plugin/README.md`](plugin/README.md) 安装 Plugin，然后把本地 Plugin MCP 配置中的
`YDC_API_KEY` 占位符替换成自己的 Key。不要把 Key 或机器相关的 MCP 配置提交到仓库。

## Smoke Test

1. 用 MiniMax Code 打开本仓库。
2. 确认项目 Skill `.minimax/skills/you-web/SKILL.md` 已加载。
3. 确认可以看到 `you-search` 和 `you-contents`。
4. 依次运行 `smoke-prompts/search.md` 和 `smoke-prompts/contents.md` 中的提示词。

要从任意目录验收已安装的 Plugin，请运行交互式 `mcode`，并粘贴
[`smoke-prompts/plugin-acceptance.md`](smoke-prompts/plugin-acceptance.md) 中的完整查询文本。
最近一次本机测试已确认完整的已安装 Plugin 流程：`you-search` 和 `you-contents` 均通过
`you-web` 命名空间成功调用，`you-contents` 返回页面标题 `Bun`。

预期结果：模型先搜索来源，再至少读取一个页面，最后输出带引用和来源列表的简洁答案。

如果工具缺失，先检查 MCP URL 和本地认证，不要通过编造搜索结果来绕过缺失的工具。
