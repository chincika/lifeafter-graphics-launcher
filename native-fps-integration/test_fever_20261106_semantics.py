"""Compare reviewed 1106 original and patched prediction behavior in mocks."""
import itertools
import json
from pathlib import Path
import sys
from test_native_mocks import bind, function_nodes, make_scope

generated=Path(sys.argv[1]).resolve()
original=function_nodes(generated/'manager.original.raw')
patched=function_nodes(generated/'manager.v04.raw')
NAME='SettingManager.adjust_fps_and_apply_frame_prediction'

def run(nodes,fps,prediction,support120,support_prediction,real120,manager,pc,new_setting,ios):
    scope,setting,_=make_scope(prediction=prediction,support=support120,real120=real120,manager=manager)
    setting.support_frame_prediction=support_prediction
    setting.enable_new_pc_setting=lambda:new_setting
    sys.modules['com.Env'].Env.is_pc_mode=pc
    scope['game3d'].get_platform=lambda:scope['game3d'].PLATFORM_IOS if ios else 3
    bind(nodes,scope,setting,[NAME])
    result=setting.adjust_fps_and_apply_frame_prediction(fps)
    frame_manager=scope['G'].frame_execute_mgr
    return result,setting.prediction_calls,frame_manager.prediction if frame_manager else None

checked=0
for fps,prediction,support120,support_prediction,real120,manager,pc,new_setting,ios in itertools.product(
        (25,30,40,50,60,90,120),(0,1),(False,True),(False,True),(False,True),(False,True),(False,True),(False,True),(False,True)):
    args=(fps,prediction,support120,support_prediction,real120,manager,pc,new_setting,ios)
    before=run(original,*args); after=run(patched,*args)
    assert before==after,(args,before,after)
    checked+=1
for fps,manager in itertools.product((180,240,300,360),(False,True)):
    result,calls,prediction=run(patched,fps,1,True,True,False,manager,True,True,False)
    assert result==fps and calls==[False]
    assert prediction==([('stop',)] if manager else None)
print(json.dumps({'status':'passed','originalBehaviorCases':checked,'highFrameCases':8}))
