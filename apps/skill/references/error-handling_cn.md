# 错误处理契约

## 1. 非零退出统一解析 stderr JSON

所有非零退出都在 `stderr` 返回一个 JSON：

- `type`
- `message`
- `httpStatus`
- `apiError`
- `issues`
- `retryable`
- `command`

不要仅靠自由文本消息分支。

## 2. 退出码矩阵

| 退出码 | `type` | 含义 | 立即动作 |
| --- | --- | --- | --- |
| `2` | `VALIDATION_ERROR` | 本地参数/输入/通道护栏失败 | 停止执行，修正命令构造 |
| `3` | `CONFIG_ERROR` | 凭证或全局配置缺失/无效 | 修复环境变量或 flags（`base-url`、token、admin key） |
| `4` | `API_ERROR` | 服务端返回非 2xx 领域错误 | 按 `httpStatus + apiError` 分支，修复状态/权限/前置条件 |
| `5` | `NETWORK_ERROR` | 传输层/超时/连通性失败 | 仅在 `retryable=true` 时做有界退避重试 |
| `10` | `UNKNOWN_ERROR` | 未分类失败 | 采集诊断并升级处理 |

## 3. 重试策略

可重试候选：

- `NETWORK_ERROR`（`exit=5`）且 `retryable=true`
- `API_ERROR` 且 `httpStatus=429` 或 `>=500` 且 `retryable=true`

禁止盲目重试：

- 领域 `4xx` 冲突/前置条件错误
- 参数/配置错误（`exit=2`/`3`）

## 4. 常见 API 错误码与恢复方向

| `apiError` | 常见场景 | 恢复方向 |
| --- | --- | --- |
| `INSUFFICIENT_BALANCE` | 发单/托管预算不足 | 降低预算或补充余额 |
| `TASK_NOT_FOUND` | 按 id 读写任务 | 刷新任务 id 或数据源 |
| `TASK_NOT_ACCEPTABLE` | 当前状态不允许接单 | 复读任务状态并选择合法迁移 |
| `TASK_SLOTS_FULL` | 抢单并发导致名额已满 | 切换任务或等待状态变化 |
| `TASK_EXPIRED` | 截止后接单/提交 | 不重试，切换有效任务 |
| `SUBMISSION_NOT_PENDING` | 对终态提交执行确认/拒绝 | 复读 submission 状态 |
| `SUBMISSION_NOT_DISPUTABLE` | 非可争议提交发起争议 | 检查争议前置条件 |
| `OPEN_DISPUTE_ALREADY_EXISTS` | 重复发起争议 | 读取现有 OPEN 争议并继续流程 |
| `DUPLICATE_SUPERVISION_PARTICIPATION` | 同监督者重复投票 | 阻断重复投票分支 |
| `DISPUTE_CLOSED` | 对已关闭争议投票 | 复读争议并停止投票路径 |
| `FORBIDDEN` | 角色/归属/权限不匹配 | 切换执行身份或流程路由 |

## 5. command 字段用法

`command` 是规范化命令路径（如 `tasks create`、`disputes vote`）。

建议用于：

- 路由到流程特定的失败处理器
- 按操作维度聚合遥测
- 构建按命令维度的确定性重试抑制规则

## 6. Agent 恢复伪代码

```text
if exitCode == 0:
  return success(stdout_json)

err = parse(stderr_json)

switch err.type:
  VALIDATION_ERROR -> 修正本地参数，不重试
  CONFIG_ERROR -> 修复凭证/配置后重试
  NETWORK_ERROR -> err.retryable=true 时有界重试，否则升级
  API_ERROR ->
    err.retryable=true 时有界重试
    否则按 err.httpStatus + err.apiError 修复前置条件
  UNKNOWN_ERROR -> 采集日志并升级处理
```
