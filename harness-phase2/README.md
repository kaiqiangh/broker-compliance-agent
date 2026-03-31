# Harness Phase 2 Experiment

Phase 2 feature development — Generator-Evaluator harness 自动任务循环。

## 文件结构

```text
harness-phase2/
├── orchestrator.md     # 运行指南
├── queue.json          # 任务队列（11 个 Phase 2 任务，P2-9 已完成跳过）
├── state.json          # 进度追踪
├── logs/               # 每个任务的详细日志
│   ├── _template.json  # 日志模板
│   ├── task-P2-1.json  # 实验运行后生成
│   └── ...
└── README.md           # 本文件
```

## 任务列表

| ID    | 任务                   | 依赖   | 预估 |
| ----- | ---------------------- | ------ | ---- |
| P2-1  | Auto-Execute UI + Undo | 无     | 3h   |
| P2-2  | Learning Feedback Loop | 无     | 3h   |
| P2-3  | Fuzzy Matching 增强    | 无     | 2h   |
| P2-4  | 通知偏好设置           | Schema | 2.5h |
| P2-5  | OCR 激活               | npm    | 1.5h |
| P2-6  | Dashboard Charts 完善  | 无     | 2.5h |
| P2-7  | CSV Export             | 无     | 1.5h |
| P2-8  | Email Threading 增强   | 无     | 2h   |
| P2-10 | IMAP 直连              | npm    | 7h   |
| P2-11 | 安全审计               | 无     | 2h   |
| P2-12 | 性能优化               | 无     | 2h   |

P2-9 (高级提取模板) 已在 Phase 1 完成，跳过。
P2-13 (准确率基线) 依赖 30 封真实邮件（需 Kai 提供），不在 harness 队列中。

## 实验流程

1. Orchestrator 读取 queue.json + state.json
2. 对每个 pending 任务:
   - sessions_spawn Generator（一次性 subagent）
   - Generator 做任务 + 返回结果
   - Orchestrator eval（跑验收命令）
   - PASS → 标记 done，下一个
   - FAIL → 带 feedback 重试（最多 3 次）
   - 3 次都 FAIL → ESCALATE
3. 所有任务完成 → 生成报告

## 文档

- 开发计划：`docs/PHASE-2-PLAN.md`
- PRD：`docs/PRD-AI-AGENT-v2.md`
- ENG：`docs/ENG-DESIGN-AI-AGENT-v2.md`
- ADR：`docs/ADR-AI-AGENT.md`
