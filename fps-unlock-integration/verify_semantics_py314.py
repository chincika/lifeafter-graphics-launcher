from __future__ import annotations

import types


# Recovered NetEase opcode -> official CPython 3.14 opcode mapping for the
# instructions used by the injected branch.
OPCODE_MAP = {
    0x73: 86,   # LOAD_FAST_BORROW
    0x67: 94,   # LOAD_SMALL_INT
    0x61: 56,   # COMPARE_OP
    0x58: 100,  # POP_JUMP_IF_FALSE
    0x1A: 28,   # NOT_TAKEN
    0x44: 82,   # LOAD_CONST
    0x76: 112,  # STORE_FAST
}


def template(frame):
    return frame


def main() -> None:
    stored_prefix = bytes.fromhex(
        "73 00 67 78 61 58 00 00 58 03 00 00 1a 00 44 01 76 00"
    )
    standard_prefix = bytes(
        OPCODE_MAP.get(value, value) if index % 2 == 0 else value
        for index, value in enumerate(stored_prefix)
    )
    pass_through_values = (25, 30, 40, 50, 60, 90, 180, 240, 300)
    for target in (180, 240, 300):
        # RESUME + injected branch + LOAD_FAST frame + RETURN_VALUE
        code = b"\x80\x00" + standard_prefix + b"\x54\x00\x23\x00"
        code_object = template.__code__.replace(
            co_code=code,
            co_consts=(None, target),
            co_stacksize=2,
        )
        function = types.FunctionType(code_object, {})
        if function(120) != target:
            raise AssertionError(f"120 was not replaced by {target}")
        for value in pass_through_values:
            if function(value) != value:
                raise AssertionError(f"{target}: {value} did not pass through")
        print(f"verified semantics: 120 -> {target}; all other tiers unchanged")


if __name__ == "__main__":
    main()
