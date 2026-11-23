#!/usr/bin/env python3
"""다마고치 기기 UI 스크린샷 + 기본 검증."""
import asyncio, os, sys, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file://" + os.path.join(ROOT, "renderer", "index.html")
OUT = os.path.join(ROOT, "tools", "shots")
os.makedirs(OUT, exist_ok=True)
USAGE = os.path.join(ROOT, "tools", "usage-sample.json")


async def main():
    usage = json.load(open(USAGE)) if os.path.exists(USAGE) else None
    report = {"errors": [], "checks": []}
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--allow-file-access-from-files", "--force-device-scale-factor=1"])
        page = await browser.new_page(viewport={"width": 1220, "height": 800})
        if usage:
            await page.add_init_script(f"window.__USAGE__ = {json.dumps(usage, ensure_ascii=False)};")
        page.on("console", lambda m: report["errors"].append(f"{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: report["errors"].append(f"pageerror: {e}"))

        def check(name, ok, extra=""):
            report["checks"].append({"name": name, "ok": bool(ok), "extra": extra})

        await page.goto(f"{URL}?demo=work")
        await page.wait_for_timeout(2000)
        await page.screenshot(path=os.path.join(OUT, "dev-01-home.png"))
        box = await page.evaluate("""() => {
            const d = document.querySelector('.device').getBoundingClientRect();
            const l = document.querySelector('.lcd').getBoundingClientRect();
            const f = document.querySelector('.device-foot').getBoundingClientRect();
            return { device: [Math.round(d.width), Math.round(d.height)], lcd: [Math.round(l.width), Math.round(l.height)],
                     footBottom: Math.round(f.bottom), vh: window.innerHeight,
                     keys: document.querySelectorAll('.tama-slot').length,
                     pad: document.querySelectorAll('.ab-key').length,
                     dpad: document.querySelectorAll('.dbtn').length,
                     meters: document.querySelectorAll('.tama-meter').length };
        }""")
        check("기기 레이아웃", box["footBottom"] <= box["vh"] and box["lcd"][0] > 700
              and box["keys"] == 4 and box["pad"] == 3 and box["dpad"] == 5, box)

        # 전체 보기
        await page.click('.tama-mode[data-mode="all"]')
        await page.wait_for_timeout(1200)
        await page.screenshot(path=os.path.join(OUT, "dev-02-all.png"))
        await page.click('.tama-mode[data-mode="focus"]')
        await page.wait_for_timeout(400)

        # 케어 시트
        await page.click('.ab-key[data-key="A"]')
        await page.wait_for_timeout(500)
        await page.screenshot(path=os.path.join(OUT, "dev-03-care.png"))
        care = await page.evaluate("() => ({open: !document.getElementById('careSheet').hidden, sel: document.querySelectorAll('#tamaControls .tama-btn.sel').length})")
        check("케어 시트 열림", care["open"] and care["sel"] == 1, care)
        # B로 선택 이동 후 C 실행
        await page.click('.dbtn[data-key="RIGHT"]')
        await page.wait_for_timeout(250)
        await page.click('.ab-key[data-key="A"]')
        await page.wait_for_timeout(700)
        await page.screenshot(path=os.path.join(OUT, "dev-04-care-run.png"))
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)

        # 메뉴 시트
        await page.click('.ab-key[data-key="C"]')
        await page.wait_for_timeout(600)
        await page.screenshot(path=os.path.join(OUT, "dev-05-menu.png"))
        menu = await page.evaluate("() => ({open: !document.getElementById('menuSheet').hidden, bots: document.querySelectorAll('#botList .bot-row').length})")
        check("메뉴 시트 + 봇 목록", menu["open"] and menu["bots"] == 4, menu)
        await page.keyboard.press("Escape")

        # 작업실
        await page.click('#viewSwitch button[data-view="house"]')
        await page.wait_for_timeout(1200)
        await page.screenshot(path=os.path.join(OUT, "dev-06-work.png"))
        house = await page.evaluate("() => ({hidden: document.getElementById('sceneHolder').hidden, chips: document.querySelectorAll('.status-chip').length})")
        check("작업실 뷰", (not house["hidden"]) and house["chips"] == 4, house)

        # 사용량
        await page.click('#viewSwitch button[data-view="usage"]')
        await page.wait_for_timeout(900)
        await page.screenshot(path=os.path.join(OUT, "dev-07-usage.png"))
        cards = await page.evaluate("() => document.querySelectorAll('#usageGrid .usage-card').length")
        check("사용량 카드", cards >= 4, cards)

        # 낮 테마
        await page.click('#viewSwitch button[data-view="tamagotchi"]')
        await page.click("#themeBtn")
        await page.wait_for_timeout(1100)
        await page.screenshot(path=os.path.join(OUT, "dev-08-day.png"))
        theme = await page.evaluate("() => document.body.className")
        check("낮 테마", theme == "theme-day", theme)
        await page.click('.tama-mode[data-mode="all"]')
        await page.wait_for_timeout(700)
        await page.screenshot(path=os.path.join(OUT, "dev-09-day-all.png"))
        await page.click('.tama-mode[data-mode="focus"]')

        # 설정 모달
        await page.click('.ab-key[data-key="C"]')
        await page.click("#settingsBtn")
        await page.wait_for_timeout(500)
        await page.screenshot(path=os.path.join(OUT, "dev-10-settings.png"))
        await page.keyboard.press("Escape")
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)

        # 최소 크기
        await page.set_viewport_size({"width": 980, "height": 680})
        await page.wait_for_timeout(1000)
        await page.screenshot(path=os.path.join(OUT, "dev-11-small.png"))
        small = await page.evaluate("""() => {
            const f = document.querySelector('.device-foot').getBoundingClientRect();
            const l = document.querySelector('.lcd').getBoundingClientRect();
            return { footBottom: Math.round(f.bottom), vh: window.innerHeight, lcd: [Math.round(l.width), Math.round(l.height)] };
        }""")
        check("980x680 레이아웃", small["footBottom"] <= small["vh"] and small["lcd"][1] > 240, small)
        await browser.close()

    print(json.dumps(report, ensure_ascii=False, indent=2))
    bad = [c for c in report["checks"] if not c["ok"]]
    sys.exit(1 if (bad or report["errors"]) else 0)

asyncio.run(main())
