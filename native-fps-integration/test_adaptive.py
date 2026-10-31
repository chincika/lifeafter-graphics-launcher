"""Exercise adaptive transactions on private copies of two reviewed archives.

The test never writes to the installed game, saved launcher root, or consent.
It needs the local research backups and the already accepted local disclaimer.
"""
import hashlib
import ctypes
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
WORKSPACE = REPO.parent
WORK = (HERE / 'test-work').resolve()
FIXTURE = (WORK / ('adaptive-' + uuid.uuid4().hex[:12])).resolve()
assert FIXTURE.parent == WORK and REPO.resolve() in FIXTURE.parents
sys.path[:0] = [str(WORKSPACE / 'current-npk-fps-analysis' / 'vendor'), str(HERE),
                str(REPO / 'fps-unlock-integration')]
import lz4.block
from build_patches import pad_lz4_to_fixed_size
from neox_marshal import read_module
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

EXE = REPO / 'desktop-app' / 'backend' / 'LifeAfterBackend.exe'
LAB = WORKSPACE / 'native-240-option-lab' / 'live-backups' / '20261030-1828-table-first'
SAMPLES = {
    'fever': {
        'lc': LAB / 'script.py314.lc.npk.original',
        'lcHash': 'C1145C125862D29A7023962AE61D3981DCEA7E2A6BD2915EEDB6A6ED71853B72',
        'docTable': LAB / 'script.py3.npk.original',
        'manager': (237231880, 108926, 321019), 'panel': (239435364, 162653, 502316),
        'tableOffset': 85081088,
    },
    'oldpc': {
        'lc': Path(r'D:\Program Files (x86)\LifeAfter\Documents\fps_unlock_backups\script.py314.lc.npk.20261001-135231-446.original.A4F6253174051898.bak'),
        'lcHash': 'A4F62531740518980D3E6FD79523871CDAF0A468B1DF8EEEEE462616419DFCB5',
        'docTable': Path(r'D:\Program Files (x86)\LifeAfter\Documents\script.py3.npk'),
        'rootTable': Path(r'D:\Program Files (x86)\LifeAfter\script.py3.npk'),
        'manager': (272986080, 106919, 315527), 'panel': (277263908, 161147, 497709),
        'tableOffset': 132526344,
    },
}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest().upper()


def write_at(path, pos, value):
    with path.open('r+b') as f:
        f.seek(pos)
        f.write(value)
        f.flush()
        os.fsync(f.fileno())


def read_at(path, pos, size):
    with path.open('rb') as f:
        f.seek(pos)
        value = f.read(size)
        assert len(value) == size
        return value


def run(root, action, success=True):
    p = subprocess.run([str(EXE), '--native-fps-' + action, str(root)], capture_output=True,
                       encoding='utf-8-sig', timeout=300)
    if (p.returncode == 0) != success:
        raise AssertionError((action, p.returncode, p.stdout, p.stderr))
    return json.loads(p.stdout) if success else p.stderr


def report(message):
    print(message, flush=True)


def verify_semantics(root, profile, slots):
    target = root / 'semantics' / 'generated'
    target.mkdir(parents=True)
    for name in ('manager', 'panel'):
        offset, size, raw_size = slots[name]
        raw = lz4.block.decompress(read_at(root / 'Documents' / 'script.py314.lc.npk', offset, size),
                                   uncompressed_size=raw_size)
        (target / (name + '.v04.raw')).write_bytes(raw)
        source = WORKSPACE / 'fps-auto-adaptation-research' / profile / 'generated' / (name + '.original.raw')
        shutil.copyfile(source, target / (name + '.original.raw'))
    runtime = WORKSPACE / 'current-npk-fps-analysis' / 'python314' / 'python.exe'
    command = ('import sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);'
               'import test_v04_semantics as t;t.ROOT=Path(sys.argv[2]);t.main()')
    p = subprocess.run([str(runtime), '-X', 'utf8', '-c', command, str(HERE), str(root / 'semantics')],
                       capture_output=True, text=True, encoding='utf-8', timeout=120)
    if p.returncode: raise AssertionError((p.stdout, p.stderr))
    result = json.loads(p.stdout)
    assert result['status'] == 'passed' and result['uiCases'] == 10 and result['engineCases'] == 352


def test_index_rejections(root, lc, before):
    key = bytes([96, 99, 8, 216, 163, 44, 120, 32, 19, 210, 108, 47, 34, 111, 104, 109])
    def crypt(data, decrypt):
        cipher = Cipher(algorithms.AES(key), modes.ECB())
        context = cipher.decryptor() if decrypt else cipher.encryptor()
        return context.update(data) + context.finalize()
    header = crypt(read_at(lc, 0, 32), True)
    index_pos, count = struct.unpack_from('<II', header, 16)
    encrypted = read_at(lc, index_pos, count * 48)
    index = bytearray(crypt(encrypted, True))
    targets = [i for i in range(count) if struct.unpack_from('<II', index, i * 48) == (4238962030, 3758457633)]
    assert len(targets) == 1 and targets[0] != 0
    record = index[targets[0] * 48:targets[0] * 48 + 48]
    duplicate = bytearray(index)
    duplicate[:48] = record
    write_at(lc, index_pos, crypt(bytes(duplicate), False))
    assert '重复' in run(root, 'status', False)
    missing = bytearray(index)
    missing[targets[0] * 48:targets[0] * 48 + 48] = index[:48]
    write_at(lc, index_pos, crypt(bytes(missing), False))
    assert '缺少' in run(root, 'status', False)
    write_at(lc, index_pos, encrypted)
    assert digest(lc) == before


def test_relocated_slot(root, lc, spec):
    key = bytes([96, 99, 8, 216, 163, 44, 120, 32, 19, 210, 108, 47, 34, 111, 104, 109])
    def crypt(data, decrypt):
        cipher = Cipher(algorithms.AES(key), modes.ECB())
        context = cipher.decryptor() if decrypt else cipher.encryptor()
        return context.update(data) + context.finalize()
    header = bytearray(crypt(read_at(lc, 0, 32), True))
    index_pos, count = struct.unpack_from('<II', header, 16)
    index = bytearray(crypt(read_at(lc, index_pos, count * 48), True))
    target = [i for i in range(count) if struct.unpack_from('<II', index, i * 48) == (4238962030, 3758457633)]
    assert len(target) == 1
    offset, size, _ = spec['manager']
    slot = read_at(lc, offset, size)
    struct.pack_into('<I', index, target[0] * 48 + 8, index_pos)
    struct.pack_into('<I', header, 16, index_pos + size)
    relocated = lc.with_name('relocated.npk')
    saved = lc.with_name('fixture-original.npk')
    with lc.open('rb') as src, relocated.open('wb') as dst:
        remaining = index_pos
        while remaining:
            block = src.read(min(1024 * 1024, remaining))
            assert block
            dst.write(block)
            remaining -= len(block)
        dst.write(slot)
        dst.write(crypt(bytes(index), False))
        dst.seek(0)
        dst.write(crypt(bytes(header), False))
    lc.rename(saved)
    relocated.rename(lc)
    relocated_hash = digest(lc)
    try:
        assert run(root, 'status')['state'] == 'official'
        assert run(root, 'apply')['state'] == 'native'
        assert run(root, 'restore')['state'] == 'official'
        assert digest(lc) == relocated_hash
    finally:
        lc.unlink()
        saved.rename(lc)


def test_profile(profile, spec):
    report('Preparing ' + profile)
    root = FIXTURE / profile
    docs = root / 'Documents'
    configs = docs / 'configs'
    configs.mkdir(parents=True)
    (root / ('mingrizhihou.exe' if profile == 'fever' else 'lifeafter.exe')).write_bytes(b'fixture')
    (configs / 'pcconfig').write_text('{"resolution":[2560,1440]}', encoding='utf-8')
    quality = configs / 'qualityconfig'
    quality.write_text('{"frame":7,"other":{"frame":7}}', encoding='utf-8')
    (docs / 'update.ini').write_text('fixture-version=1', encoding='utf-8')
    assert digest(spec['lc']) == spec['lcHash']
    lc = docs / 'script.py314.lc.npk'
    shutil.copyfile(spec['lc'], lc)
    shutil.copyfile(spec['docTable'], docs / 'script.py3.npk')
    if 'rootTable' in spec: shutil.copyfile(spec['rootTable'], root / 'script.py3.npk')
    # Simulate an update outside the two target records; the old whole-package
    # profile must not be required, and neither module is changed.
    old = read_at(lc, 100, 1)
    write_at(lc, 100, bytes([old[0] ^ 1]))
    before = digest(lc)
    status = run(root, 'status')
    assert status['state'] == 'official' and status['adaptation'] == 'reviewed-modules'
    # An updater or game holding an exclusive handle must prevent the write.
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateFileW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32,
                                   ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p]
    kernel.CreateFileW.restype = ctypes.c_void_p
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.CreateFileW(str(lc), 0x80000000, 0, None, 3, 0, None)
    assert handle != ctypes.c_void_p(-1).value
    try:
        run(root, 'apply', False)
    finally:
        kernel.CloseHandle(handle)
    assert digest(lc) == before
    # An unfinished newer update blocks writes.
    part = docs / 'script.py314.lc.npk.part'
    part.write_bytes(b'partial')
    future = time.time() + 30
    os.utime(part, (future, future))
    assert run(root, 'status')['updatePending']
    assert '未完成更新' in run(root, 'apply', False) and digest(lc) == before
    part.unlink()
    quality.write_text('{"frame":7,"frame":4}', encoding='utf8')
    assert '无法唯一' in run(root, 'apply', False) and digest(lc) == before
    quality.write_text('{"frame":11}', encoding='utf8')
    assert '无法确认' in run(root, 'apply', False) and digest(lc) == before
    quality.write_text('{"frame":7,"other":{"frame":7}}', encoding='utf8')
    report(profile + ': applying')
    applied = run(root, 'apply')
    assert applied['state'] == 'native' and digest(lc) != before
    assert json.loads(quality.read_text(encoding='utf8'))['frame'] == 7
    journal = Path(applied['backup']) / 'adaptive-journal.json'
    assert json.loads(journal.read_text(encoding='utf8'))['state'] == 'installed'
    assert digest(Path(applied['backup']) / 'script.py314.lc.npk.before') == before
    assert run(root, 'status')['state'] == 'native'
    assert run(root, 'apply')['state'] == 'native'
    legacy = subprocess.run([str(EXE), '--fps-status-root', str(root)], capture_output=True,
                            encoding='utf-8-sig', timeout=120)
    assert legacy.returncode == 0, legacy.stderr
    assert json.loads(legacy.stdout)['state'] == 'native-mode-active'
    verify_semantics(root, profile, spec)
    # A malformed config must stop recovery before any package write.
    quality.write_text('{"frame":7,"frame":4}', encoding='utf8')
    installed_hash = digest(lc)
    installed_time = lc.stat().st_mtime_ns
    malformed_error = run(root, 'restore', False)
    assert '无法唯一' in malformed_error, malformed_error
    assert digest(lc) == installed_hash and lc.stat().st_mtime_ns == installed_time
    quality.write_text('{"frame":7,"other":{"frame":7}}', encoding='utf8')
    if profile == 'oldpc':
        # A prior version's journal cannot authorize recovery after any other
        # byte in this package changes, even if both modified modules match.
        unrelated = read_at(lc, 101, 1)
        write_at(lc, 101, bytes([unrelated[0] ^ 1]))
        changed_hash = digest(lc)
        newer = run(root, 'status')
        assert newer['state'] == 'native' and not newer['restoreAvailable']
        assert '同版本' in run(root, 'restore', False) and digest(lc) == changed_hash
        write_at(lc, 101, unrelated)
    report(profile + ': recovering interrupted write')
    # Recreate a power loss between the journal's prepared state and a slot
    # flush, including a byte sequence that cannot be decompressed.
    data = json.loads(journal.read_text(encoding='utf8'))
    data['state'] = 'prepared'
    journal.write_text(json.dumps(data), encoding='utf8')
    pos, _, _ = spec['manager']
    write_at(lc, pos, b'\0' * 80)
    state = run(root, 'status')
    assert state['state'] == 'partial' and state['restoreAvailable']
    restored = run(root, 'restore')
    assert restored['state'] == 'official' and digest(lc) == before
    assert json.loads(quality.read_text(encoding='utf8')) == {'frame': 4, 'other': {'frame': 7}}
    assert run(root, 'status')['state'] == 'official'
    # Even a semantically harmless change in an unrelated function is not
    # accepted as an official module without a reliable provenance source.
    pos, size, raw_size = spec['manager']
    saved = read_at(lc, pos, size)
    raw = bytearray(lz4.block.decompress(saved, uncompressed_size=raw_size))
    _, records = read_module(raw)
    offset, length, node = next(x for x in records if x[2].fields['qualname'].value not in {
        'SettingManager.init_preset_render_qualities', 'SettingManager.get_default_frame',
        'SettingManager.adjust_fps_and_apply_frame_prediction', 'SettingManager.set_frame_rate',
        'SettingManager.get_setting_frame_rate', 'SettingManager.get_default_frame_rate_index'})
    raw[offset + 4 + node.fields['qualname'].end] ^= 1
    compressed = lz4.block.compress(bytes(raw), mode='high_compression', compression=12, store_size=False)
    assert len(compressed) <= size
    changed = pad_lz4_to_fixed_size(compressed, bytes(raw), size)
    write_at(lc, pos, changed)
    unknown_hash = digest(lc)
    assert '来源未知' in run(root, 'apply', False) and digest(lc) == unknown_hash
    assert '来源未知' in run(root, 'status', False)
    write_at(lc, pos, saved)
    assert digest(lc) == before
    if profile == 'fever':
        # An experimental 240 build with unrelated newer package data has a
        # distinct restore-first path, rather than being mistaken for stock.
        prototype = WORKSPACE / 'native-240-option-lab' / 'v03-prototype'
        for name in ('manager', 'panel'):
            offset, size, _ = spec[name]
            slot = (prototype / (name + '.v03.bin')).read_bytes()
            assert len(slot) == size
            write_at(lc, offset, slot)
        status = run(root, 'status')
        assert status['state'] == 'prototype' and not status['applyAvailable'] and status['restoreAvailable']
        assert '实验档位' in run(root, 'apply', False)
        assert run(root, 'restore')['state'] == 'official' and digest(lc) == before
    # A changed table (including possible new native indices) always blocks.
    table = (root if 'rootTable' in spec else docs) / 'script.py3.npk'
    old_table_byte = read_at(table, spec['tableOffset'], 1)
    write_at(table, spec['tableOffset'], bytes([old_table_byte[0] ^ 1]))
    assert '帧率表' in run(root, 'apply', False) and digest(lc) == before
    write_at(table, spec['tableOffset'], old_table_byte)
    assert run(root, 'status')['state'] == 'official'
    if profile == 'fever':
        test_index_rejections(root, lc, before)
        test_relocated_slot(root, lc, spec)
        assert digest(lc) == before
    if profile == 'oldpc':
        # Existing 120-FPS takeover must be explicitly restored with its own
        # mode; the adaptive installer must not treat it as stock.
        # Use the saved, hash-verified legacy profile rather than assuming the
        # user's currently installed game is still using that mode.
        legacy_file = Path(r'D:\Program Files (x86)\LifeAfter\帧率解锁备份\auto-fps-profiles\auto-E9399BD2A38542CA\240.bin')
        legacy_slot = legacy_file.read_bytes()
        assert len(legacy_slot) == size
        assert hashlib.sha256(legacy_slot).hexdigest().upper() == 'A95BC03189E73E96EDB4E8DD3739C9E4EDD5547273154811F7136B204E5FCAE9'
        write_at(lc, pos, legacy_slot)
        legacy_hash = digest(lc)
        assert run(root, 'status')['state'] == 'legacy'
        assert '接管模式' in run(root, 'apply', False) and digest(lc) == legacy_hash
        write_at(lc, pos, saved)
        assert digest(lc) == before
    report(profile + ': passed')


def main():
    consent = subprocess.check_output([str(EXE), '--fps-consent-status'], encoding='utf-8-sig')
    assert json.loads(consent)['accepted'], 'The real local disclaimer must already be accepted; this test will not change it.'
    FIXTURE.mkdir(parents=True)
    try:
        for profile, spec in SAMPLES.items(): test_profile(profile, spec)
        report('adaptive integration tests passed')
    finally:
        assert FIXTURE.resolve().parent == WORK and FIXTURE.name.startswith('adaptive-') and not FIXTURE.is_symlink()
        shutil.rmtree(FIXTURE)


if __name__ == '__main__':
    main()
