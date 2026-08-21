# MiniMax M3 DeepSearchQA Skill Eval

这是一个用于评估 Agent 搜索能力的公开项目，包含 You.com 的 `you-search` 和 `you-contents` 工作流，以及 Google DeepSearchQA 的评测管线。

## MiniMax Code 快速开始

项目级 Skill 位于 `.minimax/skills/you-web/SKILL.md`。用 MiniMax Code 打开仓库后，按 [MiniMax Code 集成说明](integrations/minimax-code/README.zh-CN.md) 配置本地 You.com MCP，并运行 smoke prompts。

MCP 配置使用：

```text
https://api.you.com/mcp?tools=you-search,you-contents
```

认证信息必须保存在本地环境或本地配置中，不要提交 API Key、客户数据或内部测试信息。

## 用户测试集

用户自有的安全测试样例格式见 [datasets/user/README.zh-CN.md](datasets/user/README.zh-CN.md)，示例位于 `datasets/user/examples/example.jsonl`。机密客户测试集应保留在 Git 之外。

## 评测命令

在已安装 Bun 的环境中：

```sh
bun install
bun run check
FORCE=1 LIMIT=1 K=1 CONCURRENCY=1 bun run eval
```

完整的生成、评分和上传说明见英文 [README.md](README.md)。生成文件位于本地 `data/`，默认不会提交。

## 公开范围

仓库不包含客户背景、私有测试用例、API Key 或内部沟通记录。公开数据集的来源和许可证说明放在 `datasets/public/`。
