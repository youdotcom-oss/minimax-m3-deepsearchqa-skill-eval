#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "huggingface_hub[hf_xet]>=0.32.0",
# ]
# ///
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

DEFAULT_REPO = "youdotcom/minimax-m3-deepsearchqa-skill-eval"
DEFAULT_REVISION = "main"
DEFAULT_DATA_DIR = "data"


@dataclass(frozen=True)
class Artifact:
    remote: str
    local: str
    estimated_bytes: int


DEFAULT_ARTIFACTS = [
    Artifact("summary.json", "summary.json", 2_000),
    Artifact("prompts.jsonl", "prompts.jsonl", 600_000),
    Artifact("results.jsonl", "results.jsonl", 1_000_000),
    Artifact("graded.jsonl", "graded.jsonl", 1_600_000_000),
]
ALL_ARTIFACTS = [
    *DEFAULT_ARTIFACTS,
    Artifact("trajectories.jsonl", "trajectories.jsonl", 8_400_000_000),
]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download published eval artifacts from a Hugging Face dataset repository."
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Also download trajectories.jsonl. The default downloads summary, prompts, and graded rows.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the download plan without importing huggingface_hub or downloading.",
    )
    parser.add_argument(
        "--yes",
        "-y",
        action="store_true",
        help="Skip the size confirmation prompt.",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    data_dir = root / env_or_default("DATA_DIR", DEFAULT_DATA_DIR)
    repo_id = env_or_default("HF_DATASET_REPO", DEFAULT_REPO)
    revision = env_or_default("HF_REVISION", DEFAULT_REVISION)
    artifacts = ALL_ARTIFACTS if args.all else DEFAULT_ARTIFACTS
    plan = build_plan(root, data_dir, repo_id, revision, artifacts)

    if args.dry_run:
        print(json.dumps(plan, indent=2))
        return 0

    print_size_warning(plan)
    if not args.yes and not confirm_download():
        raise SystemExit("Download cancelled.")

    try:
        from huggingface_hub import hf_hub_download
    except ImportError as exc:
        raise SystemExit(
            "Missing Python package 'huggingface_hub'. Run this script with: uv run scripts/download.py"
        ) from exc

    data_dir.mkdir(parents=True, exist_ok=True)
    for artifact in artifacts:
        print(f"Downloading {artifact.remote} -> {data_dir / artifact.local}", flush=True)
        hf_hub_download(
            repo_id=repo_id,
            repo_type="dataset",
            revision=revision,
            filename=artifact.remote,
            local_dir=str(data_dir),
            token=os.environ.get("HF_TOKEN") or None,
        )
    print(f"Downloaded {len(artifacts)} artifact(s) to {data_dir.relative_to(root)}")
    return 0


def env_or_default(name: str, fallback: str) -> str:
    value = os.environ.get(name)
    return value if value else fallback


def build_plan(
    root: Path,
    data_dir: Path,
    repo_id: str,
    revision: str,
    artifacts: list[Artifact],
) -> dict[str, object]:
    return {
        "repo_id": repo_id,
        "repo_type": "dataset",
        "revision": revision,
        "data_dir": str(data_dir.relative_to(root)),
        "total_estimated_bytes": sum(artifact.estimated_bytes for artifact in artifacts),
        "files": [
            {
                "remote": artifact.remote,
                "local": str((data_dir / artifact.local).relative_to(root)),
                "estimated_bytes": artifact.estimated_bytes,
            }
            for artifact in artifacts
        ],
    }


def print_size_warning(plan: dict[str, object]) -> None:
    total = int(plan["total_estimated_bytes"])
    print(
        f"About to download {format_bytes(total)} from {plan['repo_id']}@{plan['revision']} "
        f"into {plan['data_dir']}."
    )
    print("Use --dry-run to inspect the plan or --yes to skip this prompt.")


def confirm_download() -> bool:
    if not sys.stdin.isatty():
        print("Refusing to download without confirmation in a non-interactive session. Re-run with --yes.")
        return False
    response = input("Continue? [y/N] ").strip().lower()
    return response in {"y", "yes"}


def format_bytes(value: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(value)
    for unit in units:
        if size < 1000 or unit == units[-1]:
            return f"{size:.1f} {unit}"
        size /= 1000
    raise AssertionError("unreachable")


if __name__ == "__main__":
    sys.exit(main())
