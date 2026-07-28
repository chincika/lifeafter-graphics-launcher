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
ORIGINAL_SLOT_SHA256 = "6F9165B65B8E32391E32FBC5174B8CC680E90C33C5887B46999D087ACE8FE050"
TARGET_PREFIX = b"\xd3\x0cuser_setting\x78\x2e\x11\xd3\x12setting_frame_rate"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


def make_raw_patch(original: bytes, fps: int) -> bytes:
    anchor = original.index(TARGET_PREFIX)
    patched = bytearray(original)

    # These two opcode changes are the exact structural equivalents of the
    # reviewed old 120 -> high-FPS transformation.
    assert patched[anchor - 770] == 0x73
    assert patched[anchor - 724] == 0x73
    patched[anchor - 770] = 0x44
    patched[anchor - 724] = 0x44

    # Replace the serialized placeholder object with a uint32 integer object.
    integer_offset = anchor + len(b"\xd3\x0cuser_setting")
    assert patched[integer_offset] == 0x78
    patched[integer_offset : integer_offset + 1] = b"\xbe" + struct.pack("<I", fps)

    # Keep the serialized module at exactly the original length, following the
    # same metadata-only filename shortening used by the reviewed old patches.
    filename_record = b"\xd3\x11SettingManager.py"
    filename_offset = patched.find(filename_record, anchor)
    assert filename_offset >= 0
    patched[filename_offset : filename_offset + len(filename_record)] = b"\xd3\x0dSettingMgr.py"

    assert len(patched) == len(original) == RAW_SIZE
    expected_integer = b"\xbe" + struct.pack("<I", fps) + b"\x2e\x11\xd3\x12setting_frame_rate"
    assert expected_integer in patched[anchor : anchor + 64]
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


def main() -> None:
    original_raw_path = ANALYSIS / "SettingManager-current.decompressed.bin"
    original_slot_path = ANALYSIS / "SettingManager-current.bin"
    output_dir = ROOT / "patches"
    output_dir.mkdir(parents=True, exist_ok=True)

    original_raw = original_raw_path.read_bytes()
    original_slot = original_slot_path.read_bytes()
    assert len(original_raw) == RAW_SIZE
    assert len(original_slot) == SLOT_SIZE
    assert sha256(original_slot) == ORIGINAL_SLOT_SHA256
    assert lz4.block.decompress(original_slot, uncompressed_size=RAW_SIZE) == original_raw

    artifacts = {"patch_original.bin": original_slot}
    for fps in (180, 240):
        patched_raw = make_raw_patch(original_raw, fps)
        compressed = lz4.block.compress(
            patched_raw,
            mode="high_compression",
            compression=7,
            store_size=False,
        )
        compressed = expand_lz4_without_changing_output(
            compressed, patched_raw, SLOT_SIZE - len(compressed)
        )
        assert len(compressed) == SLOT_SIZE
        assert lz4.block.decompress(compressed, uncompressed_size=RAW_SIZE) == patched_raw
        artifacts[f"patch_{fps}.bin"] = compressed

    for name, data in artifacts.items():
        (output_dir / name).write_bytes(data)
        print(f"{sha256(data)} *patches/{name}")


if __name__ == "__main__":
    main()
