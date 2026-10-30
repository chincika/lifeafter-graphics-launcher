"""Read the remapped marshal function records used by the local NeoX client.

This module never executes game code. Object spans allow narrowly scoped edits
without rebuilding unrelated references or code objects.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import struct


@dataclass
class Node:
    kind: str
    start: int
    end: int = 0
    value: object = None
    children: list = field(default_factory=list)
    fields: dict = field(default_factory=dict)


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0
        self.refs = []

    def take(self, n):
        if n < 0 or self.pos + n > len(self.data):
            raise ValueError(f"invalid length {n} at {self.pos}")
        result = self.data[self.pos:self.pos+n]
        self.pos += n
        return result

    def i32(self):
        return struct.unpack('<i', self.take(4))[0]

    def read(self):
        start = self.pos
        tag = self.take(1)[0]
        typ = tag & 0x7f
        node = Node(f'0x{typ:02x}', start)
        if tag & 0x80:
            self.refs.append(node)
        if typ == 0x73:  # code object
            node.kind = 'code'
            for key in ('argcount','posonlyargcount','kwonlyargcount','stacksize','flags'):
                node.fields[key] = self.i32()
            for key in ('code','consts','names','localsplusnames','localspluskinds',
                        'filename','name','qualname'):
                node.fields[key] = self.read()
            node.fields['firstlineno'] = self.i32()
            node.fields['linetable'] = self.read()
            node.fields['exceptiontable'] = self.read()
        elif typ in (0x2e, 0x75):
            node.kind = 'tuple'
            n = self.take(1)[0] if typ == 0x2e else self.i32()
            node.children = [self.read() for _ in range(n)]
            node.value = tuple(x.value for x in node.children)
        elif typ == 0x72:
            node.kind = 'frozenset'
            node.children = [self.read() for _ in range(self.i32())]
            node.value = frozenset(x.value for x in node.children)
        elif typ in (0x53, 0x79):
            node.kind = 'str'
            node.value = self.take(self.take(1)[0]).decode('ascii')
        elif typ == 0x28:
            node.kind = 'str'
            node.value = self.take(self.i32()).decode('utf-8', 'surrogatepass')
        elif typ == 0x7b:
            node.kind = 'bytes'
            node.value = self.take(self.i32())
        elif typ == 0x3e:
            node.kind = 'int'
            node.value = self.i32()
        elif typ == 0x30:
            node.kind = 'float'
            node.value = struct.unpack('<d', self.take(8))[0]
        elif typ == 0x3f:
            node.kind = 'int'
            size = self.i32()
            digits = struct.unpack('<' + 'H' * abs(size), self.take(2*abs(size)))
            node.value = sum(v << (15*i) for i,v in enumerate(digits)) * (-1 if size < 0 else 1)
        elif typ == 0x41:
            node.kind = 'slice'
            node.children = [self.read() for _ in range(3)]
            node.value = slice(*(x.value for x in node.children))
        elif typ == 0x78:
            node.kind = 'none'
            node.value = None
        elif typ in (0x3c,0x7a):
            node.kind = 'bool'
            node.value = typ == 0x7a
        elif typ == 0x5a:
            node.kind = 'ref'
            index = self.i32()
            if not 0 <= index < len(self.refs):
                raise ValueError(f'invalid reference {index} at {start}')
            node.value = self.refs[index].value
            node.fields['target'] = self.refs[index]
        else:
            raise ValueError(f"unknown tag 0x{tag:02x} at {start}: "
                             f"{self.data[max(0,start-24):start+48].hex(' ')}")
        node.end = self.pos
        return node


def read_module(data: bytes):
    size = struct.unpack_from('<I', data)[0]
    name = data[4:4+size].decode('utf-8')
    pos = 4 + size
    functions = []
    while pos < len(data):
        size = struct.unpack_from('<I', data, pos)[0]
        reader = Reader(data[pos+4:pos+4+size])
        try:
            code = reader.read()
        except Exception as ex:
            raise ValueError(f'{name}: function {len(functions)} at {pos}: {ex}') from ex
        if code.kind != 'code' or reader.pos != size:
            raise ValueError(f'{name}: invalid code boundary at {pos}: {reader.pos}/{size}')
        functions.append((pos, size, code))
        pos += 4 + size
    if pos != len(data):
        raise ValueError('invalid module end')
    return name, functions


if __name__ == '__main__':
    import sys
    for path in map(Path, sys.argv[1:]):
        name, functions = read_module(path.read_bytes())
        print(name, len(functions))
        for offset, size, code in functions:
            qualname = code.fields['qualname'].value
            if any(t in str(qualname).lower() for t in ('frame','fps','quality')):
                print(offset, size, qualname,
                      code.fields['argcount'], code.fields['localsplusnames'].value)
                if any(t in str(qualname) for t in ('get_frame_conf','get_setting_frame_rate',
                       'set_frame_rate','adjust_fps','get_default_frame_rate_index')):
                    print('  CONSTS', code.fields['consts'].value)
                    print('  NAMES', code.fields['names'].value)
