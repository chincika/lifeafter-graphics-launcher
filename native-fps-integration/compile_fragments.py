"""Run with the bundled CPython 3.14, returning audited wordcode fragments."""
import dis
import json
from neox_opcodes import translate

SOURCES = {
    # Keep the prototype's saved index 7 at 240 FPS when it is upgraded.
    'initialize_mapping_v04': (('self',), '''
if len(FRAME_RATE_DATA.data) == 7 and not FRAME_RATE_DATA.data.get(8):
    FRAME_RATE_DATA.data = {
        1: FRAME_RATE_DATA.data[1], 2: FRAME_RATE_DATA.data[2],
        3: FRAME_RATE_DATA.data[3], 4: FRAME_RATE_DATA.data[4],
        5: FRAME_RATE_DATA.data[5], 6: FRAME_RATE_DATA.data[6],
        7: FRAME_RATE_DATA.data[7], 8: {'frame': 240},
        9: {'frame': 180}, 10: {'frame': 300}, 11: {'frame': 360},
    }
'''),
    'append_ui_v04': (('self', 'quality_names', 'ui_2_level', 'level_2_ui'), '''
quality_names.append('180帧')
ui_2_level[len(quality_names) - 1] = 8
level_2_ui[8] = len(quality_names) - 1
quality_names.append('240帧')
ui_2_level[len(quality_names) - 1] = 7
level_2_ui[7] = len(quality_names) - 1
quality_names.append('300帧')
ui_2_level[len(quality_names) - 1] = 9
level_2_ui[9] = len(quality_names) - 1
quality_names.append('360帧')
ui_2_level[len(quality_names) - 1] = 10
level_2_ui[10] = len(quality_names) - 1
'''),
    'direct_saved_frame_v04': (('self',), '''
frame = self.user_settings['quality'].get('frame')
if frame in (7, 8, 9, 10):
    return (240, 180, 300, 360)[frame - 7]
'''),
    'native_prediction_v04': (('self', 'fps', 'quality'), '''
if fps in (180, 240, 300, 360):
    self.enable_frame_prediction(False)
    if G.frame_execute_mgr:
        G.frame_execute_mgr.fp_dyn_stop()
    return fps
'''),
    'initialize_table': (('self',), '''
if 8 not in FRAME_RATE_DATA.data and len(FRAME_RATE_DATA.data) == 7:
    FRAME_RATE_DATA.data[8] = FRAME_RATE_DATA.data[5].copy()
    FRAME_RATE_DATA.data[8]['frame'] = 240
'''),
    'append_ui': (('self', 'quality_names', 'ui_2_level', 'level_2_ui', 'frame_ui_type'), '''
if FRAME_RATE_DATA.data.get(8, {}).get('frame') == 240:
    quality_names.append('240帧')
    ui_2_level[len(quality_names) - 1] = 7
    level_2_ui[7] = len(quality_names) - 1
    frame_ui_type = 8
'''),
    'append_ui_v02': (('self', 'quality_names', 'ui_2_level', 'level_2_ui'), '''
if FRAME_RATE_DATA.data.get(8, {}).get('frame') == 240:
    quality_names.append('240帧')
    ui_2_level[len(quality_names) - 1] = 7
    level_2_ui[7] = len(quality_names) - 1
'''),
    'append_ui_probe': (('self', 'quality_names', 'ui_2_level', 'level_2_ui'), '''
quality_names.append('240帧')
ui_2_level[len(quality_names) - 1] = 7
level_2_ui[7] = len(quality_names) - 1
'''),
    'dropdown_probe': (('self', 'data'), '''
if data.get('key') == 'frame':
    if FRAME_RATE_DATA.data.get(8, {}).get('frame') == 240:
        data['filters'].append({'name': '数据表240', 'value': 7, 'locked': False})
    else:
        data['filters'].append({'name': '数据表缺失', 'value': 7, 'locked': False})
'''),
    'initialize_mapping': (('self',), '''
if len(FRAME_RATE_DATA.data) == 7 and not FRAME_RATE_DATA.data.get(8):
    FRAME_RATE_DATA.data = {
        1: FRAME_RATE_DATA.data[1],
        2: FRAME_RATE_DATA.data[2],
        3: FRAME_RATE_DATA.data[3],
        4: FRAME_RATE_DATA.data[4],
        5: FRAME_RATE_DATA.data[5],
        6: FRAME_RATE_DATA.data[6],
        7: FRAME_RATE_DATA.data[7],
        8: {'frame': 240},
    }
'''),
    'initialize_mapping_compact': (('self',), '''
if not FRAME_RATE_DATA.data.get(8):
    FRAME_RATE_DATA.data = dict(FRAME_RATE_DATA.data)
    FRAME_RATE_DATA.data[8] = {'frame': 240}
'''),
    'direct_saved_frame': (('self',), '''
if self.user_settings['quality'].get('frame') == 7:
    return 240
'''),
    'native_prediction': (('self', 'fps', 'quality'), '''
if fps == 240:
    self.enable_frame_prediction(False)
    if G.frame_execute_mgr:
        G.frame_execute_mgr.fp_dyn_stop()
    return 240
'''),
}


def main():
    result = {}
    for name,(args,body) in SOURCES.items():
        source = 'def fragment('+','.join(args)+'):\n' + ''.join('    '+line+'\n' for line in body.strip().splitlines())
        source += '    __native240_continue__()\n'
        scope = {}
        exec(compile(source,'native240-fragment.py','exec',optimize=0),scope)
        c=scope['fragment'].__code__
        if c.co_exceptiontable or c.co_cellvars or c.co_freevars:
            raise ValueError('fragment must have no exception region or closure')
        # Each fragment is spliced after the original RESUME. Its implicit
        # return is removed so the original body continues on fall-through.
        markers = [i for i in dis.get_instructions(c)
                   if i.opname == 'LOAD_GLOBAL' and i.argval == '__native240_continue__']
        if c.co_code[:2] != bytes((128,0)) or len(markers) != 1:
            raise ValueError('compiler entry/continuation marker changed')
        if c.co_names[-1] != '__native240_continue__':
            raise ValueError('continuation name is not the final name')
        result[name] = {
            'code':translate(c.co_code[2:markers[0].offset],reverse=True).hex(),
            'consts':c.co_consts,'names':c.co_names[:-1],'varnames':c.co_varnames,
            'stacksize':c.co_stacksize,'source':source,
        }
    print(json.dumps(result,ensure_ascii=True))


if __name__ == '__main__':
    main()
