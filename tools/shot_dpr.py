import asyncio, os, sys
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file://" + os.path.join(ROOT, "renderer", "index.html")
OUT = os.path.join(ROOT, "tools", "shots")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--allow-file-access-from-files", "--force-device-scale-factor=1.5"])
        pg = await b.new_page(viewport={"width": 1220, "height": 800}, device_scale_factor=1.5)
        await pg.goto(URL + "?demo=work")
        await pg.wait_for_timeout(1800)
        await pg.screenshot(path=os.path.join(OUT, "dev-dpr15.png"))
        info = await pg.evaluate("""() => {
          const c = document.getElementById('tamaStage');
          const r = c.getBoundingClientRect();
          return { dpr: window.devicePixelRatio, css: [Math.round(r.width), Math.round(r.height)],
                   buf: [c.width, c.height] };
        }""")
        print(info)
        await b.close()
asyncio.run(main())
