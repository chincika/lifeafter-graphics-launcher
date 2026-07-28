from __future__ import annotations

import hashlib
import struct
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ANALYSIS = ROOT.parent / "current-npk-fps-analysis"
sys.path.insert(0, str(ANALYSIS / "vendor"))

import lz4.block  # type: ignore  # noqa: E402

from build_patches import (  # noqa: E402
    CODE_MARKER_OFFSET,
    CONDITIONAL_PREFIX,
    ORIGINAL_CODE_SIZE,
    RAW_SIZE,
    SLOT_SIZE,
    TARGETS,
    make_raw_patch,
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


def main() -> None:
    original_raw = (ANALYSIS / "SettingManager-current.decompressed.bin").read_bytes()
    patch_dir = ROOT / "patches"
    original_slot = (patch_dir / "patch_original.bin").read_bytes()
    if len(original_slot) != SLOT_SIZE:
        raise AssertionError("original slot size mismatch")
    if lz4.block.decompress(original_slot, uncompressed_size=RAW_SIZE) != original_raw:
        raise AssertionError("original slot raw mismatch")

    seen_hashes = {sha256(original_slot)}
    for fps in TARGETS:
        patch = (patch_dir / f"patch_{fps}.bin").read_bytes()
        if len(patch) != SLOT_SIZE:
            raise AssertionError(f"{fps}: slot size mismatch")
        raw = lz4.block.decompress(patch, uncompressed_size=RAW_SIZE)
        expected = make_raw_patch(original_raw, fps)
        if raw != expected:
            raise AssertionError(f"{fps}: decompressed patch is not deterministic")
        digest = sha256(patch)
        if digest in seen_hashes:
            raise AssertionError(f"{fps}: duplicate artifact hash")
        seen_hashes.add(digest)

        code_size = struct.unpack_from("<I", raw, CODE_MARKER_OFFSET + 1)[0]
        if code_size != ORIGINAL_CODE_SIZE + len(CONDITIONAL_PREFIX):
            raise AssertionError(f"{fps}: code size mismatch")
        code_start = CODE_MARKER_OFFSET + 5
        if raw[code_start + 2 : code_start + 2 + len(CONDITIONAL_PREFIX)] != CONDITIONAL_PREFIX:
            raise AssertionError(f"{fps}: conditional wordcode mismatch")
        if b"\x2e\x03\xd3\x0cuser_setting\x78\xbe" + struct.pack("<I", fps) not in raw:
            raise AssertionError(f"{fps}: serialized target missing")
        print(f"verified {fps} FPS\t{digest}")

    print("all conditional frame-rate patches verified")


if __name__ == "__main__":
    main()
