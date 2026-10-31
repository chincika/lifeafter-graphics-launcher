"""Extract reviewed function templates; no game file is opened for writing.

Run after build_v04.py has generated the reviewed fever modules.  The emitted
contract contains individual functions only, never a complete game module.
"""
import base64
import json
from pathlib import Path

from neox_marshal import read_module

HERE = Path(__file__).resolve().parent
TARGETS = {
    'manager': [
        'SettingManager.init_preset_render_qualities',
        'SettingManager.get_default_frame',
        'SettingManager.adjust_fps_and_apply_frame_prediction',
        'SettingManager.set_frame_rate',
        'SettingManager.get_setting_frame_rate',
        'SettingManager.get_default_frame_rate_index',
    ],
    'panel': [
        'PanelSetting.get_frame_conf',
        'PanelSetting.get_frame_item_data_new',
        'PanelSetting.on_setting_frame_clicked_new',
    ],
}


def functions(path):
    data = path.read_bytes()
    _, records = read_module(data)
    result = {}
    targets = {name for names in TARGETS.values() for name in names}
    for offset, size, node in records:
        name = node.fields['qualname'].value
        if name not in targets:
            continue
        if name in result:
            raise ValueError('duplicate function: ' + str(name))
        result[name] = (data[offset + 4:offset + 4 + size], node.fields['qualname'].end)
    return result


def main():
    output = {'version': 1, 'modules': {}}
    for module, names in TARGETS.items():
        original = functions(HERE / 'generated' / (module + '.original.raw'))
        patched = functions(HERE / 'generated' / (module + '.v04.raw'))
        entries = []
        for name in names:
            before, before_line = original[name]
            after, after_line = patched[name]
            if len(before) != len(after):
                raise ValueError('function size changed: ' + name)
            entries.append({
                'name': name,
                'original': base64.b64encode(before).decode('ascii'),
                'originalLineOffset': before_line,
                'patched': base64.b64encode(after).decode('ascii'),
                'patchedLineOffset': after_line,
                'edited': before != after,
            })
        output['modules'][module] = entries
    path = HERE / 'adaptive-contract.json'
    path.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print('Wrote', path)


if __name__ == '__main__':
    main()
