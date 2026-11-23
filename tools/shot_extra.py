import asyncio, os, sys, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file://" + os.path.join(ROOT, "renderer", "index.html")
OUT = os.path.join(ROOT, "tools", "shots")
USAGE = os.path.join(ROOT, "tools", "usage-sample.json")


async def main():
    usage = json.load(open(USAGE)) if os.path.exists(USAGE) else None
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--allow-file-access-from-files", "--force-device-scale-factor=1"])
        pg = await b.new_page(viewport={"width": 1220, "height": 800})
        if usage:
            await pg.add_init_script(f"window.__USAGE__ = {json.dumps(usage, ensure_ascii=False)};")
        await pg.goto(URL + "?demo=work")
        await pg.wait_for_timeout(1600)

        # 로그 시트
        await pg.click('.ab-key[data-key="C"]')
        await pg.wait_for_timeout(300)
        await pg.click("#logBtn")
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=os.path.join(OUT, "dev-12-log.png"))
        await pg.keyboard.press("Escape")

        # 팝오버
        await pg.click('.tama-slot[data-bot="sbji"]')
        await pg.wait_for_timeout(600)
        await pg.screenshot(path=os.path.join(OUT, "dev-13-popover.png"))
        await pg.keyboard.press("Escape")

        # 업데이트 알림
        await pg.goto(URL + "?demo=update")
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=os.path.join(OUT, "dev-14-update.png"))
        await b.close()

asyncio.run(main())
