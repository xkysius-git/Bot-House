#!/usr/bin/env python3
"""renderer/index.html 을 브라우저로 띄워 스크린샷을 찍는다 (Electron 없이 UI 검증)."""
import asyncio, os, sys, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file://" + os.path.join(ROOT, "renderer", "index.html")
OUT = os.path.join(ROOT, "tools", "shots")
os.makedirs(OUT, exist_ok=True)
USAGE = os.path.join(ROOT, "tools", "usage-sample.json")


async def main():
    usage = json.load(open(USAGE)) if os.path.exists(USAGE) else None
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--allow-file-access-from-files", "--force-device-scale-factor=1"])
        page = await browser.new_page(viewport={"width": 1220, "height": 800})
        if usage:
            await page.add_init_script(f"window.__USAGE__ = {json.dumps(usage, ensure_ascii=False)};")
        errors = []
        page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        # 1) 작업 중 상태 — 석박지·클로드가 책상에 앉아 있는 화면
        await page.goto(f"{URL}?demo=work")
        await page.wait_for_timeout(11000)
        await page.screenshot(path=os.path.join(OUT, "01-work.png"))

        # 2) 캐릭터 클릭 → 팝오버
        anchor = await page.evaluate("window.House.anchorOf('sbji')")
        await page.mouse.click(anchor["x"], anchor["y"] + 8)
        await page.wait_for_timeout(700)
        await page.screenshot(path=os.path.join(OUT, "02-popover.png"))
        await page.keyboard.press("Escape")

        # 3) 로그 패널
        await page.click("#logBtn")
        await page.wait_for_timeout(500)
        await page.screenshot(path=os.path.join(OUT, "03-log.png"))
        await page.click("#logClose")

        # 4) 설정
        await page.click("#settingsBtn")
        await page.wait_for_timeout(400)
        await page.screenshot(path=os.path.join(OUT, "04-settings.png"))
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)

        # 5) 사용량 대시보드
        await page.click("#viewSwitch button[data-view='usage']")
        await page.wait_for_timeout(900)
        await page.screenshot(path=os.path.join(OUT, "05-usage.png"))

        # 6) 낮 테마
        await page.click("#themeBtn")
        await page.wait_for_timeout(700)
        await page.screenshot(path=os.path.join(OUT, "06-usage-day.png"))
        await page.click("#viewSwitch button[data-view='house']")
        await page.wait_for_timeout(900)
        await page.screenshot(path=os.path.join(OUT, "07-house-day.png"))

        # 7) 모두 쉬는 중 — 휴게실 배회
        await page.click("#themeBtn")
        await page.goto(f"{URL}?demo=idle")
        await page.wait_for_timeout(6000)
        await page.screenshot(path=os.path.join(OUT, "08-idle.png"))

        print(json.dumps({"errors": errors[:20], "out": OUT}, ensure_ascii=False, indent=2))
        await browser.close()

asyncio.run(main())
