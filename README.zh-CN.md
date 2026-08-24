# MiniMax M3 DeepSearchQA Skill Eval

这是一个用于评估 Agent 搜索能力的公开项目，包含 You.com 的 `you-search` 和 `you-contents` 工作流，以及 Google DeepSearchQA 的评测管线。

## 项目概览

项目从 DeepSearchQA 任务开始，经过提示词生成、Agent 执行、评分和结果发布，形成完整的评测闭环：

```text
DeepSearchQA 数据集
        │
        ▼
scaffold ──► prompts.jsonl ──► generate ──► trajectories.jsonl
                                                │
                                                ▼
                                      grade ──► graded.jsonl + summary.json
                                                │
                                                ▼
                                      export/upload ──► 公开评测产物
```

## 仓库结构

```text
.
├── src/                              Agent 适配器、grader、MCP/session 集成
├── scripts/                          scaffold、生成、评分、导出、下载、查询、上传
├── datasets/
│   ├── public/                       公开数据集来源与说明
│   └── user/                         用户测试集格式与安全示例
├── integrations/minimax-code/
│   ├── README.zh-CN.md               MiniMax Code 配置与 smoke test
│   ├── plugin/                       可移植的 you-web Plugin
│   └── smoke-prompts/                搜索、内容读取和 Plugin 验收提示词
├── .minimax/skills/you-web/          项目级 MiniMax Code Skill
├── data/                             本地生成产物，不提交
├── package.json                      Bun 脚本和依赖
└── README.md                         项目说明、结果、复现和发布文档
```

项目级 Skill 只在打开本仓库时加载；可移植 Plugin 安装后可以从任意工作目录使用。两者包含
相同的 `you-web` 工作流。

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
OPENROUTER_API_KEY=... YDC_API_KEY=... \
  FORCE=1 LIMIT=1 K=1 CONCURRENCY=1 bun run eval
```

也可以先运行代码检查：

```sh
bun run check
```

完整的生成、评分和上传说明见英文 [README.md](README.md)。生成文件位于本地 `data/`，默认不会提交。

## 公开范围

仓库不包含客户背景、私有测试用例、API Key 或内部沟通记录。公开数据集的来源和许可证说明放在 `datasets/public/`。
