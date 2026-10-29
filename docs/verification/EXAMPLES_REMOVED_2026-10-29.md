# 示例库移除验证记录（2026-10-29）

## 范围

规格 **0.7.4** / 扩展 **v1.5.1**：完全移除「示例库（按项目隔离）」产品能力。

### 已删前端

- 侧边栏「采集示例」「收录当前图片的标注」
- 「示例库（按项目隔离）」区块、「刷新示例」、空态文案、收录确认弹窗
- 裁剪遮罩采集流、`PANEL_EXAMPLES_*` / `PANEL_COLLECT_PREVIEW` / `REFERENCE_CAPTURE` / `ANNOTATION_COLLECT`

### 已删后端

- `POST /api/examples/collect|list|delete`
- `POST /api/references`
- `ai_service` 中示例读写与 few-shot 附图装配

### 保留

- 「当前图片已有标注，插件不会覆盖。请选择空标注图片。」状态提示
- YOLO 预标注、模拟测试、M5.5 权重切换与 `model.names` 展示
- 磁盘上已有 `server/references/` 用户数据（不删除）

## 备份

`D:\AI-Annotation-Assistant-bak-20261029-174447`

## 自测（本机真实输出，Asia/Shanghai）

### Node（extension）

命令：

```text
node --test extension/extension.test.cjs extension/platform.test.cjs extension/platform-content.test.cjs extension/sidepanel.test.cjs
```

结果：`tests 53` / `pass 53` / `fail 0` / `exit 0`（约 32s，2026-10-29 17:57 附近）

### Python（server）

命令：

```text
D:\YoloWebAgentStarter\.venv\Scripts\python.exe -m unittest server.test_api server.test_ai server.test_yolo_service_unit -v
```

结果：`Ran 33 tests in 4.310s` / `OK` / `exit 0`

### HTTP smoke（对已在跑的 127.0.0.1:18000）

| 请求 | 结果 |
|------|------|
| `GET /health` | 200 `{"status":"ok",...}` |
| `GET /api/ai/status` | 200（YOLO 状态） |
| `GET /api/yolo/models` | 200（模型列表） |
| `GET/POST /api/examples/*`、`/api/references` | **404**（路由已不存在） |

说明：当时监听进程为 PID 21324（`Python314\python.exe`，启动约 17:42）。示例库路由均 404，与代码删除一致。未做 Edge×GPU 端到端。

## 未删除的用户数据

`server/references/` 仍保留 3 个子目录及 `examples.json`/jpg，代码不再读写。

## 文档

- `docs/spec.md` → 0.7.4；`extension/manifest.json` → 1.5.1
- README、M5_3/setup/platform-adapter/ai-setup 已标注移除并保留历史说明段落
