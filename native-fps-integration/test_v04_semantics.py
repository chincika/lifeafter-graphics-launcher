"""Execute reviewed v0.3 functions with native-like read-only data mocks."""
import itertools
import json
import dis
import types
from pathlib import Path
from compile_fragments import SOURCES
from neox_opcodes import translate
from test_native_mocks import NS,bind,function_nodes,make_scope
class ReadOnlyTable:
    def __init__(self, values): self.values=dict(values)
    def __len__(self): return len(self.values)
    def __getitem__(self,key): return self.values[key]
    def get(self,key,default=None): return self.values.get(key,default)
    def __contains__(self,key): return key in self.values
    def __setitem__(self,key,value): raise AssertionError('attempt to mutate read-only table')
    def copy(self): raise AssertionError('native table copy is not assumed')

ROOT=Path(__file__).resolve().parent
RATES=(25,30,60,90,120,40,50)


def scope_with_readonly_table(**kwargs):
    scope,setting,panel=make_scope(**kwargs)
    rows={i+1:ReadOnlyTable({'frame':fps}) for i,fps in enumerate(RATES)}
    original=ReadOnlyTable(rows)
    scope['FRAME_RATE_DATA'].data=original
    return scope,setting,panel,original,rows


def main():
    output=ROOT/'generated'
    ui=function_nodes(output/'panel.v04.raw');manager=function_nodes(output/'manager.v04.raw')
    original_ui=function_nodes(output/'panel.original.raw')
    original_manager=function_nodes(output/'manager.original.raw')
    # Run the exact rebased initializer bytes from the patched startup method,
    # followed by a synthetic return, without running the rest of game setup.
    startup=manager['SettingManager.init_preset_render_qualities']
    args,body=SOURCES['initialize_mapping_v04']
    source='def fragment('+','.join(args)+'):\n'+''.join('    '+line+'\n' for line in body.strip().splitlines())+'    __native240_continue__()\n'
    fragments={};exec(compile(source,'test-fragment','exec'),fragments)
    marker=next(i.offset for i in dis.get_instructions(fragments['fragment']) if i.opname=='LOAD_GLOBAL' and i.argval=='__native240_continue__')
    size=marker-2
    fields=startup.fields;variables=fields['localsplusnames'].value;constants=fields['consts'].value
    none_index=constants.index(None)
    if none_index>255:raise AssertionError('synthetic return needs wider operand')
    prefix=fields['code'].value[:2+size]+bytes((0x44,none_index,0x12,0))
    code=(lambda self:None).__code__.replace(co_argcount=1,co_posonlyargcount=0,co_kwonlyargcount=0,
        co_nlocals=len(variables),co_varnames=variables,co_names=fields['names'].value,co_consts=constants,
        co_stacksize=fields['stacksize'],co_flags=fields['flags']&0x00ffffff,co_code=translate(prefix),
        co_linetable=b'',co_exceptiontable=b'')
    startup_scope,_,_,old_startup,old_rows=scope_with_readonly_table()
    types.FunctionType(code,startup_scope)(NS())
    assert len(old_startup)==7 and all(startup_scope['FRAME_RATE_DATA'].data[k] == {'frame':v} for k,v in ((8,240),(9,180),(10,300),(11,360)))
    assert all(startup_scope['FRAME_RATE_DATA'].data[k] is old_rows[k] for k in old_rows)
    uicases=enginecases=0
    for frequency,extra in itertools.product((60,90,120,144,240),(False,True)):
        scope,setting,panel,old,rows=scope_with_readonly_table(frequency=frequency,extra=extra)
        bind(original_ui,scope,panel,['PanelSetting.get_frame_conf']);before=panel.get_frame_conf()
        bind(ui,scope,panel,['PanelSetting.get_frame_conf','PanelSetting._is_frame_locked','PanelSetting.get_frame_item_data_new'])
        names,forward,reverse,kind=panel.get_frame_conf()
        mapping=scope['FRAME_RATE_DATA'].data
        assert isinstance(mapping,dict) and len(mapping)==11 and len(old)==7
        assert all(mapping[k] is rows[k] for k in rows) and all(mapping[k] == {'frame':v} for k,v in ((8,240),(9,180),(10,300),(11,360)))
        assert names[:-4]==before[0] and names[-4:]==['180帧','240帧','300帧','360帧']
        assert [forward[i] for i in range(len(names)-4,len(names))]==[8,7,9,10] and all(reverse[v]==len(names)-4+i for i,v in enumerate((8,7,9,10)))
        assert kind==before[3] and panel.get_frame_item_data_new()[-4:]==[{'name':n,'value':v,'locked':False} for n,v in zip(('180帧','240帧','300帧','360帧'),(8,7,9,10))]
        assert panel.get_frame_conf()[0]==names and len(mapping)==11
        uicases+=1
    for frame,cache,prediction,support,real120,has_manager in itertools.product(
            range(11),(False,True),(0,1),(False,True),(False,True),(False,True)):
        scope,setting,panel,old,rows=scope_with_readonly_table(frame=frame,cache=cache,prediction=prediction,
            support=support,real120=real120,manager=has_manager)
        bind(manager,scope,setting,['SettingManager.get_default_frame','SettingManager.adjust_fps_and_apply_frame_prediction'])
        bind(original_manager,scope,setting,['SettingManager.set_frame_rate'])
        fps=setting.get_default_frame();expected=(25,30,60,90,120,40,50,240,180,300,360)[frame];assert fps==expected
        adjusted=setting.adjust_fps_and_apply_frame_prediction(fps)
        if fps in (180,240,300,360):assert adjusted==fps and setting.prediction_calls[-1] is False
        elif prediction and support and not real120 and fps>60:assert adjusted==fps//2
        else:assert adjusted==fps
        setting.set_frame_rate(adjusted);assert setting.setting_frame_rate==adjusted
        enginecases+=1
    scope,setting,panel,old,rows=scope_with_readonly_table()
    bind(ui,scope,panel,['PanelSetting.get_frame_conf','PanelSetting._is_frame_locked',
                         'PanelSetting.get_frame_item_data_new','PanelSetting.on_setting_frame_clicked_new'])
    bind(manager,scope,setting,['SettingManager.get_default_frame','SettingManager.adjust_fps_and_apply_frame_prediction'])
    bind(original_manager,scope,setting,['SettingManager.set_frame_rate'])
    def on_setting(key,value):
        # The real click path reads this row before storing the index.
        assert key=='frame' and scope['FRAME_RATE_DATA'].data[value+1].get('frame') in (25,30,40,50,60,90,120,180,240,300,360)
        setting.user_settings['quality'].set(key,value)
        setting.set_frame_rate(setting.adjust_fps_and_apply_frame_prediction(setting.get_default_frame()))
    panel.on_setting_quality_detail=on_setting
    items=panel.get_frame_item_data_new()
    for value in (8,7,9,10,4,2,7):
        panel.on_setting_frame_clicked_new(NS(data={'key':'frame'}),None,NS(data=next(i for i in items if i['value']==value)))
        assert setting.setting_frame_rate=={8:180,7:240,9:300,10:360,4:120,2:60}[value]
    for saved,rate in ((7,240),(8,180),(9,300),(10,360)):
        scope2,setting2,panel2,_,_=scope_with_readonly_table(frame=saved)
        bind(manager,scope2,setting2,['SettingManager.get_default_frame'])
        assert setting2.get_default_frame()==rate  # valid even before the table initializer runs
    result={'status':'passed','uiCases':uicases,'engineCases':enginecases,
            'mapping':'actual rebased startup fragment retains seven row objects and adds rows 8 to 11',
            'clickAndRestart':'180 -> 240 -> 300 -> 360 -> 120 -> 60 -> 240; saved index resolves before initialization',
            'remaining':['native game startup, in-game dropdown, switching and actual fps']}
    (output/'semantic-tests.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
