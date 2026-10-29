# -*- coding: utf-8 -*-
"""M5.2: train Ultralytics YOLO detect using an existing venv (no install)."""
from __future__ import annotations

import argparse
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser(description="Train YOLO detect for FramePilot M5.2")
    p.add_argument(
        "--data",
        default=r"server\datasets\install_parts_seed\data.yaml",
        help="path to data.yaml",
    )
    p.add_argument("--model", default="yolov8n.pt", help="base weights")
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--batch", type=int, default=8)
    p.add_argument("--device", default="0")
    p.add_argument("--project", default=r"server\runs")
    p.add_argument("--name", default="install_parts_seed_v1")
    args = p.parse_args()

    data = Path(args.data)
    if not data.is_file():
        raise SystemExit(f"data.yaml not found: {data}")

    from ultralytics import YOLO

    model = YOLO(args.model)
    model.train(
        data=str(data.resolve()),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        project=str(Path(args.project).resolve()),
        name=args.name,
        exist_ok=True,
    )
    print("TRAIN_DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
