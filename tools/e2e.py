# End-to-end test: three separate browser sessions (each its own "device" with its own sign-in) join one table
# on the local Firebase emulators, with one computer player, and play for a while.
# Needs: firebase emulators:start --only auth,firestore,functions   (from the project folder)
# Run:   python3 tools/e2e.py docs <screenshot dir> [seconds]
import sys, os, time, threading, http.server, functools
from playwright.sync_api import sync_playwright

docs, out = sys.argv[1], sys.argv[2]
secs = float(sys.argv[3]) if len(sys.argv) > 3 else 120
os.makedirs(out, exist_ok=True)
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=docs)
handler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8778), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:8778/index.html?emu=127.0.0.1'
NAMES = ['Abhyuday', 'Eric', 'Martin']
errors = []
counts = {}

def step(pg, name):
    b = lambda sel: pg.query_selector(f'#actions {sel}:not([disabled])')
    if pg.is_visible('[data-m="accept"]'):
        pg.click('[data-m="accept"]' if name == 'Eric' else '[data-m="decline"]'); return 'deal'
    if pg.is_visible('#sheet') and pg.is_visible('[data-close]'):
        pg.click('[data-close]'); return 'close'
    if b('[data-a="buy"]'):
        b('[data-a="buy"]').click(); return 'buy'
    if b('[data-bid]') and name == 'Martin':
        b('[data-bid]').click(); return 'bid'
    if b('[data-a="fold"]'):
        b('[data-a="fold"]').click(); return 'fold'
    if b('[data-a="pass"]'):
        b('[data-a="pass"]').click(); return 'pass'
    if b('[data-a="bankrupt"]'):
        pg.once('dialog', lambda d: d.accept()); b('[data-a="bankrupt"]').click(); return 'bankrupt'
    for sel in ['[data-a="roll"]', '[data-a="end"]']:
        if b(sel):
            b(sel).click(); return sel
    return None

with sync_playwright() as p:
    br = p.chromium.launch()
    # The test machine reaches the internet through a proxy the browser can't use, so fetch the Firebase SDK here.
    import urllib.request, ssl
    cache = {}
    def sdk(route):
        u = route.request.url
        if u not in cache:
            ctx_ = ssl.create_default_context(cafile=os.environ.get('SSL_CERT_FILE') or '/root/.ccr/ca-bundle.crt')
            cache[u] = urllib.request.urlopen(u, context=ctx_).read()
        route.fulfill(status=200, body=cache[u], headers={'content-type': 'application/javascript', 'access-control-allow-origin': '*'})
    pages = []
    for n in NAMES:
        ctx = br.new_context(viewport={'width': 390, 'height': 844}, ignore_https_errors=True)
        ctx.route('https://www.gstatic.com/**', sdk)
        ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        pg = ctx.new_page()
        pg.on('pageerror', lambda e, n=n: errors.append(f'{n}: {e}'))
        pg.goto(BASE)
        pg.fill('#name', n)
        pages.append(pg)
    host = pages[0]
    host.click('#create')
    host.wait_for_selector('#lobby:not([hidden])', timeout=30000)
    code = host.inner_text('#lobby-code').strip()
    print('table', code)
    for pg in pages[1:]:
        pg.fill('#code', code); pg.click('#join')
        pg.wait_for_selector('#lobby:not([hidden])', timeout=30000)
    host.click('#add-bot'); host.wait_for_timeout(800)
    host.click('[data-set="lapFirst"][data-val="false"]'); host.wait_for_timeout(800)
    host.screenshot(path=f'{out}/lobby.png', full_page=True)
    host.click('#start')
    for pg in pages: pg.wait_for_selector('#table:not([hidden])', timeout=30000)
    # One player offers a deal early so the deal flow gets used online.
    t0 = time.time(); offered = False
    while time.time() - t0 < secs:
        for pg, n in zip(pages, NAMES):
            try:
                r = step(pg, n)
                if r: counts[r] = counts.get(r, 0) + 1
            except Exception as e:
                pass
        if not offered and counts.get('buy', 0) >= 3:
            try:
                host.click('#actions [data-open="trade"]'); host.click('.chip >> nth=0'); host.wait_for_timeout(200)
                box = host.query_selector('input[data-c="giveCash"]'); box.fill('500')
                host.click('[data-m="send"]'); offered = True; counts['offer'] = 1
            except Exception as e:
                errors.append('offer: ' + str(e)); offered = True
        if host.is_visible('[data-m="rematch"]'): break
        time.sleep(0.25)
    time.sleep(3)
    cash = []
    for pg, n in zip(pages, NAMES):
        pg.screenshot(path=f'{out}/{n}.png')
        cash.append(pg.inner_text('#players'))
    same = all(c == cash[0] for c in cash)
    print('moves', counts)
    print('all screens agree:', same)
    if not same:
        for c in cash: print('---', c.replace('\n', ' | '))
srv.shutdown()
print('errors', errors or 'none')
