#!/usr/bin/env python3
"""Run independent Python PDF engines and write text-bearing local intermediates."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import re
import time
from pathlib import Path
from typing import Callable

import pdfplumber
import pymupdf

pymupdf.TOOLS.mupdf_display_errors(False)


def normalized_stem(filename: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", Path(filename).stem.casefold())


def pdf_index(root: Path) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() == ".pdf":
            result.setdefault(normalized_stem(path.name), path)
    return result


def pymupdf_pages(path: Path) -> list[str]:
    with pymupdf.open(path) as document:
        if document.needs_pass:
            raise ValueError("The PDF is password protected.")
        return [page.get_text("text") for page in document]


def pdfplumber_pages(path: Path) -> list[str]:
    with pdfplumber.open(path) as document:
        return [page.extract_text() or "" for page in document.pages]


def run_engine(
    engine_id: str,
    engine_name: str,
    version: str,
    extractor: Callable[[Path], list[str]],
    path: Path,
) -> dict[str, object]:
    started = time.perf_counter()
    try:
        pages = extractor(path)
        elapsed = (time.perf_counter() - started) * 1000
        empty_pages = [index + 1 for index, text in enumerate(pages) if not text.strip()]
        status = "failed" if not pages or len(empty_pages) == len(pages) else (
            "warning" if empty_pages else "success"
        )
        return {
            "engineId": engine_id,
            "engineName": engine_name,
            "version": version,
            "status": status,
            "elapsedMs": round(elapsed, 2),
            "pageCount": len(pages),
            "pages": pages,
            "warnings": (
                [f"No text was extracted from page(s): {', '.join(map(str, empty_pages))}."]
                if empty_pages
                else []
            ),
            "error": None,
        }
    except Exception as error:  # parser failures must not stop the corpus run
        return {
            "engineId": engine_id,
            "engineName": engine_name,
            "version": version,
            "status": "failed",
            "elapsedMs": round((time.perf_counter() - started) * 1000, 2),
            "pageCount": 0,
            "pages": [],
            "warnings": [],
            "error": f"{type(error).__name__}: {error}",
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    pdf_root = args.dataset_root / "full_contract_pdf"
    index = pdf_index(pdf_root if pdf_root.is_dir() else args.dataset_root)
    pymupdf_version = importlib.metadata.version("PyMuPDF")
    pdfplumber_version = importlib.metadata.version("pdfplumber")
    contracts: list[dict[str, object]] = []

    for contract in manifest["contracts"]:
        filename = contract["pdfFile"]
        path = index.get(normalized_stem(filename))
        if not path:
            contracts.append(
                {
                    "pdfFile": filename,
                    "sourcePath": None,
                    "engines": [],
                    "error": "Matching PDF not found.",
                }
            )
            continue
        contracts.append(
            {
                "pdfFile": filename,
                "sourcePath": str(path),
                "engines": [
                    run_engine(
                        "pymupdf-default",
                        "PyMuPDF default text",
                        pymupdf_version,
                        pymupdf_pages,
                        path,
                    ),
                    run_engine(
                        "pdfplumber-default",
                        "pdfplumber default text",
                        pdfplumber_version,
                        pdfplumber_pages,
                        path,
                    ),
                ],
                "error": None,
            }
        )
        print(f"  Python engines: {filename}")

    payload = {
        "schemaVersion": 1,
        "runtime": {
            "pymupdf": pymupdf_version,
            "pdfplumber": pdfplumber_version,
        },
        "contracts": contracts,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(f"{json.dumps(payload)}\n", encoding="utf-8")


if __name__ == "__main__":
    main()
