"""Exercise the reviewed 1106 Fever adaptation only on E: fixture copies.

The installed archive and table are opened read-only. The backend's existing
local consent must already have been accepted; this test never grants consent.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
WORKSPACE = REPO.parent
sys.path[:0] = [str(WORKSPACE / 'current-npk-fps-analysis' / 'vendor'), str(HERE),
                str(REPO / 'fps-unlock-integration')]
import lz4.block
from build_patches import pad_lz4_to_fixed_size
from neox_marshal import read_module

ARCHIVE = Path(os.environ.get('LIFEAFTER_TEST_FEVER_ARCHIVE', r'E:\FeverGames\mrzh\Documents\script.py314.lc.npk'))
TABLE = Path(os.environ.get('LIFEAFTER_TEST_FEVER_TABLE', r'E:\FeverGames\mrzh\Documents\script.py3.npk'))
EXPECTED = '8AC3CD156AE50D99D6C79249AAB411930A58D1C841459A881C857DBA7DB62B71'
BACKEND = REPO / 'desktop-app' / 'backend' / 'LifeAfterBackend.exe'
WORK = (WORKSPACE / 'work' / 'fever-20261106' / 'test-fixtures').resolve()
MANAGER = (204886708, 109022, 320240)
PANEL = (209413872, 162379, 500735)
RUNTIME = WORKSPACE / 'current-npk-fps-analysis' / 'python314' / 'python.exe'

def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for data in iter(lambda:f.read(1024*1024),b''): h.update(data)
    return h.hexdigest().upper()

def read_at(path, offset, length):
    with path.open('rb') as f:
        f.seek(offset); data=f.read(length)
    assert len(data)==length
    return data

def write_at(path, offset, data):
    with path.open('r+b') as f:
        f.seek(offset); f.write(data); f.flush(); os.fsync(f.fileno())

def call(root, action, ok=True):
    result=subprocess.run([str(BACKEND),'--native-fps-'+action,str(root)],
                          capture_output=True,encoding='utf-8-sig',timeout=300)
    if (result.returncode==0)!=ok:
        raise AssertionError((action,result.returncode,result.stdout,result.stderr))
    return json.loads(result.stdout) if ok else result.stderr

def main():
    assert str(WORK).upper().startswith('E:\\') and WORKSPACE.resolve() in WORK.parents
    WORK.mkdir(parents=True,exist_ok=True)
    fixture=Path(tempfile.mkdtemp(prefix='fever-1106-',dir=WORK)).resolve()
    assert fixture.parent==WORK and fixture.name.startswith('fever-1106-') and not fixture.is_symlink()
    passed=False
    try:
        status=json.loads(subprocess.check_output([str(BACKEND),'--fps-consent-status'],encoding='utf-8-sig'))
        assert status['accepted'], 'The existing disclaimer must already be accepted; this test does not change it.'
        before_stat=ARCHIVE.stat()
        assert digest(ARCHIVE)==EXPECTED, 'Source archive differs from the reviewed 1106 sample'
        root=fixture/'game'; docs=root/'Documents'; configs=docs/'configs'
        configs.mkdir(parents=True)
        (root/'mingrizhihou.exe').write_bytes(b'fixture')
        (docs/'update.ini').write_text('[Setting]\nversion=0.261103235.1\n',encoding='utf8')
        (configs/'pcconfig').write_text('{"resolution":[2560,1440]}',encoding='utf8')
        quality=configs/'qualityconfig'
        quality.write_text('{"frame":7,"other":{"frame":7}}',encoding='utf8')
        lc=docs/'script.py314.lc.npk'; table=docs/'script.py3.npk'
        shutil.copyfile(ARCHIVE,lc); shutil.copyfile(TABLE,table)
        assert digest(lc)==EXPECTED
        assert (ARCHIVE.stat().st_size,ARCHIVE.stat().st_mtime_ns)==(before_stat.st_size,before_stat.st_mtime_ns)
        table_before=digest(table)
        state=call(root,'status'); assert state['state']=='official' and not state['gameRunning'] and not state['updatePending']

        part=docs/'script.py314.lc.npk.part'; part.write_bytes(b'incomplete update fixture')
        future=time.time()+30; os.utime(part,(future,future))
        assert call(root,'status')['updatePending']
        assert '未完成更新' in call(root,'apply',False) and digest(lc)==EXPECTED
        part.unlink()

        applied=call(root,'apply'); assert applied['state']=='native' and digest(lc)!=EXPECTED
        backup=Path(applied['backup']).resolve(); assert root.resolve() in backup.parents
        assert digest(backup/'script.py314.lc.npk.before')==EXPECTED
        assert digest(table)==table_before and json.loads(quality.read_text(encoding='utf8'))['frame']==7
        current=digest(lc); assert call(root,'apply')['state']=='native' and digest(lc)==current
        assert call(root,'status')['restoreAvailable']

        generated=fixture/'semantic'/'generated'; generated.mkdir(parents=True)
        for kind,(offset,size,raw_size),expected in (
            ('manager',MANAGER,'C189BE2D161A6FBB5ECC6D67FCCD7036D02F4C5FFF24509C7BE5E078CAA881CD'),
            ('panel',PANEL,'6E30FA5AF3437262A462AC1CE8CFAD19E0D026720F1D82C61F6691C186CF5BE1')):
            patched=lz4.block.decompress(read_at(lc,offset,size),uncompressed_size=raw_size)
            original=lz4.block.decompress(read_at(backup/'script.py314.lc.npk.before',offset,size),uncompressed_size=raw_size)
            assert hashlib.sha256(patched).hexdigest().upper()==expected
            (generated/(kind+'.v04.raw')).write_bytes(patched)
            (generated/(kind+'.original.raw')).write_bytes(original)
        code="import sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);import test_v04_semantics as t;t.ROOT=Path(sys.argv[2]);t.main()"
        semantic=subprocess.run([str(RUNTIME),'-B','-X','utf8','-c',code,str(HERE),str(generated.parent)],
                                capture_output=True,encoding='utf8',timeout=120)
        assert semantic.returncode==0,(semantic.stdout,semantic.stderr)
        result=json.loads(semantic.stdout); assert result['status']=='passed' and result['uiCases']==10 and result['engineCases']==352
        code2="import sys,runpy;sys.path.insert(0,sys.argv.pop(1));runpy.run_module('test_fever_20261106_semantics',run_name='__main__')"
        comparison=subprocess.run([str(RUNTIME),'-B','-X','utf8','-c',code2,str(HERE),str(generated)],
                                  capture_output=True,encoding='utf8',timeout=120)
        assert comparison.returncode==0,(comparison.stdout,comparison.stderr)
        cases=json.loads(comparison.stdout); assert cases['status']=='passed' and cases['originalBehaviorCases']==1792 and cases['highFrameCases']==8

        restored=call(root,'restore'); assert restored['state']=='official' and digest(lc)==EXPECTED
        assert json.loads(quality.read_text(encoding='utf8'))=={'frame':4,'other':{'frame':7}}
        assert digest(table)==table_before

        # A lost write must recover only from the exact transaction backup.
        second=call(root,'apply'); journal=Path(second['backup'])/'adaptive-journal.json'
        info=json.loads(journal.read_text(encoding='utf8')); info['state']='prepared'
        journal.write_text(json.dumps(info),encoding='utf8')
        write_at(lc,MANAGER[0],bytes(80))
        state=call(root,'status'); assert state['state']=='partial' and state['restoreAvailable']
        assert call(root,'restore')['state']=='official' and digest(lc)==EXPECTED

        # A valid but unreviewed module must be rejected even if FPS functions match.
        offset,size,raw_size=MANAGER; slot=read_at(lc,offset,size)
        raw=bytearray(lz4.block.decompress(slot,uncompressed_size=raw_size))
        _,records=read_module(raw)
        targets={'SettingManager.init_preset_render_qualities','SettingManager.get_default_frame',
                 'SettingManager.adjust_fps_and_apply_frame_prediction','SettingManager.set_frame_rate',
                 'SettingManager.get_setting_frame_rate','SettingManager.get_default_frame_rate_index'}
        position,length,node=next(item for item in records if item[2].fields['qualname'].value not in targets)
        raw[position+4+node.fields['qualname'].end]^=1
        compressed=lz4.block.compress(bytes(raw),mode='high_compression',compression=12,store_size=False)
        assert len(compressed)<=size
        altered=pad_lz4_to_fixed_size(compressed,bytes(raw),size)
        write_at(lc,offset,altered); unknown=digest(lc)
        assert '来源未知' in call(root,'apply',False) and digest(lc)==unknown
        write_at(lc,offset,slot); assert digest(lc)==EXPECTED

        original_table_byte=read_at(table,85081088,1)
        write_at(table,85081088,bytes([original_table_byte[0]^1]))
        assert '帧率表' in call(root,'apply',False) and digest(lc)==EXPECTED
        write_at(table,85081088,original_table_byte); assert digest(table)==table_before
        assert digest(ARCHIVE)==EXPECTED
        print(json.dumps({'status':'passed','source':'11/06 Fever local archive','uiCases':10,'engineCases':352,'originalBehaviorCases':1792,
                          'installAndRestore':True,'interruptedRecovery':True,'unknownModuleRejected':True,
                          'changedTableRejected':True,'incompleteUpdateRejected':True,'gameFilesWritten':False},ensure_ascii=False))
        passed=True
    finally:
        assert fixture.parent==WORK and fixture.name.startswith('fever-1106-') and not fixture.is_symlink()
        if passed: shutil.rmtree(fixture)
        else: print('Fixture retained for inspection: '+str(fixture),file=sys.stderr)

if __name__=='__main__': main()
