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
from pathlib import Path

DEFAULT_REPO = "youdotcom/minimax-m3-deepsearchqa-skill-eval"
FILES = [
    ("README.md", "README.md"),
    ("data/prompts.jsonl", "prompts.jsonl"),
    ("data/trajectories.jsonl", "trajectories.jsonl"),
    ("data/graded.jsonl", "graded.jsonl"),
    ("data/summary.json", "summary.json"),
]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Upload eval artifacts to a Hugging Face dataset repository."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the upload plan without importing huggingface_hub or uploading.",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    repo_id = os.environ.get("HF_DATASET_REPO", DEFAULT_REPO)
    revision = os.environ.get("HF_REVISION", "main")
    files = [(root / local, remote) for local, remote in FILES]

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
                    "files": [
                        {
                            "local": str(local.relative_to(root)),
                            "remote": remote,
                            "bytes": local.stat().st_size,
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

    api = HfApi(token=os.environ.get("HF_TOKEN") or None)
    last_commit_url = None
    for local, remote in files:
        print(f"Uploading {local.relative_to(root)} -> {remote}", flush=True)
        commit = api.upload_file(
            path_or_fileobj=str(local),
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


if __name__ == "__main__":
    sys.exit(main())
