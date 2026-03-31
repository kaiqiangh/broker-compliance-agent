# Harness Experiment

Generator-Evaluator harness 自动任务循环实验。

## 文件结构

```text
harness/
├── queue.json          # 任务队列（7 个 Phase 1 剩余任务）
├── state.json          # 进度追踪
├── logs/               # 每个任务的详细日志
│   ├── _template.json  # 日志模板
│   ├── task-RLS.json   # 实验运行后生成
│   └── ...
└── README.md           # 本文件
```

## 任务列表

| ID          | 任务                                       | 复杂度 |
| ----------- | ------------------------------------------ | ------ |
| RLS         | RLS policies for 6 agent tables            | 中     |
| RATE-LIMIT  | Rate limiting for agent endpoints          | 低     |
| DETAIL-PAGE | Action detail page /agent/actions/[id]     | 中     |
| NOTIFY      | Agent notification (daily digest + urgent) | 中     |
| E2E         | 5 E2E test scenarios                       | 中     |
| PII-TEST    | PII integration test                       | 低     |
| LOAD        | Load test (100 emails)                     | 低     |

## 实验流程

1. Orchestrator (Main session) 读取 queue.json
2. 对每个 pending 任务:
   - sessions_spawn Generator（一次性 subagent）
   - Generator 做任务 + 返回结果
   - Orchestrator eval（跑验收命令）
   - PASS → 标记 done，下一个
   - FAIL → 带 feedback 重试（最多 3 次）
   - 3 次都 FAIL → ESCALATE
3. 所有任务完成 → 生成报告

## 观测

- Main session 消息 = 实时 log
- harness/logs/\*.json = 持久化记录
- harness/state.json = 进度看板
