# 用户测试集

只有在内容可以安全提交时，才把用户自有的评测样例放在这里。机密客户测试集应保留在 Git 之外，并在评测运行时通过明确的本地输入路径提供。

## JSONL 格式

每行一个 JSON 对象：

```json
{"id":"case-001","prompt":"Find the latest official information about ...","expected_answer":"...","tags":["web-search"]}
```

- `id`（必填）：稳定的样例 ID。
- `prompt`（必填）：发送给 Agent 的问题。
- `expected_answer`（可选）：用于答案评分的标准答案；如果只评估工具调用、引用或来源质量，可以省略。
- `tags`（可选）：用于分组和筛选的场景标签。

示例文件保持通用，不要加入 API Key、私有 URL、内部对话内容或客户身份信息。
