"""Opcode names recovered from the reviewed client wordcode.

The CPython 3.14 interpreter is used for disassembly and isolated mock tests,
never for importing or running a complete game module.
"""
from __future__ import annotations

GAME_TO_NAME = {
    0x00:'CACHE', 0x07:'POP_TOP', 0x08:'TO_BOOL', 0x09:'PUSH_EXC_INFO',
    0x0c:'STORE_SUBSCR', 0x0e:'END_FOR', 0x18:'GET_ITER', 0x23:'POP_ITER',
    0x12:'RETURN_VALUE', 0x1a:'NOT_TAKEN', 0x22:'NOP', 0x27:'PUSH_NULL',
    0x2f:'JUMP_FORWARD', 0x31:'LOAD_FAST',
    0x33:'LOAD_FAST_BORROW_LOAD_FAST_BORROW', 0x37:'STORE_FAST_LOAD_FAST', 0x38:'BUILD_TUPLE',
    0x3b:'EXTENDED_ARG', 0x3f:'LOAD_ATTR', 0x44:'LOAD_CONST',
    0x45:'IMPORT_FROM', 0x47:'SWAP', 0x4b:'JUMP_BACKWARD', 0x4e:'CALL_KW', 0x51:'STORE_FAST_STORE_FAST',
    0x52:'BINARY_OP', 0x56:'CALL', 0x58:'POP_JUMP_IF_FALSE',
    0x59:'POP_JUMP_IF_NONE', 0x5a:'POP_JUMP_IF_NOT_NONE', 0x5b:'POP_JUMP_IF_TRUE', 0x61:'COMPARE_OP', 0x67:'LOAD_SMALL_INT',
    0x69:'BUILD_MAP', 0x6b:'STORE_ATTR', 0x6d:'BUILD_LIST',
    0x6e:'IMPORT_NAME', 0x72:'COPY', 0x73:'LOAD_FAST_BORROW',
    0x75:'FOR_ITER', 0x76:'STORE_FAST', 0x79:'UNPACK_SEQUENCE', 0x7a:'LOAD_GLOBAL', 0x7d:'CONTAINS_OP',
    0x80:'RESUME',
}


def translate(code: bytes, reverse=False):
    import dis, opcode
    names = {v:k for k,v in GAME_TO_NAME.items()}
    result = bytearray(code)
    pos = 0
    while pos < len(code):
        op = code[pos]
        if reverse:
            name = opcode.opname[op]
            if name not in names:
                raise ValueError(f'unmapped standard opcode {name} at {pos}')
            result[pos] = names[name]
        else:
            if op not in GAME_TO_NAME:
                raise ValueError(f'unmapped game opcode 0x{op:02x} at {pos}')
            name = GAME_TO_NAME[op]
            result[pos] = opcode.opmap[name]
        pos += 2 + 2 * dis._inline_cache_entries.get(name, 0)
    if pos != len(code):
        raise ValueError('inline cache boundary mismatch')
    return bytes(result)


def as_code(node):
    import types
    def value(n):
        if n.kind == 'ref':
            return value(n.fields['target'])
        if n.kind == 'tuple':
            return tuple(value(c) for c in n.children)
        if n.kind == 'frozenset':
            return frozenset(value(c) for c in n.children)
        if n.kind == 'code':
            return as_code(n)
        return n.value
    f = node.fields
    variables = value(f['localsplusnames'])
    return (lambda:None).__code__.replace(
        co_argcount=f['argcount'], co_posonlyargcount=f['posonlyargcount'],
        co_kwonlyargcount=f['kwonlyargcount'], co_nlocals=len(variables),
        co_stacksize=f['stacksize'], co_flags=f['flags'] & 0x00ffffff,
        co_code=translate(value(f['code'])), co_consts=value(f['consts']),
        co_names=value(f['names']), co_varnames=variables,
        co_filename=value(f['filename']), co_name=value(f['name']),
        co_qualname=value(f['qualname']), co_firstlineno=f['firstlineno'],
        co_linetable=b'', co_exceptiontable=value(f['exceptiontable']),
    )


if __name__ == '__main__':
    import argparse, dis
    from pathlib import Path
    from neox_marshal import read_module
    p=argparse.ArgumentParser()
    p.add_argument('module',type=Path)
    p.add_argument('functions',nargs='+')
    args=p.parse_args()
    name, functions=read_module(args.module.read_bytes())
    for offset,size,node in functions:
        if node.fields['qualname'].value in args.functions:
            print('\nFUNCTION',node.fields['qualname'].value,'at',offset)
            print('CONSTS',node.fields['consts'].value)
            print('NAMES',node.fields['names'].value)
            dis.dis(as_code(node), depth=0)
