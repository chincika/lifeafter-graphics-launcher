"""Exercise 11/19 adaptation and startup recovery on isolated E: copies.

The installed package is read only. This test uses, but never grants, the
existing local FPS consent. It keeps a failed fixture for diagnosis.
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
WORK = (WORKSPACE / 'work' / 'black-screen-20261119' / 'test-fixtures').resolve()
sys.path[:0] = [str(WORKSPACE / 'current-npk-fps-analysis' / 'vendor'), str(HERE),
                str(REPO / 'fps-unlock-integration')]
import lz4.block
from build_patches import pad_lz4_to_fixed_size
from neox_marshal import read_module

ARCHIVE = Path(os.environ.get('LIFEAFTER_TEST_FEVER_ARCHIVE', r'E:\FeverGames\mrzh\Documents\script.py314.lc.npk'))
TABLE = Path(os.environ.get('LIFEAFTER_TEST_FEVER_TABLE', r'E:\FeverGames\mrzh\Documents\script.py3.npk'))
EXPECTED = '5A806F86448A005A1ECCF0E9EF8BBEA76C667B32AB6D2E54BE55A661D206D95E'
BACKEND_DIR = REPO / 'desktop-app' / 'backend'
MANAGER = (330432568, 111285, 325075)
PANEL = (191342368, 162987, 502408)
TABLE_OFFSET = 85081088
RUNTIME = WORKSPACE / 'current-npk-fps-analysis' / 'python314' / 'python.exe'

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024*1024), b''): h.update(chunk)
    return h.hexdigest().upper()

def read_at(path, pos, size):
    with path.open('rb') as f: f.seek(pos); result=f.read(size)
    assert len(result) == size
    return result

def write_at(path, pos, value):
    with path.open('r+b') as f: f.seek(pos); f.write(value); f.flush(); os.fsync(f.fileno())

def command(exe, args, ok=True):
    result = subprocess.run([str(exe), *args], capture_output=True, encoding='utf-8-sig', timeout=300)
    if (result.returncode == 0) != ok: raise AssertionError((args, result.returncode, result.stdout, result.stderr))
    return result.stdout if ok else result.stderr

def call(exe, root, action, ok=True):
    result = command(exe, ['--native-fps-'+action, str(root)], ok)
    return json.loads(result) if ok else result

def mutate_manager(lc, mode):
    pos, size, raw_size = MANAGER
    slot = read_at(lc, pos, size)
    raw = bytearray(lz4.block.decompress(slot, uncompressed_size=raw_size))
    _, entries = read_module(raw)
    targets = {'SettingManager.init_preset_render_qualities','SettingManager.get_default_frame',
               'SettingManager.adjust_fps_and_apply_frame_prediction','SettingManager.set_frame_rate',
               'SettingManager.get_setting_frame_rate','SettingManager.get_default_frame_rate_index'}
    if mode == 'unrelated':
        offset, _, node = next(x for x in entries if x[2].fields['qualname'].value not in targets)
        raw[offset+4+node.fields['qualname'].end] ^= 1
    else:
        offset, _, node = next(x for x in entries if x[2].fields['qualname'].value == 'SettingManager.get_default_frame')
        raw[offset+4+node.fields['code'].start+5] ^= 1
    compressed = lz4.block.compress(bytes(raw), mode='high_compression', compression=12, store_size=False)
    assert len(compressed) <= size
    write_at(lc, pos, pad_lz4_to_fixed_size(compressed, bytes(raw), size))
    return slot

def main():
    assert str(WORK).upper().startswith('E:\\') and WORKSPACE.resolve() in WORK.parents
    WORK.mkdir(parents=True, exist_ok=True)
    fixture = Path(tempfile.mkdtemp(prefix='fever-1119-', dir=WORK)).resolve()
    assert fixture.parent == WORK and fixture.name.startswith('fever-1119-') and not fixture.is_symlink()
    passed = False
    try:
        before = ARCHIVE.stat()
        assert digest(ARCHIVE) == EXPECTED, 'Source archive differs from the reviewed sample'
        runtime = fixture / 'runtime'; runtime.mkdir()
        for name in ('LifeAfterBackend.exe','K4os.Compression.LZ4.dll','System.Buffers.dll','System.Memory.dll',
                     'System.Numerics.Vectors.dll','System.Runtime.CompilerServices.Unsafe.dll'):
            shutil.copyfile(BACKEND_DIR/name, runtime/name)
        exe = runtime/'LifeAfterBackend.exe'
        consent=json.loads(command(exe, ['--fps-consent-status']))
        assert consent['accepted'], 'Existing local consent is required; this test never grants it'
        root=fixture/'game'; docs=root/'Documents'; configs=docs/'configs'; configs.mkdir(parents=True)
        (root/'mingrizhihou.exe').write_bytes(b'fixture')
        (runtime/'LifeAfterLauncher.path').write_text(str(root), encoding='utf-8')
        (docs/'update.ini').write_text('[Setting]\nversion=0.261118203.1\n',encoding='utf-8')
        (configs/'pcconfig').write_text('{"resolution":[2560,1440]}',encoding='utf-8')
        quality=configs/'qualityconfig'; quality.write_text('{"frame":10,"other":{"frame":7}}',encoding='utf-8')
        lc=docs/'script.py314.lc.npk'; table=docs/'script.py3.npk'
        shutil.copyfile(ARCHIVE,lc); shutil.copyfile(TABLE,table)
        assert digest(lc)==EXPECTED
        assert (ARCHIVE.stat().st_size, ARCHIVE.stat().st_mtime_ns)==(before.st_size,before.st_mtime_ns)
        assert call(exe,root,'status')['state']=='official'
        result=call(exe,root,'repair-startup')
        assert result['state']=='startup-repaired' and json.loads(quality.read_text(encoding='utf-8'))=={'frame':4,'other':{'frame':7}}
        journal=json.loads((Path(result['backup'])/'startup-repair-journal.json').read_text(encoding='utf-8'))
        assert journal['state']=='repaired' and digest(Path(journal['configBackup']))==journal['beforeSha256'] and digest(lc)==EXPECTED
        assert call(exe,root,'repair-startup')['state']=='startup-ok'

        quality.write_text('{"frame":7,"other":{"frame":7}}',encoding='utf-8')
        applied=call(exe,root,'apply'); assert applied['state']=='native' and digest(lc)!=EXPECTED
        assert digest(Path(applied['backup'])/'script.py314.lc.npk.before')==EXPECTED
        assert '已安装' in call(exe,root,'repair-startup',False) and json.loads(quality.read_text())['frame']==7
        journal_path=Path(applied['backup'])/'adaptive-journal.json'
        journal=json.loads(journal_path.read_text(encoding='utf-8')); journal['state']='prepared'
        journal_path.write_text(json.dumps(journal),encoding='utf-8')
        saved_bytes=read_at(lc,MANAGER[0],80); write_at(lc,MANAGER[0],bytes(80)); partial=digest(lc)
        quality.write_text('{"frame":7,"other":{"setting":7}}',encoding='utf-8')
        assert call(exe,root,'status')['state']=='partial'
        assert '未完成' in command(exe,['--apply','2K 120'],False)
        assert '未完成' in command(exe,['--apply','540p 25','--launch'],False)
        assert digest(lc)==partial and json.loads(quality.read_text())['frame']==7
        write_at(lc,MANAGER[0],saved_bytes)
        journal['state']='installed'; journal_path.write_text(json.dumps(journal),encoding='utf-8')
        quality.write_text('{"frame":7,"other":{"frame":7}}',encoding='utf-8')
        generated=fixture/'semantic'/'generated'; generated.mkdir(parents=True)
        for kind,(offset,size,raw_size),expected in (
            ('manager',MANAGER,'4A3A206EFD4633C1D6BE4C3FB34C2740C957A5729CEEF78B6B8ED09411115A60'),
            ('panel',PANEL,'EB58B5F285F429E95FD8389E1A5A6B0830853D0E16C552E51B5E6E704CA45BD5')):
            patched=lz4.block.decompress(read_at(lc,offset,size),uncompressed_size=raw_size)
            original=lz4.block.decompress(read_at(Path(applied['backup'])/'script.py314.lc.npk.before',offset,size),uncompressed_size=raw_size)
            assert hashlib.sha256(patched).hexdigest().upper()==expected
            (generated/(kind+'.v04.raw')).write_bytes(patched); (generated/(kind+'.original.raw')).write_bytes(original)
        code="import sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);import test_v04_semantics as t;t.ROOT=Path(sys.argv[2]);t.main()"
        semantics=json.loads(command(RUNTIME,['-B','-X','utf8','-c',code,str(HERE),str(generated.parent)]))
        assert semantics['status']=='passed' and semantics['uiCases']==10 and semantics['engineCases']==352
        code="import sys,runpy;sys.path.insert(0,sys.argv.pop(1));runpy.run_module('test_fever_20261106_semantics',run_name='__main__')"
        comparison=json.loads(command(RUNTIME,['-B','-X','utf8','-c',code,str(HERE),str(generated)]))
        assert comparison['originalBehaviorCases']==1792 and comparison['highFrameCases']==8
        assert call(exe,root,'restore')['state']=='official' and digest(lc)==EXPECTED
        assert json.loads(quality.read_text())=={'frame':4,'other':{'frame':7}}

        stock=mutate_manager(lc,'unrelated'); unknown=digest(lc)
        quality.write_text('{"frame":10,"other":{"frame":7}}',encoding='utf-8')
        assert '来源未知' in call(exe,root,'status',False)
        assert '来源未知' in call(exe,root,'apply',False) and digest(lc)==unknown
        assert call(exe,root,'repair-startup')['state']=='startup-repaired' and digest(lc)==unknown
        assert json.loads(quality.read_text())=={'frame':4,'other':{'frame':7}}
        # The normal 120 preset uses the same fallback before writing settings.
        quality.write_text('{"frame":10,"other":{"setting":7}}',encoding='utf-8')
        command(exe,['--apply','2K 120'])
        assert json.loads(quality.read_text())=={'frame':4,'other':{'setting':7}} and digest(lc)==unknown

        quality.write_text('{"frame":10,"other":{"frame":7}}',encoding='utf-8')
        old=read_at(table,TABLE_OFFSET,1); write_at(table,TABLE_OFFSET,bytes([old[0]^1]))
        assert '帧率表' in call(exe,root,'repair-startup',False) and json.loads(quality.read_text())['frame']==10
        write_at(table,TABLE_OFFSET,old)
        part=docs/'script.py314.lc.npk.part'; part.write_bytes(b'partial')
        future=time.time()+30; os.utime(part,(future,future))
        assert '未完成更新' in call(exe,root,'repair-startup',False) and json.loads(quality.read_text())['frame']==10
        part.unlink()
        quality.write_text('{"frame":10,"frame":4}',encoding='utf-8')
        assert '唯一' in call(exe,root,'repair-startup',False)
        write_at(lc,MANAGER[0],stock); assert digest(lc)==EXPECTED
        mutate_manager(lc,'lookup')
        quality.write_text('{"frame":10}',encoding='utf-8')
        assert '读取逻辑' in call(exe,root,'repair-startup',False) and json.loads(quality.read_text())['frame']==10
        assert digest(ARCHIVE)==EXPECTED
        print(json.dumps({'status':'passed','source':'local 2026-11-19 Fever archive','uiCases':10,'engineCases':352,
                          'originalPredictionCases':1792,'installRestore':True,'startupRepair':True,
                          'unknownModulesBlockedForWrite':True,'automaticPresetRecovery':True,
                          'changedLookupTableOrPendingUpdateBlocked':True,'installedGameWritten':False},ensure_ascii=False))
        passed=True
    finally:
        assert fixture.parent==WORK and fixture.name.startswith('fever-1119-') and not fixture.is_symlink()
        if passed: shutil.rmtree(fixture)
        else: print('Fixture retained for inspection: '+str(fixture),file=sys.stderr)

if __name__ == '__main__': main()
