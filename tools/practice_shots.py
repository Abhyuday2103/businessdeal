# Plays a practice game (you plus computer players) in a real browser and saves screenshots.
# python3 tools/practice_shots.py docs <out dir> <computer players> [seconds]
import sys, os, time, threading, http.server, functools
from playwright.sync_api import sync_playwright
docs, out, bots = sys.argv[1], sys.argv[2], sys.argv[3]
secs = float(sys.argv[4]) if len(sys.argv) > 4 else 70
os.makedirs(out, exist_ok=True)
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=docs); h.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8781), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for tag, vp in [('phone', {'width': 390, 'height': 844}), ('desk', {'width': 1400, 'height': 860})]:
        pg = b.new_page(viewport=vp, device_scale_factor=2 if tag == 'phone' else 1)
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
        pg.goto('http://127.0.0.1:8781/index.html')
        pg.screenshot(path=f'{out}/{tag}-home.png')
        pg.fill('#name', 'Abhyuday'); pg.select_option('#bots', bots); pg.click('#practice')
        pg.wait_for_selector('#lobby:not([hidden])')
        pg.screenshot(path=f'{out}/{tag}-lobby.png', full_page=True)
        pg.click('[data-set="lapFirst"][data-val="false"]'); pg.wait_for_timeout(100)
        pg.click('#start')
        pg.wait_for_selector('#table:not([hidden])')
        pg.wait_for_timeout(400)
        pg.screenshot(path=f'{out}/{tag}-start.png')
        shots = set(); t0 = time.time(); bought = 0
        def snap(name):
            if name not in shots:
                shots.add(name); pg.wait_for_timeout(250); pg.screenshot(path=f'{out}/{tag}-{name}.png')
        while time.time() - t0 < secs:
            if pg.is_visible('#sheet'):
                if pg.is_visible('[data-m="accept"]'):
                    snap('incoming'); pg.click('[data-m="decline"]'); continue
                if pg.is_visible('[data-m="rematch"]'):
                    snap('over'); break
                pg.click('[data-close]'); continue
            a = pg.query_selector('#actions')
            btn = lambda sel: pg.query_selector(f'#actions {sel}:not([disabled])')
            if btn('[data-a="buy"]'):
                snap('buy')
                if bought < 6: btn('[data-a="buy"]').click(); bought += 1
                else: btn('[data-a="pass"]').click()
                pg.wait_for_timeout(150); continue
            if pg.query_selector('#actions .auction-top'):
                snap('auction')
                f = btn('[data-a="fold"]')
                if f: f.click()
                pg.wait_for_timeout(200); continue
            if btn('[data-a="bankrupt"]'):
                snap('debt'); pg.once('dialog', lambda d: d.accept()); btn('[data-a="bankrupt"]').click(); continue
            for sel in ['[data-a="roll"]', '[data-a="end"]']:
                x = btn(sel)
                if x:
                    if bought >= 3 and 'mine' not in shots:
                        pg.click('#actions [data-open="mine"]'); snap('mine'); pg.click('[data-close]')
                        pg.click('#actions [data-open="trade"]'); pg.click('.chip'); pg.wait_for_timeout(100); snap('trade'); pg.click('[data-close]')
                        pg.click('.sq[data-sq="35"]'); snap('deed'); pg.click('[data-close]')
                    x.click(); pg.wait_for_timeout(120); break
            if pg.is_visible('#drawn') and 'card' not in shots: snap('card')
            pg.wait_for_timeout(120)
        pg.screenshot(path=f'{out}/{tag}-late.png')
        pg.screenshot(path=f'{out}/{tag}-late-full.png', full_page=True)
srv.shutdown()
print('errors', errs or 'none')
