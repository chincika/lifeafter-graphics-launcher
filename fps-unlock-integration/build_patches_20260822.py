from __future__ import annotations

import argparse
import hashlib
import struct
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
VENDOR = ROOT.parent / "current-npk-fps-analysis" / "vendor"
if not VENDOR.exists():
    VENDOR = ROOT.parent.parent / "current-npk-fps-analysis" / "vendor"
sys.path.insert(0, str(VENDOR))

import lz4.block  # type: ignore  # noqa: E402

from build_patches import pad_lz4_to_fixed_size  # noqa: E402


PROFILE_ID = "20260822"
SLOT_SIZE = 104_693
RAW_SIZE = 312_189
ORIGINAL_SLOT_SHA256 = (
    "1391EDF42903DCB107E3777A9FFB638503C0F8D602C9E96E4C15616BFAFA9EDD"
)
ORIGINAL_RAW_SHA256 = (
    "B17FB7ADBB658084DA2D2275B9733D250E7AC352F4F16639C24D268223933848"
)
TARGETS = (180, 240, 300)

# Exact anchors reviewed from the 2026-08-22 classic PC package.
CODE_MARKER_OFFSET = 261_440
ORIGINAL_CODE_SIZE = 878
CONSTANTS_OFFSET = CODE_MARKER_OFFSET + 5 + ORIGINAL_CODE_SIZE
CONSTANTS_ANCHOR = b"\x2e\x02\xd3\x0cuser_setting\x78"
FILENAME_RECORD = b"\xd3\x11SettingManager.py"
QUALNAME_RECORD = b"\xd3\x1dSettingManager.set_frame_rate"

# NetEase-remapped CPython 3.14 wordcode for:
#     if frame == 120:
#         frame = <const index 2>
CONDITIONAL_PREFIX = bytes.fromhex(
    "73 01 "  # LOAD_FAST_BORROW frame
    "67 78 "  # LOAD_SMALL_INT 120
    "61 58 "  # COMPARE_OP bool(==)
    "00 00 "  # COMPARE_OP cache
    "58 03 "  # POP_JUMP_IF_FALSE -> original body
    "00 00 "  # jump cache
    "1a 00 "  # NOT_TAKEN
    "44 02 "  # LOAD_CONST target
    "76 01"  # STORE_FAST frame
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


def make_raw_patch(original: bytes, fps: int) -> bytes:
    if fps not in TARGETS:
        raise ValueError(f"unsupported target: {fps}")
    if len(original) != RAW_SIZE or sha256(original) != ORIGINAL_RAW_SHA256:
        raise ValueError("reviewed SettingManager raw payload does not match")

    code_size = struct.unpack_from("<I", original, CODE_MARKER_OFFSET + 1)[0]
    if original[CODE_MARKER_OFFSET] != 0xFB or code_size != ORIGINAL_CODE_SIZE:
        raise ValueError("set_frame_rate code marker changed")

    code_start = CODE_MARKER_OFFSET + 5
    original_code = original[code_start : code_start + ORIGINAL_CODE_SIZE]
    if original_code[:2] != b"\x80\x00":
        raise ValueError("set_frame_rate does not start with RESUME")
    if original_code[-4:] != b"\x44\x01\x12\x00":
        raise ValueError("set_frame_rate return sequence changed")
    if (
        original[CONSTANTS_OFFSET : CONSTANTS_OFFSET + len(CONSTANTS_ANCHOR)]
        != CONSTANTS_ANCHOR
    ):
        raise ValueError("set_frame_rate constants changed")

    patched = bytearray(original)
    insertion_offset = code_start + 2
    patched[insertion_offset:insertion_offset] = CONDITIONAL_PREFIX
    struct.pack_into(
        "<I",
        patched,
        CODE_MARKER_OFFSET + 1,
        ORIGINAL_CODE_SIZE + len(CONDITIONAL_PREFIX),
    )

    shifted_constants = CONSTANTS_OFFSET + len(CONDITIONAL_PREFIX)
    if (
        patched[shifted_constants : shifted_constants + len(CONSTANTS_ANCHOR)]
        != CONSTANTS_ANCHOR
    ):
        raise AssertionError("shifted constants anchor mismatch")
    patched[shifted_constants] = 0x2E
    patched[shifted_constants + 1] = 3
    target_offset = shifted_constants + len(CONSTANTS_ANCHOR)
    patched[target_offset:target_offset] = b"\xBE" + struct.pack("<I", fps)

    # Reclaim the 23 inserted bytes only from traceback/debug strings. Runtime
    # names, arguments, the original function body and return value stay intact.
    filename_offset = patched.find(FILENAME_RECORD, target_offset)
    qualname_offset = patched.find(QUALNAME_RECORD, filename_offset)
    if filename_offset < 0 or qualname_offset < 0:
        raise ValueError("set_frame_rate debug metadata changed")
    patched[filename_offset : filename_offset + len(FILENAME_RECORD)] = b"\xd3\x05SM.py"
    qualname_offset = patched.find(QUALNAME_RECORD, filename_offset)
    patched[qualname_offset : qualname_offset + len(QUALNAME_RECORD)] = (
        b"\xd3\x12SM3.set_frame_rate"
    )

    if len(patched) != len(original):
        raise AssertionError("patched raw payload changed size")

    new_code_size = struct.unpack_from("<I", patched, CODE_MARKER_OFFSET + 1)[0]
    new_code = bytes(
        patched[code_start : code_start + ORIGINAL_CODE_SIZE + len(CONDITIONAL_PREFIX)]
    )
    if new_code_size != len(new_code):
        raise AssertionError("patched code size field mismatch")
    if new_code[:2] + new_code[2 + len(CONDITIONAL_PREFIX) :] != original_code:
        raise AssertionError("original set_frame_rate body was not preserved exactly")
    if new_code[2 : 2 + len(CONDITIONAL_PREFIX)] != CONDITIONAL_PREFIX:
        raise AssertionError("conditional prefix mismatch")
    if new_code[-4:] != b"\x44\x01\x12\x00":
        raise AssertionError("patched function no longer returns const index 1")
    expected_target = (
        b"\x2e\x03\xd3\x0cuser_setting\x78\xbe" + struct.pack("<I", fps)
    )
    if expected_target not in patched[shifted_constants : shifted_constants + 64]:
        raise AssertionError("target constant was not serialized correctly")
    return bytes(patched)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--slot", required=True, type=Path)
    parser.add_argument("--raw", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "patches")
    args = parser.parse_args()

    original_slot = args.slot.read_bytes()
    original_raw = args.raw.read_bytes()
    if len(original_slot) != SLOT_SIZE or sha256(original_slot) != ORIGINAL_SLOT_SHA256:
        raise ValueError("reviewed original slot does not match")
    if len(original_raw) != RAW_SIZE or sha256(original_raw) != ORIGINAL_RAW_SHA256:
        raise ValueError("reviewed original raw payload does not match")
    if lz4.block.decompress(original_slot, uncompressed_size=RAW_SIZE) != original_raw:
        raise ValueError("reviewed original slot decompression mismatch")

    artifacts = {f"patch_{PROFILE_ID}_original.bin": original_slot}
    for fps in TARGETS:
        patched_raw = make_raw_patch(original_raw, fps)
        compressed = lz4.block.compress(
            patched_raw,
            mode="high_compression",
            compression=8,
            store_size=False,
        )
        compressed = pad_lz4_to_fixed_size(compressed, patched_raw, SLOT_SIZE)
        if lz4.block.decompress(compressed, uncompressed_size=RAW_SIZE) != patched_raw:
            raise AssertionError("conditional patch decompression mismatch")
        artifacts[f"patch_{PROFILE_ID}_{fps}.bin"] = compressed

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, data in artifacts.items():
        (args.output_dir / name).write_bytes(data)
        print(f"{sha256(data)} *{args.output_dir / name}")


if __name__ == "__main__":
    main()
