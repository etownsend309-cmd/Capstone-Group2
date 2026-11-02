from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from extractors import normalized_stem, run_engine
from select_sample import Candidate, select


class SampleSelectionTests(unittest.TestCase):
    def test_selection_is_deterministic_and_diverse(self) -> None:
        candidates = [
            Candidate(
                filename=f"contract-{index}.pdf",
                txt_file=f"contract-{index}.txt",
                contract_type=f"type-{index % 4}",
                length_chars=1000 + index * 50,
                positives=("Governing Law",) if index % 2 else ("Audit Rights",),
                tie_breaker=f"{index:04d}",
            )
            for index in range(20)
        ]
        first = select(candidates, 10)
        second = select(candidates, 10)
        self.assertEqual(first, second)
        self.assertEqual(len({item.filename for item in first}), 10)
        self.assertGreaterEqual(len({item.contract_type for item in first}), 4)

    def test_filename_normalization_handles_cuad_punctuation(self) -> None:
        self.assertEqual(
            normalized_stem("PACIRA PHARMACEUTICALS, INC. - A&R AGREEMENT.PDF"),
            normalized_stem("PACIRA PHARMACEUTICALS, INC. - A_R AGREEMENT.pdf"),
        )


class ExtractorResultTests(unittest.TestCase):
    def test_empty_output_is_failed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = run_engine(
                "fake",
                "Fake",
                "1",
                lambda _path: ["", "   "],
                Path(directory) / "empty.pdf",
            )
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["pageCount"], 2)

    def test_parser_exception_becomes_sanitized_failure(self) -> None:
        def fail(_path: Path) -> list[str]:
            raise ValueError("invalid document")

        with tempfile.TemporaryDirectory() as directory:
            result = run_engine(
                "fake",
                "Fake",
                "1",
                fail,
                Path(directory) / "corrupt.pdf",
            )
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error"], "ValueError: invalid document")


if __name__ == "__main__":
    unittest.main()
