#!/usr/bin/env python3
"""다마고치 홈 화면 검증 + 스크린샷.

renderer/index.html 을 브라우저로 띄워 레이아웃과 인터랙션(선택·쓰다듬기·간식·응원·재우기·
낮/밤·전체 보기·사용량 이동)을 확인하고 tools/shots 에 저장한다.
"""
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

        # 1) 밤 · 한 마리 보기
        await page.goto(f"{URL}?demo=work")
        await page.wait_for_timeout(1800)
        await page.screenshot(path=os.path.join(OUT, "tamagotchi-home.png"))
        box = await page.evaluate("""() => {
            const d = document.querySelector('.tama-device').getBoundingClientRect();
            const s = document.querySelector('.tama-screen').getBoundingClientRect();
            const sl = document.querySelector('.tama-slots').getBoundingClientRect();
            const c = document.querySelector('.tama-controls').getBoundingClientRect();
            return { device: [d.x, d.y, d.width, d.height], screen: [s.width, s.height],
                     slots: [sl.width, sl.height], controls: [c.width, c.height],
                     slots4: document.querySelectorAll('.tama-slot').length,
                     meters: document.querySelectorAll('.tama-meter').length };
        }""")
        check("device 이 stage 안에 들어옴", box["device"][3] <= 800 and box["device"][1] > 50, box)
        check("슬롯 4개 · 게이지 3종", box["slots4"] == 4 and box["meters"] == 3)

        # 2) 석박지(작업 중) 선택 → 땀/키보드 모션
        await page.click('.tama-slot[data-bot="sbji"]')
        await page.wait_for_timeout(900)
        st = await page.evaluate("() => document.getElementById('tamaState').textContent")
        await page.screenshot(path=os.path.join(OUT, "tamagotchi-working.png"))
        check("석박지 작업 중 표시", st == "작업 중", st)

        # 3) 쓰다듬기 → 하트 + 말풍선
        before = await page.evaluate("() => JSON.parse(localStorage.getItem('bothouse.care.v1')||'{}')")
        await page.click('.tama-btn[data-act="pet"]')
        await page.wait_for_timeout(320)
        bubble = await page.evaluate("() => { const b=document.getElementById('tamaBubble'); return b.hidden? '' : b.textContent; }")
        await page.screenshot(path=os.path.join(OUT, "tamagotchi-pet.png"))
        after = await page.evaluate("() => JSON.parse(localStorage.getItem('bothouse.care.v1')||'{}')")
        check("쓰다듬기 말풍선 + 수치 저장", bool(bubble) and after.get("sbji") != before.get("sbji"), {"bubble": bubble})

        # 4) 간식 → 음식 + 게이지 상승
        e1 = await page.evaluate("() => document.querySelectorAll('.tama-meter')[1].querySelector('.m-val').textContent")
        await page.click('.tama-btn[data-act="snack"]')
        await page.wait_for_timeout(500)
        await page.screenshot(path=os.path.join(OUT, "tamagotchi-snack.png"))
        e2 = await page.evaluate("() => document.querySelectorAll('.tama-meter')[1].querySelector('.m-val').textContent")
        check("간식 후 에너지 상승", e1 != e2, [e1, e2])

        # 5) 응원 → 반짝이/꽃가루
        await page.click('.tama-btn[data-act="cheer"]')
        await page.wait_for_timeout(400)
        await page.screenshot(path=os.path.join(OUT, "tamagotchi-cheer.png"))

        # 6) 전체 보기
        await page.click('.tama-mode[data-mode="all"]')
        await page.wait_for_timeout(900)
        quad = await page.evaluate("() => { const q=document.getElementById('tamaQuad'); return {hidden:q.hidden, cells:q.querySelectorAll('.tama-cell').length}; }")
        await page.screenshot(path=os.path.join(OUT, "tamagotchi-all.png"))
        check("전체 보기 4칸", (not quad["hidden"]) and quad["cells"] == 4, quad)

        # 7) 낮 테마 (전체 보기 → 한 마리)
        await page.click('.tama-mode[data-mode="focus"]')
        await page.click("#themeBtn")
        await page.wait_for_timeout(900)
        theme = await page.evaluate("() => document.body.className")
        await page.screenshot(path=os.path.join(OUT, "tamagotchi-day.png"))
        check("낮 테마 반영", theme == "theme-day", theme)
        await page.click('.tama-mode[data-mode="all"]')
        await page.wait_for_timeout(600)
        await page.screenshot(path=os.path.join(OUT, "tamagotchi-all-day.png"))
        await page.click('.tama-mode[data-mode="focus"]')

        # 8) 봇 상태 리스트 → 팝오버 (기존 기능 유지)
        await page.click('.bot-row:last-child')
        await page.wait_for_timeout(500)
        pop = await page.evaluate("() => ({hidden: document.getElementById('popover').hidden, name: document.getElementById('popName').textContent})")
        await page.screenshot(path=os.path.join(OUT, "tamagotchi-popover.png"))
        check("봇 상태 → 팝오버", (not pop["hidden"]) and pop["name"] == "클로드", pop)
        await page.keyboard.press("Escape")

        # 9) 사용량 대시보드 / 하우스 뷰 유지
        await page.click("#tokenChip")
        await page.wait_for_timeout(800)
        usage_cards = await page.evaluate("() => document.querySelectorAll('#usageGrid .usage-card').length")
        await page.screenshot(path=os.path.join(OUT, "tamagotchi-usage.png"))
        check("사용량 카드 렌더", usage_cards >= 4, usage_cards)

        await page.click("#viewSwitch button[data-view='house']")
        await page.wait_for_timeout(900)
        house = await page.evaluate("() => ({scene: document.getElementById('scene').hidden, chips: document.querySelectorAll('.status-chip').length})")
        await page.screenshot(path=os.path.join(OUT, "tamagotchi-house.png"))
        check("하우스 뷰 유지", (not house["scene"]) and house["chips"] == 4, house)

        # 10) 로그 패널 · 설정 유지
        await page.click("#logBtn")
        await page.wait_for_timeout(400)
        log_ok = await page.evaluate("() => !document.getElementById('logPanel').hidden")
        await page.click("#logClose")
        await page.click("#settingsBtn")
        await page.wait_for_timeout(400)
        settings_ok = await page.evaluate("() => !document.getElementById('settingsModal').hidden")
        await page.screenshot(path=os.path.join(OUT, "tamagotchi-settings.png"))
        await page.keyboard.press("Escape")
        check("로그/설정 유지", log_ok and settings_ok)

        # 11) 다시 밤 · 잠자기 (idle 봇)
        await page.click("#viewSwitch button[data-view='tamagotchi']")
        await page.click('.tama-slot[data-bot="oiji"]')
        await page.wait_for_timeout(400)
        # 에너지를 낮춰 잠들 수 있는 상태로
        await page.evaluate("""() => {
            const raw = JSON.parse(localStorage.getItem('bothouse.care.v1') || '{}');
            raw.oiji = { ...(raw.oiji||{}), energy: 60, mood: 60, sleeping: false, updatedAt: Date.now() };
            localStorage.setItem('bothouse.care.v1', JSON.stringify(raw));
        }""")
        await page.reload()
        await page.wait_for_timeout(1500)
        await page.click('.tama-btn[data-act="sleep"]')
        await page.wait_for_timeout(700)
        sleep_state = await page.evaluate("() => document.getElementById('tamaState').textContent")
        await browser.close()
        # 잠자기 화면은 밤 테마로 다시 찍는다
        browser = await p.chromium.launch(args=["--allow-file-access-from-files", "--force-device-scale-factor=1"])
        ctx = await browser.new_context(viewport={"width": 1220, "height": 800})
        page = await ctx.new_page()
        if usage:
            await page.add_init_script(f"window.__USAGE__ = {json.dumps(usage, ensure_ascii=False)};")
        await page.goto(f"{URL}?demo=idle")
        await page.evaluate("""() => {
            const raw = JSON.parse(localStorage.getItem('bothouse.care.v1') || '{}');
            raw.oiji = { ...(raw.oiji||{}), energy: 58, mood: 64, sleeping: true, updatedAt: Date.now() };
            localStorage.setItem('bothouse.care.v1', JSON.stringify(raw));
        }""")
        await page.reload()
        await page.wait_for_timeout(1800)
        await page.screenshot(path=os.path.join(OUT, "tamagotchi-sleep.png"))
        check("재우기 → 자는 중", sleep_state == "자는 중", sleep_state)

        # 12) 최소 창 크기(980x680)에서도 액정/버튼이 잘리지 않는지
        await page.goto(f"{URL}?demo=work")
        await page.wait_for_timeout(1200)
        await page.set_viewport_size({"width": 980, "height": 680})
        await page.wait_for_timeout(900)
        fit = await page.evaluate("""() => {
            const d = document.querySelector('.tama-device').getBoundingClientRect();
            const c = document.querySelector('.tama-controls').getBoundingClientRect();
            const s = document.querySelector('.tama-screen').getBoundingClientRect();
            return { deviceBottom: Math.round(d.bottom), controlsBottom: Math.round(c.bottom),
                     screen: [Math.round(s.width), Math.round(s.height)], vh: window.innerHeight };
        }""")
        await page.screenshot(path=os.path.join(OUT, "tamagotchi-small.png"))
        check("980x680에서 레이아웃 유지", fit["controlsBottom"] <= fit["vh"] and fit["screen"][1] > 200, fit)
        await browser.close()

    print(json.dumps(report, ensure_ascii=False, indent=2))
    bad = [c for c in report["checks"] if not c["ok"]]
    sys.exit(1 if (bad or report["errors"]) else 0)

asyncio.run(main())
