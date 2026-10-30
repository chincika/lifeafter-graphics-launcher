"""Build a stock-table, read-only-bindict-compatible local FPS prototype."""
import json
from pathlib import Path
from build_native240 import compile_fragments,digest,lz4,pad_lz4_to_fixed_size,patch_function
from neox_marshal import read_module

ROOT=Path(__file__).resolve().parent
ORIGINAL=ROOT/'patches'
OUT=ROOT/'generated'


def edit(raw,qual,fragments,**kwargs):
    _,functions=read_module(raw)
    found=[(p,s,n) for p,s,n in functions if n.fields['qualname'].value==qual]
    if len(found)!=1:raise ValueError('function is not unique: '+qual)
    pos,size,node=found[0];before=raw[pos+4:pos+4+size]
    first=patch_function(before,fragments,**kwargs);gap=size-len(first)
    if gap<5:raise ValueError('insufficient room for fixed-size edit: '+qual+' gap='+str(gap))
    after=patch_function(before,fragments,padding=gap-5,**kwargs)
    if len(after)!=size:raise AssertionError('function length changed')
    changed=raw[:pos+4]+after+raw[pos+4+size:]
    _,check=read_module(changed)
    for (p,s,n),(q,t,m) in zip(functions,check):
        if (p,s,n.fields['qualname'].value)!=(q,t,m.fields['qualname'].value):raise AssertionError('function layout changed')
        if p!=pos and raw[p+4:p+4+s]!=changed[q+4:q+4+t]:raise AssertionError('other function changed')
    return changed,{'function':qual,'offset':pos,'size':size,'oldSha256':digest(before),'newSha256':digest(after)}


def one(stem,source_index,edits,fragments):
    original_slot=(ORIGINAL/(stem+'.original.bin')).read_bytes()
    raw=lz4.block.decompress(original_slot,uncompressed_size={'panel':502316,'manager':321019}[stem])
    expected={'panel':'FF8DBF3EF199293EEA064E7B573142E95D73B461963CB4E1407F14FD1F270F3A',
              'manager':'6A39CF2B3BA2AF42A9A6F65F7273AE3C1D2E08477B3B3342A263C7D88D997C65'}[stem]
    if digest(raw)!=expected:raise ValueError('reviewed original module changed')
    reports=[];patched=raw
    for qual,kwargs in edits:
        patched,report=edit(patched,qual,fragments,**kwargs);reports.append(report)
    (OUT/(stem+'.original.raw')).write_bytes(raw)
    compressed=lz4.block.compress(patched,mode='high_compression',compression=12,store_size=False)
    if len(compressed)>len(original_slot):raise ValueError(stem+' does not fit the original slot')
    slot=pad_lz4_to_fixed_size(compressed,patched,len(original_slot))
    if lz4.block.decompress(slot,uncompressed_size=len(raw))!=patched:raise ValueError('compression roundtrip failed')
    (OUT/(stem+'.original.bin')).write_bytes(original_slot)
    (OUT/(stem+'.v04.bin')).write_bytes(slot)
    (OUT/(stem+'.v04.raw')).write_bytes(patched)
    return {'module':stem,'originalSlotSha256':digest(original_slot),'newSlotSha256':digest(slot),
            'originalRawSha256':digest(raw),'newRawSha256':digest(patched),'edits':reports}


def main():
    OUT.mkdir(exist_ok=True)
    fragments=compile_fragments()
    panel=one('panel',16453,[('PanelSetting.get_frame_conf',{'prefix':'initialize_mapping_v04','suffix':'append_ui_v04'})],fragments)
    manager=one('manager',31001,[
        ('SettingManager.init_preset_render_qualities',{'prefix':'initialize_mapping_v04'}),
        ('SettingManager.get_default_frame',{'prefix':'direct_saved_frame_v04'}),
        ('SettingManager.adjust_fps_and_apply_frame_prediction',{'prefix':'native_prediction_v04'}),
    ],fragments)
    report={'prototype':'0.4.0-preflight','game':'fever','stockPy3Sha256':'61D356DF5F7725D064AAD9029DF3A41B2CB9F654D22B1B641D1A944205A83EAB',
            'stockLcSha256':'C1145C125862D29A7023962AE61D3981DCEA7E2A6BD2915EEDB6A6ED71853B72',
            'records':[panel,manager]}
    (OUT/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
