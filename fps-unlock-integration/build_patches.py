from __future__ import annotations

import hashlib
import struct
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ANALYSIS = ROOT.parent / "current-npk-fps-analysis"
VENDOR = ANALYSIS / "vendor"
sys.path.insert(0, str(VENDOR))

import lz4.block  # type: ignore  # noqa: E402


SLOT_SIZE = 110_791
RAW_SIZE = 328_632
ORIGINAL_SLOT_SHA256 = (
    "6F9165B65B8E32391E32FBC5174B8CC680E90C33C5887B46999D087ACE8FE050"
)
TARGETS = (180, 240, 300)

# Exact anchors from the reviewed 2026-07-26 game package.
CODE_MARKER_OFFSET = 269_793
ORIGINAL_CODE_SIZE = 878
CONSTANTS_OFFSET = CODE_MARKER_OFFSET + 5 + ORIGINAL_CODE_SIZE
CONSTANTS_ANCHOR = b"\x2e\x02\xd3\x0cuser_setting\x78"
FILENAME_RECORD = b"\xd3\x11SettingManager.py"
QUALNAME_RECORD = b"\xd3\x1dSettingManager.set_frame_rate"

# NetEase-remapped CPython 3.14 wordcode for:
#     if frame == 120:
#         frame = <const index 2>
#
# It is inserted after the original RESUME instruction. The mapping was
# recovered from multiple simple functions in the same reviewed package:
# 0x73 LOAD_FAST_BORROW, 0x67 LOAD_SMALL_INT, 0x61 COMPARE_OP,
# 0x58 POP_JUMP_IF_FALSE, 0x1a NOT_TAKEN, 0x44 LOAD_CONST,
# 0x76 STORE_FAST. Zero words are CPython inline caches.
CONDITIONAL_PREFIX = bytes.fromhex(
    "73 01 "  # LOAD_FAST_BORROW frame
    "67 78 "  # LOAD_SMALL_INT 120
    "61 58 "  # COMPARE_OP bool(==)
    "00 00 "  # COMPARE_OP cache
    "58 03 "  # POP_JUMP_IF_FALSE -> original body
    "00 00 "  # jump cache
    "1a 00 "  # NOT_TAKEN
    "44 02 "  # LOAD_CONST target
    "76 01"   # STORE_FAST frame
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


def make_raw_patch(original: bytes, fps: int) -> bytes:
    if fps not in TARGETS:
        raise ValueError(f"unsupported target: {fps}")
    if len(original) != RAW_SIZE:
        raise ValueError("unexpected SettingManager raw size")

    code_size = struct.unpack_from("<I", original, CODE_MARKER_OFFSET + 1)[0]
    if original[CODE_MARKER_OFFSET] != 0xFB or code_size != ORIGINAL_CODE_SIZE:
        raise ValueError("set_frame_rate code marker changed")

    code_start = CODE_MARKER_OFFSET + 5
    original_code = original[code_start : code_start + ORIGINAL_CODE_SIZE]
    if original_code[:2] != b"\x80\x00":
        raise ValueError("set_frame_rate does not start with RESUME")
    if original_code[-4:] != b"\x44\x01\x12\x00":
        raise ValueError("set_frame_rate return sequence changed")
    if original[CONSTANTS_OFFSET : CONSTANTS_OFFSET + len(CONSTANTS_ANCHOR)] != CONSTANTS_ANCHOR:
        raise ValueError("set_frame_rate constants changed")

    patched = bytearray(original)

    # Insert the conditional branch after RESUME and update co_code length.
    insertion_offset = code_start + 2
    patched[insertion_offset:insertion_offset] = CONDITIONAL_PREFIX
    struct.pack_into(
        "<I",
        patched,
        CODE_MARKER_OFFSET + 1,
        ORIGINAL_CODE_SIZE + len(CONDITIONAL_PREFIX),
    )

    # Keep None at const index 1 (the original return value) and append target
    # as const index 2. This avoids the legacy patch's accidental integer return.
    shifted_constants = CONSTANTS_OFFSET + len(CONDITIONAL_PREFIX)
    expected_constants = b"\x2e\x02\xd3\x0cuser_setting\x78"
    if patched[shifted_constants : shifted_constants + len(expected_constants)] != expected_constants:
        raise AssertionError("shifted constants anchor mismatch")
    patched[shifted_constants] = 0x2E
    patched[shifted_constants + 1] = 3
    target_offset = shifted_constants + len(expected_constants)
    patched[target_offset:target_offset] = b"\xBE" + struct.pack("<I", fps)

    # The target NPK record has fixed original/compressed sizes. Reclaim the
    # exact 23 inserted bytes only from traceback/debug metadata strings.
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
        raise AssertionError(
            f"raw length changed: expected {len(original)}, got {len(patched)}"
        )

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
    expected_target = b"\x2e\x03\xd3\x0cuser_setting\x78\xbe" + struct.pack("<I", fps)
    if expected_target not in patched[shifted_constants : shifted_constants + 64]:
        raise AssertionError("target constant was not serialized correctly")
    return bytes(patched)


def parse_sequences(block: bytes):
    compressed_pos = 0
    output_pos = 0
    while compressed_pos < len(block):
        token_pos = compressed_pos
        token = block[compressed_pos]
        compressed_pos += 1

        literal_length = token >> 4
        if literal_length == 15:
            while True:
                value = block[compressed_pos]
                compressed_pos += 1
                literal_length += value
                if value != 255:
                    break

        literals_pos = compressed_pos
        compressed_pos += literal_length
        output_pos += literal_length
        if compressed_pos == len(block):
            return

        offset_pos = compressed_pos
        match_offset = block[compressed_pos] | (block[compressed_pos + 1] << 8)
        compressed_pos += 2

        match_length = (token & 0x0F) + 4
        if (token & 0x0F) == 15:
            while True:
                value = block[compressed_pos]
                compressed_pos += 1
                match_length += value
                if value != 255:
                    break

        match_output_pos = output_pos
        output_pos += match_length
        yield {
            "token_pos": token_pos,
            "token": token,
            "literal_length": literal_length,
            "literals_pos": literals_pos,
            "offset_pos": offset_pos,
            "match_offset": match_offset,
            "match_length": match_length,
            "match_output_pos": match_output_pos,
        }


def expand_lz4_without_changing_output(block: bytes, raw: bytes, extra: int) -> bytes:
    if extra == 0:
        return block
    if extra < 0:
        raise ValueError("compressed block is larger than the fixed slot")

    for sequence in parse_sequences(block):
        literal_length = sequence["literal_length"]
        match_length = sequence["match_length"]
        token = sequence["token"]
        if (
            literal_length + extra < 15
            and 4 + extra <= match_length <= 18
            and (token & 0x0F) < 15
        ):
            token_pos = sequence["token_pos"]
            offset_pos = sequence["offset_pos"]
            match_output_pos = sequence["match_output_pos"]
            new_token = ((literal_length + extra) << 4) | ((match_length - extra) - 4)
            promoted_literals = raw[match_output_pos : match_output_pos + extra]
            expanded = (
                block[:token_pos]
                + bytes([new_token])
                + block[token_pos + 1 : offset_pos]
                + promoted_literals
                + block[offset_pos:]
            )
            if len(expanded) != len(block) + extra:
                raise AssertionError("LZ4 expansion length mismatch")
            return expanded
    raise RuntimeError("no safe LZ4 sequence can absorb the requested expansion")


def pad_lz4_to_fixed_size(block: bytes, raw: bytes, target_size: int) -> bytes:
    current = block
    while len(current) < target_size:
        remaining = target_size - len(current)
        expanded = None
        for chunk in range(min(14, remaining), 0, -1):
            try:
                expanded = expand_lz4_without_changing_output(current, raw, chunk)
                break
            except RuntimeError:
                continue
        if expanded is None:
            raise RuntimeError(
                f"unable to expand valid LZ4 block by remaining {remaining} bytes"
            )
        current = expanded
        if lz4.block.decompress(current, uncompressed_size=len(raw)) != raw:
            raise AssertionError("incremental LZ4 expansion changed decompressed output")
    if len(current) != target_size:
        raise AssertionError("fixed LZ4 padding overshot target")
    return current


def main() -> None:
    original_raw_path = ANALYSIS / "SettingManager-current.decompressed.bin"
    original_slot_path = ANALYSIS / "SettingManager-current.bin"
    output_dir = ROOT / "patches"
    output_dir.mkdir(parents=True, exist_ok=True)

    original_raw = original_raw_path.read_bytes()
    original_slot = original_slot_path.read_bytes()
    if len(original_slot) != SLOT_SIZE or sha256(original_slot) != ORIGINAL_SLOT_SHA256:
        raise ValueError("reviewed original slot does not match")
    if lz4.block.decompress(original_slot, uncompressed_size=RAW_SIZE) != original_raw:
        raise ValueError("reviewed original slot decompression mismatch")

    artifacts = {"patch_original.bin": original_slot}
    for fps in TARGETS:
        patched_raw = make_raw_patch(original_raw, fps)
        compressed = lz4.block.compress(
            patched_raw,
            mode="high_compression",
            compression=8,
            store_size=False,
        )
        compressed = pad_lz4_to_fixed_size(compressed, patched_raw, SLOT_SIZE)
        if len(compressed) != SLOT_SIZE:
            raise AssertionError("fixed slot compression size mismatch")
        if lz4.block.decompress(compressed, uncompressed_size=RAW_SIZE) != patched_raw:
            raise AssertionError("conditional patch decompression mismatch")
        artifacts[f"patch_{fps}.bin"] = compressed

    for name, data in artifacts.items():
        (output_dir / name).write_bytes(data)
        print(f"{sha256(data)} *patches/{name}")


if __name__ == "__main__":
    main()
