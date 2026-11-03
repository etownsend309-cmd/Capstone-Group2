#!/usr/bin/env python3
"""Create a reproducible, category-aware 30-contract CUAD sample."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

CATEGORIES = [
    "Governing Law",
    "Anti-Assignment",
    "Cap On Liability",
    "Audit Rights",
    "Termination For Convenience",
    "Exclusivity",
    "Renewal Term",
    "Insurance",
    "Change Of Control",
    "Uncapped Liability",
    "Notice Period To Terminate Renewal",
    "Warranty Duration",
]
SEED = "clausepilot-cuad-30-v1"


@dataclass(frozen=True)
class Candidate:
    filename: str
    txt_file: str
    contract_type: str
    length_chars: int
    positives: tuple[str, ...]
    tie_breaker: str


def is_positive(value: str | None) -> bool:
    normalized = (value or "").strip()
    return normalized not in {"", "[]", "No", "no"}


def contract_type(filename: str) -> str:
    stem = Path(filename).stem
    tail = stem.rsplit("-", 1)[-1]
    return tail.replace("_", " ").strip() or "Unknown"


def normalized_stem(filename: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", Path(filename).stem.casefold())


def length_bucket(length: int, cut_one: int, cut_two: int) -> str:
    if length <= cut_one:
        return "short"
    if length <= cut_two:
        return "medium"
    return "long"


def load_candidates(dataset_root: Path) -> list[Candidate]:
    csv_path = dataset_root / "master_clauses.csv"
    txt_dir = dataset_root / "full_contract_txt"
    txt_by_stem = {normalized_stem(path.name): path for path in txt_dir.glob("*.txt")}
    candidates: list[Candidate] = []

    with csv_path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        missing = [category for category in CATEGORIES if category not in (reader.fieldnames or [])]
        if missing:
            raise SystemExit(f"CUAD CSV is missing expected categories: {', '.join(missing)}")
        for row in reader:
            filename = (row.get("Filename") or "").strip()
            if not filename:
                continue
            txt_name = f"{Path(filename).stem}.txt"
            txt_path = txt_dir / txt_name
            if not txt_path.exists():
                txt_path = txt_by_stem.get(normalized_stem(filename), txt_path)
            if not txt_path.exists():
                raise SystemExit(f"Missing matching text reference for: {filename}")
            length = len(txt_path.read_text(encoding="utf-8", errors="replace"))
            positives = tuple(category for category in CATEGORIES if is_positive(row.get(category)))
            tie = hashlib.sha256(f"{SEED}:{filename}".encode()).hexdigest()
            candidates.append(
                Candidate(
                    filename=filename,
                    txt_file=txt_path.name,
                    contract_type=contract_type(filename),
                    length_chars=length,
                    positives=positives,
                    tie_breaker=tie,
                )
            )
    return candidates


def select(candidates: list[Candidate], size: int) -> list[Candidate]:
    lengths = sorted(candidate.length_chars for candidate in candidates)
    cut_one = lengths[len(lengths) // 3]
    cut_two = lengths[(len(lengths) * 2) // 3]
    selected: list[Candidate] = []
    remaining = list(candidates)
    category_counts: Counter[str] = Counter()
    type_counts: Counter[str] = Counter()
    bucket_counts: Counter[str] = Counter()

    while remaining and len(selected) < size:
        def score(candidate: Candidate) -> tuple[int, str]:
            bucket = length_bucket(candidate.length_chars, cut_one, cut_two)
            category_score = sum(max(0, 3 - category_counts[name]) for name in candidate.positives)
            zero_category_score = 2 if not candidate.positives and not any(
                not item.positives for item in selected
            ) else 0
            diversity_score = 4 if type_counts[candidate.contract_type] == 0 else 0
            length_score = max(0, 10 - bucket_counts[bucket])
            return (
                category_score * 8 + zero_category_score + diversity_score + length_score,
                candidate.tie_breaker,
            )

        choice = max(remaining, key=score)
        remaining.remove(choice)
        selected.append(choice)
        category_counts.update(choice.positives)
        type_counts.update([choice.contract_type])
        bucket_counts.update([length_bucket(choice.length_chars, cut_one, cut_two)])
    return selected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset-root",
        type=Path,
        default=Path.home() / "Desktop" / "CUAD_v1",
    )
    parser.add_argument("--size", type=int, default=30)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parent / "manifests" / "cuad-30.json",
    )
    args = parser.parse_args()
    dataset_root = args.dataset_root.expanduser().resolve()
    candidates = load_candidates(dataset_root)
    chosen = select(candidates, args.size)

    payload = {
        "schemaVersion": 1,
        "selectionSeed": SEED,
        "source": "CUAD v1",
        "datasetRootHint": str(dataset_root),
        "categories": CATEGORIES,
        "contracts": [
            {
                "pdfFile": item.filename,
                "txtFile": item.txt_file,
                "contractType": item.contract_type,
                "lengthChars": item.length_chars,
                "positiveCategories": list(item.positives),
            }
            for item in chosen
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")
    print(f"Wrote {len(chosen)} contracts to {args.output}")


if __name__ == "__main__":
    main()
