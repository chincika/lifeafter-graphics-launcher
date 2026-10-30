"""Exercise complete copied archives via the same backend used by Electron."""
import hashlib,json,os,shutil,subprocess,sys,uuid
from pathlib import Path
HERE=Path(__file__).resolve().parent
REPO=HERE.parent
LAB=REPO.parent/'native-240-option-lab'
WORK=(HERE/'test-work').resolve()
FIXTURE=(WORK/('native-'+uuid.uuid4().hex[:10])).resolve()
assert WORK in FIXTURE.parents and REPO.resolve() in FIXTURE.parents
TEST_ENV=os.environ.copy()
TEST_ENV['LIFEAFTER_LEGACY_FPS_PROFILE_ROOT']=str(FIXTURE/'old-userdata'/'auto-fps-profiles')
root=FIXTURE/'game'; docs=root/'Documents'; configs=docs/'configs'; runtime=FIXTURE/'runtime'
configs.mkdir(parents=True);runtime.mkdir()
for f in (REPO/'desktop-app'/'backend').glob('*.dll'):shutil.copyfile(f,runtime/f.name)
exe=runtime/'LifeAfterBackend.exe';shutil.copyfile(REPO/'desktop-app'/'backend'/'LifeAfterBackend.exe',exe)
(root/'mingrizhihou.exe').write_bytes(b'fixture')
(configs/'pcconfig').write_text('{"resolution":[2560,1440],"other":true}',encoding='utf8')
config=configs/'qualityconfig';config.write_text('{"frame":4,"other":{"frame":7},"unchanged":42}',encoding='utf8')
original=LAB/'live-backups'/'20261030-1828-table-first'
names=('script.py3.npk','script.py314.lc.npk')
for name in names:shutil.copyfile(original/(name+'.original'),docs/name)
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest().upper()
stock=[sha(docs/n) for n in names]
def run(*args,ok=True,env=None):
 p=subprocess.run([str(exe),*map(str,args)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,encoding='utf-8-sig',env=env or TEST_ENV)
 if (p.returncode==0)!=ok:raise AssertionError((args,p.returncode,p.stdout,p.stderr))
 return p.stdout.strip() if ok else p.stderr.strip()
def native(action,ok=True):
 output=run('--native-fps-'+action,ok=ok)
 return json.loads(output) if ok else output
assert json.loads(run('--fps-consent-status'))['accepted'], 'Real local FPS consent is required for this integration test'
run('--set-root',root)
assert native('status')['state']=='official'
# A user with an already-applied old auto-profile must retain detection and
# restoration after the default backup location moves into the game folder.
run('--fps-apply',180)
assert json.loads(run('--fps-status'))['state']=='conditional-180'
assert '未知记录' in native('apply',ok=False)
new_cache=(root/'帧率解锁备份'/'auto-fps-profiles').resolve()
old_cache=Path(TEST_ENV['LIFEAFTER_LEGACY_FPS_PROFILE_ROOT']).resolve()
assert FIXTURE in new_cache.parents and FIXTURE in old_cache.parents
old_cache.mkdir(parents=True)
profiles=list(new_cache.glob('auto-*'));assert len(profiles)==1
profiles[0].rename(old_cache/profiles[0].name)
assert json.loads(run('--fps-status'))['state']=='conditional-180'
run('--fps-restore')
assert native('status')['state']=='official'
installed=native('apply');assert installed['state']=='native'
backup=Path(installed['backup']);assert root.resolve() in backup.resolve().parents
for name,digest in zip(names,stock):assert sha(backup/(name+'.before'))==digest
native_hashes=[sha(docs/n) for n in names]
for index in (7,8,9,10):
 config.write_text('{"frame":'+str(index)+',"other":{"setting":7},"unchanged":42}',encoding='utf8')
 run('--apply','2K 120');data=json.loads(config.read_text(encoding='utf-8-sig'));assert data['frame']==index and data['other']['setting']==7 and data['unchanged']==42
run('--apply','1080p 60');assert json.loads(config.read_text(encoding='utf-8-sig'))['frame']==2
assert '游戏内帧率档位' in run('--fps-apply',240,ok=False)
assert '游戏内帧率档位' in run('--fps-restore',ok=False)
legacy_status=json.loads(run('--fps-status'))
assert legacy_status['state']=='native-mode-active' and not legacy_status['writable']
assert '接管模式的备份清理暂不可用' in run('--fps-clean-backups',ok=False)
config.write_text('{"frame":10,"other":{"frame":7},"unchanged":42}',encoding='utf8')
restored=native('restore');assert restored['state']=='official' and json.loads(config.read_text(encoding='utf8'))=={'frame':4,'other':{'frame':7},'unchanged':42}
for name,digest in zip(names,native_hashes):assert sha(Path(restored['backup'])/(name+'.before-restore'))==digest
assert [sha(docs/n) for n in names]==stock
for index in (7,8,9,10):
 config.write_text('{"frame":'+str(index)+',"other":{"frame":7}}',encoding='utf8')
 native('restore');assert json.loads(config.read_text(encoding='utf8'))=={'frame':4,'other':{'frame':7}}
# Upgrade prototype without changing its previously saved 240 FPS selection.
config.write_text('{"frame":7,"other":{"frame":7}}',encoding='utf8')
with (docs/names[1]).open('r+b') as f:
 for name,offset in (('panel',239435364),('manager',237231880)):
  f.seek(offset);f.write((LAB/'v03-prototype'/(name+'.v03.bin')).read_bytes())
proto=[sha(docs/n) for n in names];assert native('status')['state']=='prototype'
up=native('apply');assert up['state']=='native' and json.loads(config.read_text(encoding='utf8'))['frame']==7
assert sha(Path(up['backup'])/(names[1]+'.before'))==proto[1]
assert sha(Path(up['backup'])/(names[1]+'.original'))==stock[1]
assert [sha(docs/n) for n in names]==native_hashes
# Unknown bytes outside the reviewed slots block both apply and restore.
with (docs/names[0]).open('r+b') as f:f.seek(100);v=f.read(1);f.seek(100);f.write(bytes([v[0]^1]))
assert '不匹配' in native('apply',ok=False) and '不匹配' in native('restore',ok=False)
with (docs/names[0]).open('r+b') as f:f.seek(100);f.write(v)
assert native('status')['state']=='native'
print(json.dumps({'status':'passed','fixture':str(FIXTURE),'oldProfileMigration':True,'stockInstall':True,'backupInGameDirectory':True,'allFourPreservedBy120Preset':True,'lowerPresetWorks':True,'legacyConflictBlocked':True,'restoreIndices7To10':True,'v03UpgradePreserves240':True,'unknownArchiveRejected':True},ensure_ascii=False))
# Delete only this test's resolved, purpose-built fixture, never game files.
assert FIXTURE.parent==WORK and FIXTURE.name.startswith('native-') and FIXTURE.is_dir()
shutil.rmtree(FIXTURE)
