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
    mode = sys.argv[1] if len(sys.argv) > 1 else "idle"
    usage = json.load(open(USAGE)) if os.path.exists(USAGE) else None
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--allow-file-access-from-files", "--force-device-scale-factor=1"])
        page = await browser.new_page(viewport={"width": 1220, "height": 800})
        if usage:
            await page.add_init_script(f"window.__USAGE__ = {json.dumps(usage, ensure_ascii=False)};")
        errors = []
        page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        await page.goto(f"{URL}?demo={mode}")
        await page.wait_for_timeout(9000)
        await page.screenshot(path=os.path.join(OUT, f"01-{mode}.png"))

        await page.click("#logBtn")
        await page.wait_for_timeout(500)
        await page.screenshot(path=os.path.join(OUT, "02-log.png"))
        await page.click("#logClose")

        anchor = await page.evaluate("window.House.anchorOf('sbji')")
        await page.mouse.click(anchor["x"], anchor["y"] + 8)
        await page.wait_for_timeout(700)
        await page.screenshot(path=os.path.join(OUT, "03-popover.png"))
        await page.keyboard.press("Escape")

        await page.click("#settingsBtn")
        await page.wait_for_timeout(400)
        await page.screenshot(path=os.path.join(OUT, "04-settings.png"))
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(200)

        await page.click("#viewSwitch button[data-view='usage']")
        await page.wait_for_timeout(900)
        await page.screenshot(path=os.path.join(OUT, "05-usage.png"))

        await page.click("#themeBtn")
        await page.wait_for_timeout(700)
        await page.screenshot(path=os.path.join(OUT, "06-usage-day.png"))
        await page.click("#viewSwitch button[data-view='house']")
        await page.wait_for_timeout(700)
        await page.screenshot(path=os.path.join(OUT, "07-house-day.png"))

        print(json.dumps({"errors": errors[:20], "out": OUT}, ensure_ascii=False, indent=2))
        await browser.close()

asyncio.run(main())
