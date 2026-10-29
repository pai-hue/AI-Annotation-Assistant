# -*- coding: utf-8 -*-
"""Prepare an Ultralytics-ready YOLO detect dataset from a site export or folder.

M5.1 helper: does not call the original website. Typical flow is:
1) On the site, click 「导出 YOLO Zip」 for confirmed labels.
2) Run this script on the downloaded zip (or an extracted folder).

Keeps only the standard library so it runs without Ultralytics installed.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import shutil
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


@dataclass
class Pair:
    stem: str
    image: Path
    label: Path | None


def _is_image(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_EXTS


def _read_classes(path: Path) -> list[str]:
    lines = [ln.strip() for ln in path.read_text(encoding="utf-8").splitlines()]
    names = [ln for ln in lines if ln and not ln.startswith("#")]
    if not names:
        raise ValueError(f"classes file is empty: {path}")
    return names


def _find_classes_file(root: Path) -> Path:
    # Site export uses labels.txt; Ultralytics-style uses classes.txt.
    preferred = [
        root / "classes.txt",
        root / "labels.txt",
        root / "data" / "classes.txt",
        root / "data" / "labels.txt",
    ]
    for path in preferred:
        if path.is_file():
            return path
    for pattern in ("classes.txt", "labels.txt"):
        hits = sorted(root.rglob(pattern))
        # Prefer root-level names over per-image label files wrongly named.
        hits = [h for h in hits if h.parent == root or h.parent.name in {"data", "meta"}]
        if hits:
            return hits[0]
        # Fall back: a lone labels.txt that is not inside labels/
        for h in sorted(root.rglob(pattern)):
            if h.name == "labels.txt" and h.parent.name == "labels":
                continue
            if h.name == "classes.txt" or h.parent.name != "labels":
                return h
    raise FileNotFoundError(
        "找不到 classes.txt / labels.txt。请确认导出包内含类别表，或用 --classes 指定路径。"
    )


def _normalize_label_line(line: str, class_count: int, source: str) -> str:
    parts = line.split()
    if len(parts) < 5:
        raise ValueError(f"非法 YOLO 行（字段不足）@ {source}: {line!r}")
    try:
        class_id = int(float(parts[0]))
        vals = [float(x) for x in parts[1:5]]
    except ValueError as exc:
        raise ValueError(f"非法 YOLO 行（数值）@ {source}: {line!r}") from exc
    if class_id < 0 or class_id >= class_count:
        raise ValueError(
            f"类别越界 class_id={class_id}（共 {class_count} 类）@ {source}"
        )
    for name, value in zip(("xc", "yc", "w", "h"), vals):
        if not (0.0 <= value <= 1.0):
            raise ValueError(f"{name}={value} 超出 [0,1] @ {source}")
    if vals[2] <= 0 or vals[3] <= 0:
        raise ValueError(f"宽高必须 > 0 @ {source}")
    return f"{class_id} {vals[0]:.6f} {vals[1]:.6f} {vals[2]:.6f} {vals[3]:.6f}"


def validate_label_text(text: str, class_count: int, source: str) -> str:
    lines_out: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        lines_out.append(_normalize_label_line(line, class_count, source))
    return "\n".join(lines_out) + ("\n" if lines_out else "")


def extract_source(source: Path, work: Path) -> Path:
    if source.is_dir():
        return source.resolve()
    if not source.is_file():
        raise FileNotFoundError(f"源路径不存在: {source}")
    if source.suffix.lower() != ".zip":
        raise ValueError("源文件必须是目录或 .zip")
    dest = work / "extracted"
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    with zipfile.ZipFile(source, "r") as zf:
        zf.extractall(dest)
    # If zip contains a single top-level folder, use it.
    children = [p for p in dest.iterdir() if not p.name.startswith("__MACOSX")]
    if len(children) == 1 and children[0].is_dir():
        return children[0]
    return dest


def discover_pairs(root: Path) -> list[Pair]:
    images = [p for p in root.rglob("*") if p.is_file() and _is_image(p)]
    pairs: list[Pair] = []
    seen_stems: set[str] = set()
    for image in sorted(images):
        rel = image.relative_to(root).as_posix()
        if "/labels/" in f"/{rel}":
            continue
        out_stem = image.stem
        if out_stem in seen_stems:
            # Disambiguate rare collisions.
            out_stem = image.with_suffix("").relative_to(root).as_posix().replace("/", "__")
        seen_stems.add(out_stem)
        label_candidates = [
            image.with_suffix(".txt"),
            root / "labels" / (image.stem + ".txt"),
            root / "labels" / image.relative_to(root).with_suffix(".txt"),
        ]
        parts = list(image.relative_to(root).parts)
        for folder in ("images", "imgs", "img", "JPEGImages"):
            if folder in parts:
                idx = parts.index(folder)
                alt = root.joinpath(*parts[:idx], "labels", *parts[idx + 1 :]).with_suffix(
                    ".txt"
                )
                label_candidates.append(alt)
        label = next((c for c in label_candidates if c.is_file()), None)
        pairs.append(Pair(stem=out_stem, image=image, label=label))
    if not pairs:
        raise ValueError(f"在 {root} 下未找到图片")
    return pairs


def split_pairs(pairs: list[Pair], val_ratio: float, seed: int) -> tuple[list[Pair], list[Pair]]:
    if not 0.0 <= val_ratio < 1.0:
        raise ValueError("val_ratio 须在 [0, 1)")
    items = list(pairs)
    rng = random.Random(seed)
    rng.shuffle(items)
    if val_ratio == 0 or len(items) < 2:
        return items, []
    n_val = max(1, int(round(len(items) * val_ratio)))
    n_val = min(n_val, len(items) - 1)
    return items[n_val:], items[:n_val]


def write_dataset(
    pairs_train: list[Pair],
    pairs_val: list[Pair],
    class_names: list[str],
    out_dir: Path,
    source_desc: str,
    seed: int,
    val_ratio: float,
    require_labels: bool,
) -> dict:
    if out_dir.exists():
        shutil.rmtree(out_dir)
    for split in ("train", "val"):
        (out_dir / "images" / split).mkdir(parents=True)
        (out_dir / "labels" / split).mkdir(parents=True)

    stats = {"train": 0, "val": 0, "empty_labels": 0, "skipped_unlabeled": 0}

    def add(split: str, pair: Pair) -> None:
        nonlocal stats
        if pair.label is None:
            if require_labels:
                stats["skipped_unlabeled"] += 1
                return
            label_text = ""
        else:
            label_text = validate_label_text(
                pair.label.read_text(encoding="utf-8"),
                len(class_names),
                str(pair.label),
            )
            if not label_text.strip():
                stats["empty_labels"] += 1
        ext = pair.image.suffix.lower()
        image_name = f"{pair.stem}{ext}"
        shutil.copy2(pair.image, out_dir / "images" / split / image_name)
        (out_dir / "labels" / split / f"{pair.stem}.txt").write_text(
            label_text, encoding="utf-8"
        )
        stats[split] += 1

    for pair in pairs_train:
        add("train", pair)
    for pair in pairs_val:
        add("val", pair)

    if stats["train"] == 0:
        raise ValueError("训练集为空：请检查导出是否包含带标注图片")

    classes_path = out_dir / "classes.txt"
    classes_path.write_text("\n".join(class_names) + "\n", encoding="utf-8")

    # Ultralytics data.yaml (paths relative to this file)
    yaml_lines = [
        f"path: {out_dir.resolve().as_posix()}",
        "train: images/train",
        "val: images/val" if stats["val"] else "val: images/train",
        f"nc: {len(class_names)}",
        "names:",
    ]
    for i, name in enumerate(class_names):
        safe = name.replace("'", "''")
        yaml_lines.append(f"  {i}: '{safe}'")
    (out_dir / "data.yaml").write_text("\n".join(yaml_lines) + "\n", encoding="utf-8")

    manifest = {
        "schema_version": "m5.1",
        "source": source_desc,
        "seed": seed,
        "val_ratio": val_ratio,
        "class_count": len(class_names),
        "classes": class_names,
        "counts": stats,
        "note": "Prepared for Ultralytics YOLO detect; human review still required before production use.",
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def prepare(
    source: Path,
    out_root: Path,
    name: str,
    val_ratio: float,
    seed: int,
    classes_file: Path | None,
    require_labels: bool,
) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9._\-]+", name):
        raise ValueError("数据集名称仅允许字母数字、点、下划线、短横线")
    work = out_root / ".work" / name
    work.mkdir(parents=True, exist_ok=True)
    try:
        root = extract_source(source, work)
        class_names = _read_classes(classes_file) if classes_file else _read_classes(
            _find_classes_file(root)
        )
        pairs = discover_pairs(root)
        train, val = split_pairs(pairs, val_ratio, seed)
        out_dir = out_root / name
        return write_dataset(
            train,
            val,
            class_names,
            out_dir,
            source_desc=str(source.resolve()),
            seed=seed,
            val_ratio=val_ratio,
            require_labels=require_labels,
        )
    finally:
        if work.exists():
            shutil.rmtree(work, ignore_errors=True)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="整理 YOLO Zip/目录为 Ultralytics 训练集")
    p.add_argument("--source", required=True, help="原网站导出的 YOLO Zip 或解压目录")
    p.add_argument("--name", required=True, help="输出数据集名（目录名）")
    p.add_argument(
        "--out",
        default="server/datasets",
        help="输出根目录（默认 server/datasets）",
    )
    p.add_argument("--val-ratio", type=float, default=0.2, help="验证集比例，默认 0.2")
    p.add_argument("--seed", type=int, default=42, help="划分随机种子")
    p.add_argument("--classes", default=None, help="可选：显式指定 classes.txt")
    p.add_argument(
        "--allow-unlabeled",
        action="store_true",
        help="允许没有对应 .txt 的图片（写入空标注）；默认跳过无标注图",
    )
    return p


def main(argv: Iterable[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    try:
        manifest = prepare(
            source=Path(args.source),
            out_root=Path(args.out),
            name=args.name,
            val_ratio=args.val_ratio,
            seed=args.seed,
            classes_file=Path(args.classes) if args.classes else None,
            require_labels=not args.allow_unlabeled,
        )
    except Exception as exc:  # noqa: BLE001 - CLI surface
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    counts = manifest["counts"]
    print(
        "OK "
        f"train={counts['train']} val={counts['val']} "
        f"empty_labels={counts['empty_labels']} "
        f"skipped_unlabeled={counts['skipped_unlabeled']} "
        f"classes={manifest['class_count']}"
    )
    print(f"data.yaml -> {Path(args.out) / args.name / 'data.yaml'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
