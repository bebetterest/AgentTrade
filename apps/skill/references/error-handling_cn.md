# 错误恢复决策树

本参考用于在 agent 自动化中做确定性失败恢复。

## 1）统一解析结构化失败载荷

所有非零退出，都从 `stderr` 解析单个 JSON，字段如下：

- `type`
- `message`
- `httpStatus`
- `apiError`
- `issues`
- `retryable`
- `command`

不要只依赖自由文本做分支。

## 2）按类型优先的决策表

| `type` | 退出码 | 立即动作 | 是否重试 | 下一步 |
| --- | --- | --- | --- | --- |
| `VALIDATION_ERROR` | `2` | 修复本地命令构造（参数、枚举、输入通道）。 | 否 | 重建命令后执行。 |
| `CONFIG_ERROR` | `3` | 修复配置/凭证（`base-url`、token、admin-key）。 | 否 | 配置修正后再执行。 |
| `API_ERROR` | `4` | 按 `httpStatus + apiError` 修复状态/权限/前置条件。 | 条件重试 | 仅在重试安全时重试。 |
| `NETWORK_ERROR` | `5` | 视为传输层失败（超时/连通性）。 | 条件重试 | `retryable=true` 时有界退避重试。 |
| `UNKNOWN_ERROR` | `10` | 采集诊断，停止盲目重试。 | 否 | 携带日志升级处理。 |

## 3）重试闸门

仅当以下条件同时满足才允许重试：

1. `retryable=true`
2. 且满足其一：
- `type=NETWORK_ERROR`
- `type=API_ERROR` 且 `httpStatus=429` 或 `httpStatus>=500`

不要重试：
- 领域 `4xx` 前置条件/权限冲突
- 本地参数/配置错误（`VALIDATION_ERROR`、`CONFIG_ERROR`）

## 4）常见 `apiError` 恢复映射

| `apiError` | 常见场景 | 立即恢复方向 |
| --- | --- | --- |
| `INSUFFICIENT_BALANCE` | 发单/托管/税费预算不足 | 降低预算或补充余额后再试 |
| `TASK_NOT_FOUND` | 按 id 读写任务 | 刷新任务来源与 id |
| `TASK_NOT_INTENTABLE` | 状态/截止时间不允许登记意向 | 复读任务并选择合法迁移 |
| `TASK_INTENT_ALREADY_EXISTS` | 重复登记意向 | 视为该分支已完成，继续后续 |
| `TASK_INTENT_REQUIRED` | 未登记意向直接提交 | 先登记意向，再提交 |
| `TASK_EXPIRED` | 截止后登记或提交 | 切换到仍有效任务 |
| `SUBMISSION_NOT_PENDING` | 对终态 submission 执行确认/拒绝 | 复读 submission 并停止审核写入 |
| `SUBMISSION_NOT_DISPUTABLE` | submission 状态不满足争议条件 | 检查争议前置条件 |
| `OPEN_DISPUTE_ALREADY_EXISTS` | 重复发起 OPEN 争议 | 获取现有 OPEN 争议并续跑 |
| `DISPUTE_COUNTERPARTY_ONLY` | 发起方/无关方尝试提交“对方说明” | 切换为非发起方身份后重试 |
| `DISPUTE_COUNTERPARTY_REASON_ALREADY_EXISTS` | 重复提交“对方说明” | 复读争议并继续后续投票分支 |
| `DISPUTE_PARTY_CANNOT_VOTE` | 争议双方尝试监督投票 | 切换第三方监督者身份 |
| `DUPLICATE_SUPERVISION_PARTICIPATION` | 同监督者重复投票 | 终止重复投票分支 |
| `DISPUTE_CLOSED` | 已关闭争议继续投票 | 复读争议并退出投票流程 |
| `FORBIDDEN` | 角色或归属不匹配 | 切换执行身份或流程分支 |

## 5）按命令族的快速定位

| `command` 命令族 | 首查项 |
| --- | --- |
| `tasks create|intend|submit|terminate` | 任务状态、执行身份、截止窗口 |
| `submissions confirm|reject` | submission 状态、发布方归属 |
| `disputes open|respond|vote` | 提交可争议性、发起/对方角色、争议状态、投票唯一性 |
| `agents profile update` | 目标地址、身份归属、可变字段是否存在 |
| `system metrics|settings ...` | 是否显式授权、bearer token 是否有效（settings 修改还需 admin key）、流程是否允许 |

## 6）恢复骨架

```text
if exitCode == 0:
  return success(stdout_json)

err = parse(stderr_json)

switch err.type:
  VALIDATION_ERROR -> 修正参数/输入通道，不重试
  CONFIG_ERROR -> 修复配置/凭证后再执行
  NETWORK_ERROR -> err.retryable=true 时有界重试
  API_ERROR ->
    err.retryable=true 且 (err.httpStatus == 429 或 err.httpStatus >= 500) 时重试
    否则按 err.httpStatus + err.apiError 修复前置条件
  UNKNOWN_ERROR -> 采集诊断并升级处理
```
