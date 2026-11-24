#!/usr/bin/env python3
"""A.I.Mon 이름 변경 시각 검증: 기기 상단 각인(A.I.Mon)이 잘리거나 넘치지 않는지 확인하고 캡처한다."""
import asyncio, os, sys, json
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file://" + os.path.join(ROOT, "renderer", "index.html")
OUT = os.path.join(os.path.dirname(ROOT), "bothouse-shots")
os.makedirs(OUT, exist_ok=True)
USAGE = os.path.join(ROOT, "tools", "usage-sample.json")


async def main():
    usage = json.load(open(USAGE)) if os.path.exists(USAGE) else None
    report = {"errors": [], "checks": []}
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--allow-file-access-from-files", "--force-device-scale-factor=2"])
        page = await browser.new_page(viewport={"width": 580, "height": 450}, device_scale_factor=2)
        if usage:
            await page.add_init_script(f"window.__USAGE__ = {json.dumps(usage, ensure_ascii=False)};")
        page.on("console", lambda m: report["errors"].append(f"{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: report["errors"].append(f"pageerror: {e}"))

        def check(name, ok, extra=""):
            report["checks"].append({"name": name, "ok": bool(ok), "extra": extra})

        await page.goto(f"{URL}?demo=work")
        await page.wait_for_timeout(2200)

        info = await page.evaluate("""() => {
            const crown = document.querySelector('.crown');
            const name = document.querySelector('.crown-name');
            const dev = document.querySelector('.device');
            const lcd = document.querySelector('.lcd');
            const c = crown.getBoundingClientRect();
            const n = name.getBoundingClientRect();
            const d = dev.getBoundingClientRect();
            const l = lcd.getBoundingClientRect();
            return {
                text: name.textContent,
                pageTitle: document.title,
                crown: [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)],
                name: [Math.round(n.left), Math.round(n.top), Math.round(n.width), Math.round(n.height)],
                device: [Math.round(d.left), Math.round(d.top), Math.round(d.width), Math.round(d.height)],
                lcdTop: Math.round(l.top),
                font: getComputedStyle(name).fontFamily,
                size: getComputedStyle(name).fontSize,
                scrollW: name.scrollWidth, clientW: name.clientWidth
            };
        }""")
        print(json.dumps(info, ensure_ascii=False, indent=2))
        check("창 제목 A.I.Mon", info["pageTitle"] == "A.I.Mon", info["pageTitle"])
        check("각인 글자 A.I.Mon", info["text"] == "A.I.Mon", info["text"])
        check("각인 잘림 없음", info["scrollW"] <= info["clientW"] + 1, [info["scrollW"], info["clientW"]])
        check("각인 기기 안쪽", info["crown"][0] >= info["device"][0]
              and info["crown"][0] + info["crown"][2] <= info["device"][0] + info["device"][2], info["crown"])
        check("각인 액정 위쪽", info["crown"][1] + info["crown"][3] <= info["lcdTop"], [info["crown"], info["lcdTop"]])

        await page.screenshot(path=os.path.join(OUT, "aimon-home.png"))
        # 각인 확대 컷
        c = info["crown"]
        await page.screenshot(path=os.path.join(OUT, "aimon-crown.png"), clip={
            "x": max(0, c[0] - 30), "y": max(0, c[1] - 18), "width": c[2] + 60, "height": c[3] + 36
        })

        # 전체 보기 (넓은 기기) — 기기 B 버튼으로 변신
        await page.set_viewport_size({"width": 940, "height": 450})
        await page.wait_for_timeout(600)
        await page.click('.ab-key[data-key="B"]')
        await page.wait_for_timeout(1700)
        wide = await page.evaluate("""() => {
            const crown = document.querySelector('.crown').getBoundingClientRect();
            const dev = document.querySelector('.device').getBoundingClientRect();
            return { crown: [Math.round(crown.left), Math.round(crown.top), Math.round(crown.width)],
                     device: [Math.round(dev.left), Math.round(dev.top), Math.round(dev.width)] };
        }""")
        check("넓은 기기 각인 중앙", abs((wide["crown"][0] + wide["crown"][2] / 2)
                                    - (wide["device"][0] + wide["device"][2] / 2)) <= 2, wide)
        await page.screenshot(path=os.path.join(OUT, "aimon-all.png"))
        await page.set_viewport_size({"width": 580, "height": 450})
        await page.wait_for_timeout(600)
        await page.click('.ab-key[data-key="B"]')
        await page.wait_for_timeout(1700)

        # 낮 테마 각인
        await page.click("#themeBtn")
        await page.wait_for_timeout(1100)
        await page.screenshot(path=os.path.join(OUT, "aimon-day.png"))
        await page.click("#themeBtn")
        await page.wait_for_timeout(500)

        await browser.close()

    print(json.dumps({"checks": report["checks"], "errors": report["errors"]}, ensure_ascii=False, indent=2))
    bad = [c for c in report["checks"] if not c["ok"]]
    sys.exit(1 if (bad or report["errors"]) else 0)


asyncio.run(main())
