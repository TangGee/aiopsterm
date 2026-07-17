#!/usr/bin/env python3
"""Annotate aiopsterm docs screenshots: crops + numbered badges + arrows from manifest boxes."""
import json, math, os
from PIL import Image, ImageDraw, ImageFont

import pathlib
REPO = pathlib.Path(__file__).resolve().parents[2]
RAW = str(REPO / 'test-results' / 'docs-screenshots' / 'raw')
OUT = str(REPO / 'docs' / 'usage' / 'best-practices' / 'images')
os.makedirs(OUT, exist_ok=True)

ACCENT = (255, 109, 58, 255)      # orange
BADGE_TEXT = (255, 255, 255, 255)
FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)

def load(name):
    im = Image.open(f'{RAW}/{name}.png').convert('RGBA')
    with open(f'{RAW}/{name}.json') as f:
        boxes = json.load(f)
    return im, boxes

def draw_rounded_box(d, box, pad=4, width=3, dash=None):
    x1, y1 = box['x'] - pad, box['y'] - pad
    x2, y2 = box['x'] + box['w'] + pad, box['y'] + box['h'] + pad
    d.rounded_rectangle([x1, y1, x2, y2], radius=6, outline=ACCENT, width=width)
    return (x1, y1, x2, y2)

def arrow(d, start, end, width=4):
    d.line([start, end], fill=ACCENT, width=width)
    ang = math.atan2(end[1] - start[1], end[0] - start[0])
    L, spread = 14, math.radians(26)
    p1 = (end[0] - L * math.cos(ang - spread), end[1] - L * math.sin(ang - spread))
    p2 = (end[0] - L * math.cos(ang + spread), end[1] - L * math.sin(ang + spread))
    d.polygon([end, p1, p2], fill=ACCENT)

def badge(d, center, num):
    r = 15
    d.ellipse([center[0]-r, center[1]-r, center[0]+r, center[1]+r], fill=ACCENT)
    txt = str(num)
    tb = d.textbbox((0, 0), txt, font=FONT)
    d.text((center[0]-(tb[2]-tb[0])/2, center[1]-(tb[3]-tb[1])/2 - tb[1]), txt, font=FONT, fill=BADGE_TEXT)

def callout(d, imsize, box, num, side='left', dist=70, outline=True, pad=4):
    """box: dict x,y,w,h. side: where the badge sits relative to the box."""
    if outline:
        draw_rounded_box(d, box, pad=pad)
    cx, cy = box['x'] + box['w']/2, box['y'] + box['h']/2
    if side == 'left':
        end = (box['x'] - pad - 2, cy); start = (end[0] - dist, cy)
    elif side == 'right':
        end = (box['x'] + box['w'] + pad + 2, cy); start = (end[0] + dist, cy)
    elif side == 'top':
        end = (cx, box['y'] - pad - 2); start = (cx, end[1] - dist)
    elif side == 'bottom':
        end = (cx, box['y'] + box['h'] + pad + 2); start = (cx, end[1] + dist)
    elif side == 'top-left':
        end = (box['x'] - pad + 6, box['y'] - pad + 6); start = (end[0] - dist*0.8, end[1] - dist*0.8)
    elif side == 'top-right':
        end = (box['x'] + box['w'] + pad - 6, box['y'] - pad + 6); start = (end[0] + dist*0.8, end[1] - dist*0.8)
    elif side == 'bottom-left':
        end = (box['x'] - pad + 6, box['y'] + box['h'] + pad - 6); start = (end[0] - dist*0.8, end[1] + dist*0.8)
    else:  # bottom-right
        end = (box['x'] + box['w'] + pad - 6, box['y'] + box['h'] + pad - 6); start = (end[0] + dist*0.8, end[1] + dist*0.8)
    W, H = imsize
    start = (min(max(start[0], 22), W-22), min(max(start[1], 22), H-22))
    if dist > 8:
        arrow(d, start, end)
    badge(d, start, num)

def render(fig):
    im, boxes = load(fig['src'])
    d = ImageDraw.Draw(im)
    for c in fig['callouts']:
        b = boxes.get(c['key']) if 'key' in c else c.get('box')
        if not b:
            print(f"  !! {fig['out']}: missing box {c.get('key')}")
            continue
        callout(d, im.size, b, c['n'], side=c.get('side', 'left'), dist=c.get('dist', 70),
                outline=c.get('outline', True), pad=c.get('pad', 4))
    if fig.get('crop'):
        im = im.crop(fig['crop'])
    if fig.get('scale'):
        im = im.resize((int(im.width*fig['scale']), int(im.height*fig['scale'])), Image.LANCZOS)
    im.convert('RGB').save(f"{OUT}/{fig['out']}.png", optimize=True)
    print(f"  ok {fig['out']} {im.size}")

FIGS = [
  # ---- getting started ----
  dict(src='01-main-window', out='main-window', callouts=[
    dict(n=1, key='sideRail', side='bottom', dist=40, outline=True, pad=2),
    dict(n=2, key='modulePanel', side='bottom', dist=40, pad=2),
    dict(n=3, key='dashboard', side='top', dist=40, pad=2),
    dict(n=4, key='aiPanel', side='bottom', dist=40, pad=2),
    dict(n=5, key='agentsEntry', side='right', dist=55),
    dict(n=6, key='railSettings', side='right', dist=55),
  ]),
  dict(src='01-main-window', out='connect-host', crop=(0, 30, 460, 500), scale=1.6, callouts=[
    dict(n=1, key='directTab', side='right', dist=90),
    dict(n=2, key='searchInput', side='right', dist=90),
    dict(n=3, key='hostProd', side='bottom-right', dist=60),
    dict(n=4, key='hostLocal', side='bottom-right', dist=60),
  ]),
  dict(src='11-assets', out='assets-workspace', callouts=[
    dict(n=1, key='tabHosts', side='bottom', dist=50),
    dict(n=2, key='tabBastion', side='bottom', dist=50),
    dict(n=3, key='tabKeys', side='bottom', dist=50),
    dict(n=4, key='tabProxy', side='bottom', dist=50),
    dict(n=5, key='hostCard', side='bottom', dist=55),
  ]),
  # ---- terminal ----
  dict(src='03-terminal-session', out='terminal-session', callouts=[
    dict(n=1, key='tab', side='right', dist=70),
    dict(n=2, key='pane', side='top-left', dist=1, outline=False),
    dict(n=3, key='aiPanel', side='bottom', dist=40, pad=2),
  ]),
  dict(src='04-terminal-context-menu', out='terminal-context-menu', crop=(430, 290, 1070, 870), scale=1.15, callouts=[
    dict(n=1, key='aiCmd', side='left', dist=80),
    dict(n=2, key='inputCmd', side='left', dist=80),
    dict(n=3, key='splitRight', side='left', dist=80),
    dict(n=4, key='fileMgr', side='left', dist=80),
  ]),
  dict(src='05-terminal-split', out='terminal-split', callouts=[
    dict(n=1, key='pane1', side='top', dist=38, pad=2),
    dict(n=2, key='pane2', side='top', dist=38, pad=2),
  ]),
  # ---- AI ----
  dict(src='07c-agents-restore', out='ai-panel', crop=(1070, 30, 1440, 900), callouts=[
    dict(n=1, box=dict(x=1095, y=44, w=24, h=24), side='right', dist=60),          # mode switch
    dict(n=2, key='userMsg', side='bottom-right', dist=40, pad=2),
    dict(n=3, box=dict(x=1104, y=724, w=30, h=26), side='top', dist=45),           # @ context
    dict(n=4, key='composer', side='top-right', dist=40),
    dict(n=5, box=dict(x=1177, y=841, w=117, h=26), side='top', dist=42),          # model select
    dict(n=6, box=dict(x=1393, y=842, w=24, h=24), side='top', dist=40),           # send
  ]),
  dict(src='07-agents-mode', out='agents-mode', callouts=[
    dict(n=1, key='agentsEntry', side='right', dist=55),
    dict(n=2, key='search', side='bottom-right', dist=50),
    dict(n=3, key='row1', side='bottom', dist=45),
    dict(n=4, key='aiPanel', side='bottom', dist=40, pad=2),
  ]),
  dict(src='07b-agents-new-menu', out='agents-new-menu', crop=(0, 30, 460, 320), scale=1.7, callouts=[
    dict(n=1, box=dict(x=294, y=44, w=26, h=26), side='bottom-right', dist=45),
    dict(n=2, key='newMenu', side='bottom-left', dist=50),
  ]),
  dict(src='07c-agents-restore', out='agents-restore', callouts=[
    dict(n=1, key='row', side='bottom-right', dist=55),
    dict(n=2, key='userMsg', side='bottom-left', dist=45, pad=2),
    dict(n=3, key='composer', side='top-left', dist=45),
  ]),
  dict(src='08-ai-sessions', out='ai-sessions-inbox', crop=(0, 30, 460, 560), scale=1.5, callouts=[
    dict(n=1, box=dict(x=6, y=38, w=34, h=34), side='right', dist=55),
  ]),
  # ---- quick commands ----
  dict(src='09-quick-commands', out='quick-commands', crop=(0, 30, 460, 640), scale=1.5, callouts=[
    dict(n=1, key='toolbarLeft', side='bottom', dist=45),
    dict(n=2, key='toolbarRight', side='bottom-right', dist=45),
    dict(n=3, key='item', side='bottom', dist=50),
  ]),
  # ---- knowledge ----
  dict(src='10-knowledge', out='knowledge-tree', crop=(0, 30, 460, 900), scale=1.4, callouts=[
    dict(n=1, key='addBtn', side='right', dist=60),
    dict(n=2, key='search', side='bottom', dist=38),
    dict(n=3, key='node', side='bottom-right', dist=65),
    dict(n=4, key='capacity', side='top', dist=45),
  ]),
  dict(src='10b-knowledge-editor', out='knowledge-editor', callouts=[
    dict(n=1, key='tree', side='right', dist=50, pad=2),
    dict(n=2, key='modeToggle', side='bottom-left', dist=55),
    dict(n=3, key='editor', side='bottom-left', dist=1, outline=False),
  ]),
  # ---- settings ----
  dict(src='12-settings-general', out='settings-general', callouts=[
    dict(n=1, key='nav', side='right', dist=60),
    dict(n=2, key='bgRow', side='left', dist=1, outline=False),
  ]),
  dict(src='13-settings-terminal', out='settings-terminal', callouts=[
    dict(n=1, key='termType', side='right', dist=70),
    dict(n=2, key='fontRow', side='right', dist=70),
    dict(n=3, key='cursorRow', side='right', dist=70),
  ]),
  dict(src='14-settings-models', out='settings-models', callouts=[
    dict(n=1, key='nav', side='right', dist=60),
  ]),
  dict(src='15-settings-shortcuts', out='settings-shortcuts', callouts=[
    dict(n=1, key='nav', side='right', dist=60),
  ]),
  dict(src='19-settings-hostagent', out='settings-hostagent', callouts=[
    dict(n=1, key='nav', side='right', dist=60),
    dict(n=2, key='tabs', side='bottom', dist=45),
  ]),
  dict(src='16-settings-mcp', out='settings-mcp', callouts=[
    dict(n=1, key='tabMcp', side='bottom', dist=50),
    dict(n=2, key='addBtn', side='bottom-left', dist=55),
    dict(n=3, key='toolHeader', side='bottom', dist=50),
  ]),
  dict(src='16b-settings-export-mcp', out='settings-export-mcp', callouts=[
    dict(n=1, key='nav', side='right', dist=60),
  ]),
  dict(src='20-settings-rules', out='settings-rules', callouts=[
    dict(n=1, key='tabs', side='bottom', dist=45),
  ]),
  dict(src='17-settings-about', out='settings-about', callouts=[
    dict(n=1, key='nav', side='right', dist=60),
  ]),
]

for fig in FIGS:
    try:
        render(fig)
    except Exception as e:
        print(f"  ERR {fig['out']}: {e}")
print('done')
