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
import tempfile
from pathlib import Path

DEFAULT_REPO = "youdotcom/minimax-m3-deepsearchqa-skill-eval"
HF_CARD_METADATA = """---
pretty_name: MiniMax M3 DeepSearchQA Skill Eval
license: mit
language:
  - en
tags:
  - deepsearchqa
  - agent-eval
  - web-agent
  - minimax
  - you-com
  - text
task_categories:
  - question-answering
configs:
  - config_name: results
    default: true
    data_files:
      - split: test
        path: results.jsonl
  - config_name: prompts
    data_files:
      - split: test
        path: prompts.jsonl
---

"""
FILES = [
    ("README.md", "README.md"),
    ("data/prompts.jsonl", "prompts.jsonl"),
    ("data/results.jsonl", "results.jsonl"),
    ("data/graded.jsonl", "graded.jsonl"),
    ("data/trajectories.jsonl", "trajectories.jsonl"),
    ("data/summary.json", "summary.json"),
]


def main() -> int:
    parser = argparse.ArgumentParser(
        allow_abbrev=False,
        description="Upload eval artifacts to a Hugging Face dataset repository."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the upload plan without importing huggingface_hub or uploading.",
    )
    parser.add_argument(
        "--card-only",
        action="store_true",
        help="Upload only README.md, with Hugging Face dataset-card metadata prepended.",
    )
    parser.add_argument(
        "--files",
        default=None,
        help=(
            "Comma-separated remote file names to upload instead of all artifacts. "
            "Example: --files results.jsonl,summary.json,README.md"
        ),
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    repo_id = os.environ.get("HF_DATASET_REPO", DEFAULT_REPO)
    revision = os.environ.get("HF_REVISION", "main")
    if args.files and args.card_only:
        raise SystemExit("--files cannot be combined with --card-only.")
    if args.files:
        requested = {name.strip() for name in args.files.split(",") if name.strip()}
        known = {remote for _, remote in FILES}
        unknown = requested - known
        if unknown:
            raise SystemExit(f"Unknown file(s): {', '.join(sorted(unknown))}. Known files: {', '.join(sorted(known))}")
        selected_files = [(local, remote) for local, remote in FILES if remote in requested]
    else:
        selected_files = FILES[:1] if args.card_only else FILES
    files = [(root / local, remote) for local, remote in selected_files]

    if not args.card_only:
        verify_results_preflight(root)

    missing = [str(local.relative_to(root)) for local, _ in files if not local.exists()]
    if missing:
        raise SystemExit(f"Missing required upload files: {', '.join(missing)}")

    if args.dry_run:
        print(
            json.dumps(
                {
                    "repo_id": repo_id,
                    "repo_type": "dataset",
                    "revision": revision,
                    "card_preview": build_dataset_card(root / "README.md")[:500],
                    "files": [
                        {
                            "local": str(local.relative_to(root)),
                            "remote": remote,
                            "bytes": upload_size(local, remote),
                            "generated": "hf_dataset_card" if remote == "README.md" else None,
                        }
                        for local, remote in files
                    ],
                },
                indent=2,
            )
        )
        return 0

    try:
        from huggingface_hub import HfApi
    except ImportError as exc:
        raise SystemExit(
            "Missing Python package 'huggingface_hub'. Run this script with: uv run scripts/upload.py"
        ) from exc

    api = HfApi(token=upload_token())
    last_commit_url = None
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        for local, remote in files:
            upload_path = prepare_upload_path(local, remote, tmpdir_path)
            print(f"Uploading {local.relative_to(root)} -> {remote}", flush=True)
            commit = api.upload_file(
                path_or_fileobj=str(upload_path),
                path_in_repo=remote,
                repo_id=repo_id,
                repo_type="dataset",
                revision=revision,
                commit_message=f"Update {remote}",
            )
            last_commit_url = getattr(commit, "commit_url", None)

    print(f"Uploaded {', '.join(remote for _, remote in files)} to {repo_id}@{revision}")
    if last_commit_url:
        print(last_commit_url)
    return 0


def upload_size(local: Path, remote: str) -> int:
    if remote == "README.md":
        return len(build_dataset_card(local).encode())
    return local.stat().st_size


def upload_token() -> str | bool:
    return os.environ.get("HF_TOKEN") or True


def verify_results_preflight(root: Path) -> None:
    graded_path = root / "data/graded.jsonl"
    results_path = root / "data/results.jsonl"
    if not results_path.exists():
        raise SystemExit("data/results.jsonl is missing. Run `bun run export-results` before `bun run upload`.")
    if graded_path.exists() and results_path.stat().st_mtime < graded_path.stat().st_mtime:
        raise SystemExit("data/results.jsonl is older than data/graded.jsonl. Run `bun run export-results` before `bun run upload`.")


def prepare_upload_path(local: Path, remote: str, tmpdir: Path) -> Path:
    if remote != "README.md":
        return local
    card_path = tmpdir / "README.md"
    card_path.write_text(build_dataset_card(local))
    return card_path


def build_dataset_card(readme_path: Path) -> str:
    body = strip_yaml_front_matter(readme_path.read_text())
    return HF_CARD_METADATA + body


def strip_yaml_front_matter(text: str) -> str:
    if not text.startswith("---\n"):
        return text
    end = text.find("\n---\n", 4)
    if end == -1:
        return text
    return text[end + len("\n---\n") :]


if __name__ == "__main__":
    sys.exit(main())
