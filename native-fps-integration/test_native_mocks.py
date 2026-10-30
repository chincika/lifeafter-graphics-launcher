"""Execute only selected decoded functions against isolated engine mocks.

Run under the bundled CPython 3.14. No game DLL, account, network service, or
installed game file is loaded or modified by these tests.
"""
from __future__ import annotations

import itertools
import json
from pathlib import Path
import sys
import types

from neox_marshal import read_module
from neox_opcodes import as_code, translate

ROOT=Path(__file__).resolve().parent
NS=types.SimpleNamespace


class Quality(dict):
    def set(self,key,value):
        self[key]=value


class FrameManager:
    def __init__(self):
        self.requests=[]
        self.updates=[]
        self.prediction=[]
    def request_frame_rate(self,source,value):
        self.requests.append((source,value))
    def update_setting_frame_rate(self,value):
        self.updates.append(value)
    def fp_dyn_stop(self):
        self.prediction.append(('stop',))
    def fp_dyn_start(self,fps):
        self.prediction.append(('start',fps))


def function_nodes(path):
    name,items=read_module(path.read_bytes())
    return {n.fields['qualname'].value:n for p,s,n in items}


def make_scope(frame=4,*,cache=True,prediction=0,support=True,real120=True,frequency=240,extra=True,manager=True):
    table={i+1:{'frame':fps,'retained_field':i+100} for i,fps in enumerate((25,30,60,90,120,40,50))}
    fm=FrameManager() if manager else None
    setting=NS(
        user_settings={'quality':Quality(frame=frame,frame_prediction=prediction,quality=4)},
        get_default_frame_rate_index=lambda:4,
        is_jijian_config_enabled=lambda:False,
        get_default_quality=lambda:4,
        _get_default_quality=lambda:4,
        get_pc_display_frequency=lambda:frequency,
        support_120_frame=support,support_frame_prediction=support,
        enable_new_pc_setting=lambda:True,
        prediction_calls=[],meadow_calls=[],
    )
    setting.enable_frame_prediction=lambda value:setting.prediction_calls.append(value)
    setting.update_meadow_setting=lambda:setting.meadow_calls.append(True)
    env=NS(is_pc_mode=True)
    translator=types.ModuleType('com.lang.Translator')
    translator.Language=NS(TURKISH='tr',FRENCH='fr',GERMAN='de',RUSSIAN='ru')
    translator.get_language=lambda:'zh'
    lang=types.ModuleType('com.lang');lang.Translator=translator;lang.__path__=[]
    com=types.ModuleType('com');com.lang=lang;com.__path__=[]
    env_module=types.ModuleType('com.Env');env_module.Env=env;env_module.is_pc_mode=True;com.Env=env_module
    sys.modules.update({'com':com,'com.lang':lang,'com.lang.Translator':translator,'com.Env':env_module})
    game3d=NS(PLATFORM_IOS=1,PLATFORM_ANDROID=2,get_platform=lambda:3,requests=[])
    game3d.set_frame_rate=lambda fps:game3d.requests.append(fps)
    g=NS(setting=setting,frame_execute_mgr=fm,player=None,game_world=None,rebuild_tech_mgr=None)
    scope={
        'FRAME_RATE_DATA':NS(data=table),'Env':env,'G':g,'game3d':game3d,
        'switch':NS(enable_setting_get_default_frame_cache=cache,
                    enable_low_quality_fps_limit=False,enable_real_120fps=real120),
        'PatchUtils':NS(is_mumu=lambda:False),
        'RenderHelpers':NS(is_vsync_runtime_control_supported=lambda:False),
        'Helpers':NS(get_jijian_config=lambda *args:120),
        'Performance':NS(is_mumu=lambda:False,get_emulator_type=lambda:0,
                         EmulatorType=NS(MUMU=1,NON_EMULATOR=0),get_frame_rate=lambda quality:120),
        '_tr':lambda text,*args:text,
    }
    panel=NS(enable_extra_normal_fps=extra,get_default_quality=lambda:4)
    return scope,setting,panel


def bind(nodes,scope,owner,names):
    for name in names:
        node=nodes[name]
        code=as_code(node)
        if translate(code.co_code,reverse=True)!=node.fields['code'].value:
            raise AssertionError(f'opcode translation did not round trip: {name}')
        defaults=(None,) if name.endswith('.adjust_fps_and_apply_frame_prediction') else None
        setattr(owner,name.rsplit('.',1)[-1],types.MethodType(types.FunctionType(code,scope,argdefs=defaults),owner))


