# M5.1 训练集导出与整理

日期：2026-10-29  
状态：本机整理工具已实现并通过 4 项单元测试；**尚未**用原网站真实「导出 YOLO Zip」包做过现场验收。

## 结论（调查）

原网站标注页已有按钮：**导出 YOLO Zip**（包内常见为 imgs/ + labels/ + 根目录 labels.txt 类别表，不是 classes.txt）（见 `docs/platform-adapter.md`）。M5.1 第一版**优先使用该导出**，插件不调用网站的保存/导出接口，也不在插件内重做整包导出。

流程：

1. 在原网站完成约 50 张种子图的人工标注（或确认可用的已有标注）。
2. 点击原网站「导出 YOLO Zip」，下载到本机。
3. 用本仓库脚本整理成 Ultralytics 可训练目录。

## 整理命令

在项目根目录：

```powershell
C:\Users\Lenovo\AppData\Local\Programs\Python\Python312\python.exe tools\prepare_yolo_dataset.py --source "C:\Users\Lenovo\Downloads\你的导出.zip" --name seed50 --out server\datasets --val-ratio 0.2 --seed 42
```

成功时打印 `train=` / `val=` 数量，并生成：

```text
server/datasets/<name>/
  classes.txt
  data.yaml
  manifest.json
  images/train|val/
  labels/train|val/
```

`server/datasets/` 已加入 `.gitignore`，不进 Git。

可选：

- `--classes path\to\classes.txt`：导出包缺少类别表时手动指定
- `--allow-unlabeled`：保留无对应 `.txt` 的图片（写空标注）；默认跳过无标注图
- `--val-ratio 0`：不划分验证集（`data.yaml` 的 val 回退到 train）

## 验收

| 项 | 状态 |
| --- | --- |
| 脚本 + 4 项单元测试（扁平目录 / 嵌套 zip / 校验） | 作者自测通过（2026-10-29，Python 3.12） |
| 原网站真实 YOLO Zip 导入一次 | **未做**（需你导出后提供路径） |
| 训练 / YOLO 预标注 | 属 M5.2 / M5.3，未开始 |

## 下一步

你导出 zip 后把路径发我，我帮你跑整理并核对 `manifest.json`；通过后进入 M5.2 本机训练环境。
