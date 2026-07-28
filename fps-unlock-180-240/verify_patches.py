from __future__ import annotations

import hashlib
import struct
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ANALYSIS = ROOT.parent / "current-npk-fps-analysis"
sys.path.insert(0, str(ANALYSIS / "vendor"))
import lz4.block  # type: ignore  # noqa: E402


EXPECTED = {
    "patch_original.bin": "6F9165B65B8E32391E32FBC5174B8CC680E90C33C5887B46999D087ACE8FE050",
    "patch_180.bin": "4D0997446DBD08E7AF24C536AFA7D5055E29E8EBEEA07300B36CB95B9849B469",
    "patch_240.bin": "15AAC9544494399DDDEF72E8278D00DF492D5D45EE29A1D5FE610AA1896943C4",
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest().upper()


def main() -> None:
    raw_original = (ANALYSIS / "SettingManager-current.decompressed.bin").read_bytes()
    decompressed = {}
    for name, expected_hash in EXPECTED.items():
        data = (ROOT / "patches" / name).read_bytes()
        assert len(data) == 110_791
        assert digest(data) == expected_hash
        decompressed[name] = lz4.block.decompress(data, uncompressed_size=328_632)

    assert decompressed["patch_original.bin"] == raw_original
    for fps in (180, 240):
        raw = decompressed[f"patch_{fps}.bin"]
        marker = (
            b"\xd3\x0cuser_setting"
            + b"\xbe"
            + struct.pack("<I", fps)
            + b"\x2e\x11\xd3\x12setting_frame_rate"
        )
        anchor = raw.index(marker)
        assert raw[anchor - 770] == 0x44
        assert raw[anchor - 724] == 0x44
        assert b"\xd3\x0dSettingMgr.py" in raw[anchor : anchor + 512]
        print(f"{fps} FPS: LZ4、结构标记和固定整数校验通过")


if __name__ == "__main__":
    main()
