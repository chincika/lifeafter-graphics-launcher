"""Build two-module, fixed-slot experimental patches in the workspace only."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

from neox_marshal import Reader, read_module

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent.parent
sys.path.insert(0, str(WORKSPACE / 'current-npk-fps-analysis' / 'vendor'))
sys.path.insert(0, str(WORKSPACE / 'v2.4.0-system-core-fix' / 'fps-unlock-integration'))
import lz4.block
from build_patches import pad_lz4_to_fixed_size

GAME_CACHES = {0x3f:9,0x7a:4,0x56:3,0x08:3,0x52:5,0x61:1,
               0x58:1,0x59:1,0x5a:1,0x5b:1,0x0c:1,0x6b:4,
               0x79:1,0x75:1,0x4b:1}


def digest(data):
    return hashlib.sha256(data).hexdigest().upper()


def literal(value):
    """New values deliberately have no reference flag: old indices stay valid."""
    if value is None:
        return b'\x78'
    if type(value) is bool:
        return b'\x7a' if value else b'\x3c'
    if type(value) is int:
        return b'\x3e' + struct.pack('<i',value)
    if isinstance(value,str):
        b=value.encode('utf-8')
        if value.isascii() and len(b)<256:
            return b'\x53'+bytes((len(b),))+b
        return b'\x28'+struct.pack('<I',len(b))+b
    if isinstance(value,bytes):
        return b'\x7b'+struct.pack('<I',len(value))+value
    if isinstance(value,(list,tuple)):
        if len(value)>=256:
            raise ValueError('tuple literal exceeds supported size')
        return b'\x2e'+bytes((len(value),))+b''.join(literal(item) for item in value)
    raise TypeError(type(value))


def append_unique(values, value):
    for i,v in enumerate(values):
        if type(v) is type(value) and v == value:
            return i
    values.append(value)
    return len(values)-1


def rebase(fragment, node, constants, names):
    code=bytearray.fromhex(fragment['code'])
    locals_=node.fields['localsplusnames'].value
    pos=0
    while pos<len(code):
        op,arg=code[pos:pos+2]
        if op == 0x44:
            arg=append_unique(constants,fragment['consts'][arg])
        elif op in (0x3f,0x7a):
            arg=2*append_unique(names,fragment['names'][arg>>1])+(arg&1)
        elif op == 0x6b:
            # STORE_ATTR uses a plain name index (unlike LOAD_ATTR's flag bit).
            arg=append_unique(names,fragment['names'][arg])
        elif op in (0x73,0x31,0x76):
            arg=locals_.index(fragment['varnames'][arg])
        elif op in (0x33,0x51,0x3b):
            raise ValueError('fragment needs a wider instruction rewriter')
        if not 0<=arg<=255:
            raise ValueError('rebased argument exceeds one word')
        code[pos+1]=arg
        pos+=2+2*GAME_CACHES.get(op,0)
    if pos!=len(code):
        raise ValueError('fragment cache boundary mismatch')
    return bytes(code)


def tuple_append(raw,node,additions):
    if not additions:
        return raw[node.start:node.end]
    count=len(node.children)+len(additions)
    if raw[node.start]&0x7f!=0x2e or count>=256:
        raise ValueError('unsupported tuple size')
    return bytes((raw[node.start],count))+raw[node.start+2:node.end]+b''.join(literal(v) for v in additions)


def patch_function(raw, fragments, *, prefix=None,suffix=None,padding=None):
    r=Reader(raw)
    n=r.read()
    if r.pos!=len(raw) or n.fields['exceptiontable'].value:
        raise ValueError('patched functions must have an empty exception table')
    consts=list(n.fields['consts'].value)
    names=list(n.fields['names'].value)
    code=n.fields['code'].value
    if code[:2]!=b'\x80\x00':
        raise ValueError('missing RESUME')
    stack=n.fields['stacksize']
    if suffix:
        expected_tail=bytes.fromhex('73 17 73 18 73 19 73 1a 38 04 12 00')
        if code[-12:]!=expected_tail:
            raise ValueError('UI return contract changed')
        fragment=fragments[suffix]
        code=code[:-12]+rebase(fragment,n,consts,names)+code[-12:]
        stack=max(stack,fragment['stacksize'])
    if prefix:
        fragment=fragments[prefix]
        code=code[:2]+rebase(fragment,n,consts,names)+code[2:]
        stack=max(stack,fragment['stacksize'])
    if padding is not None:
        consts.append(bytes(padding))
    fields=n.fields
    changes=[(13,17,struct.pack('<i',stack))]
    for field, replacement in (
        ('code',bytes((raw[fields['code'].start],))+struct.pack('<I',len(code))+code),
        ('consts',tuple_append(raw,fields['consts'],consts[len(fields['consts'].value):])),
        ('names',tuple_append(raw,fields['names'],names[len(fields['names'].value):])),
        ('linetable',bytes((raw[fields['linetable'].start],))+struct.pack('<I',0)),
    ):
        node=fields[field]
        changes.append((node.start,node.end,replacement))
    result=raw
    for start,end,replacement in sorted(changes,reverse=True):
        result=result[:start]+replacement+result[end:]
    check=Reader(result)
    parsed=check.read()
    if check.pos!=len(result):
        raise ValueError('patched function failed round-trip parse')
    if parsed.fields['name'].value!=fields['name'].value:
        raise ValueError('function name changed')
    return result


def patch_module(original, fragments, module_name):
    name,functions=read_module(original)
    if name!=module_name:
        raise ValueError('wrong module')
    pieces=[]
    edits=[]
    padding_index=None
    for offset,size,node in functions:
        function=original[offset+4:offset+4+size]
        qualname=node.fields['qualname'].value
        kwargs=None
        if name=='ui.PanelSetting' and qualname=='PanelSetting.get_frame_conf':
            kwargs={'prefix':'initialize_table','suffix':'append_ui'}
        if name=='SettingManager' and qualname=='SettingManager.get_default_frame':
            kwargs={'prefix':'initialize_table'}
        if name=='SettingManager' and qualname=='SettingManager.adjust_fps_and_apply_frame_prediction':
            kwargs={'prefix':'native_prediction'}
        if name=='SettingManager' and node.fields['name'].value=='set_frame_rate':
            if qualname!='SettingManager.set_frame_rate' or len(node.fields['consts'].children)!=2:
                raise ValueError('build requires a verified original manager, not a 120 takeover')
        if kwargs:
            before=function
            function=patch_function(function,fragments,**kwargs)
            if padding_index is None:
                padding_index=(len(pieces),before,kwargs)
            edits.append({'function':qualname,'beforeBytes':size,'afterBytes':len(function),
                          'originalFunctionSha256':digest(before)})
        pieces.append(function)
    expected_edits=1 if name=='ui.PanelSetting' else 2
    if len(edits)!=expected_edits:
        raise ValueError('target functions are not unique')
    gap=len(original)-(4+len(name.encode())+sum(4+len(x) for x in pieces))
    if gap<5:
        raise ValueError(f'not enough debug metadata for fixed raw length: {gap}')
    i,before,kwargs=padding_index
    pieces[i]=patch_function(before,fragments,padding=gap-5,**kwargs)
    result=struct.pack('<I',len(name.encode()))+name.encode()+b''.join(struct.pack('<I',len(x))+x for x in pieces)
    if len(result)!=len(original):
        raise ValueError('module raw length changed')
    patched_name,patched_functions=read_module(result)
    for (_,_,old),(_,_,new) in zip(functions,patched_functions):
        if old.fields['qualname'].value!=new.fields['qualname'].value:
            raise ValueError('function lookup name changed')
    return result,edits


def compile_fragments():
    runtime=WORKSPACE/'current-npk-fps-analysis'/'python314'/'python.exe'
    command=[str(runtime),'-X','utf8','-c',
             "import sys,runpy;sys.path.insert(0,sys.argv.pop(1));runpy.run_module('compile_fragments',run_name='__main__')",str(ROOT)]
    return json.loads(subprocess.check_output(command,text=True,encoding='utf-8'))


def build_profile(profile, manager_path, panel_path, slot_sizes):
    fragments=compile_fragments()
    out=ROOT/'profiles'/profile
    out.mkdir(parents=True,exist_ok=True)
    report={'profile':profile,'experimental':True,'modules':[]}
    for path,module_name,size in zip((manager_path,panel_path),('SettingManager','ui.PanelSetting'),slot_sizes):
        raw=Path(path).read_bytes()
        patched,edits=patch_module(raw,fragments,module_name)
        compressed=lz4.block.compress(patched,mode='high_compression',compression=12,store_size=False)
        if len(compressed)>size:
            raise ValueError(f'{module_name} no longer fits: {len(compressed)}/{size}')
        compressed=pad_lz4_to_fixed_size(compressed,patched,size)
        if len(compressed)!=size or lz4.block.decompress(compressed,uncompressed_size=len(raw))!=patched:
            raise ValueError('fixed-slot compressed round-trip failed')
        stem=module_name.replace('.','_')
        (out/(stem+'.original.raw')).write_bytes(raw)
        (out/(stem+'.native240.raw')).write_bytes(patched)
        (out/(stem+'.native240.bin')).write_bytes(compressed)
        report['modules'].append({'module':module_name,'rawBytes':len(raw),'slotBytes':size,
                                  'originalRawSha256':digest(raw),'patchedRawSha256':digest(patched),
                                  'patchedSlotSha256':digest(compressed),'edits':edits})
    (out/'build-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return report


if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser()
    p.add_argument('profile')
    p.add_argument('manager',type=Path)
    p.add_argument('panel',type=Path)
    p.add_argument('--slots',nargs=2,type=int,required=True)
    a=p.parse_args()
    build_profile(a.profile,a.manager,a.panel,a.slots)
