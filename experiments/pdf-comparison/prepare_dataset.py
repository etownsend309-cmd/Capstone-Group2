#!/usr/bin/env python3
"""Download and safely add the missing CUAD PDFs to an external dataset folder."""

from __future__ import annotations

import argparse
import hashlib
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

ARCHIVE_URL = "https://zenodo.org/api/records/4595826/files/CUAD_v1.zip/content"
EXPECTED_MD5 = "c38f490a984420b8a62600db401fafd5"


def md5(path: Path) -> str:
    digest = hashlib.md5()  # noqa: S324 - required to verify Zenodo's published checksum
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(destination: Path) -> None:
    request = urllib.request.Request(
        ARCHIVE_URL,
        headers={"User-Agent": "ClausePilot-CUAD-evaluation/1.0"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        with destination.open("wb") as output:
            shutil.copyfileobj(response, output)


def extract_pdfs(archive: Path, dataset_root: Path) -> int:
    destination = dataset_root / "full_contract_pdf"
    destination.mkdir(parents=True, exist_ok=True)
    extracted = 0

    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            parts = PurePosixPath(member.filename).parts
            try:
                marker = parts.index("full_contract_pdf")
            except ValueError:
                continue
            relative = Path(*parts[marker + 1 :])
            if member.is_dir() or relative.suffix.lower() != ".pdf":
                continue
            target = destination / relative
            target.resolve().relative_to(destination.resolve())
            if target.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(member) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
            extracted += 1
    return extracted


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset-root",
        type=Path,
        default=Path.home() / "Desktop" / "CUAD_v1",
    )
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()

    if args.archive:
        archive = args.archive.expanduser().resolve()
        temporary = None
    else:
        temporary = tempfile.TemporaryDirectory(prefix="cuad-download-")
        archive = Path(temporary.name) / "CUAD_v1.zip"
        print(f"Downloading {ARCHIVE_URL}")
        download(archive)

    actual = md5(archive)
    if actual != EXPECTED_MD5:
        raise SystemExit(
            f"Checksum mismatch for {archive}: expected {EXPECTED_MD5}, received {actual}"
        )

    extracted = extract_pdfs(archive, args.dataset_root.expanduser().resolve())
    total = len(list((args.dataset_root / "full_contract_pdf").rglob("*.pdf")))
    print(f"Verified archive checksum. Extracted {extracted} PDF(s); {total} now available.")
    if total != 510:
        raise SystemExit(f"Expected 510 CUAD PDFs, found {total}.")
    if temporary:
        temporary.cleanup()


if __name__ == "__main__":
    main()
