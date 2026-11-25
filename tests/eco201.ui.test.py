# اختبار واجهة ECO 201: شاشة بروجكتر + جوالات بتصوّت + المختبر (Playwright)
import asyncio, os, time
from playwright.async_api import async_playwright
BASE = os.environ.get("BASE", "http://127.0.0.1:8787")
SHOTS = os.environ.get("SHOTS", "/home/claude/shots")
S = "ui" + str(int(time.time()))
fails = 0
def ok(c, m):
    global fails
    print(("✓ " if c else "✗ ") + m)
    if not c: fails += 1

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        errs = []
        scr = await (await b.new_context(viewport={"width": 1920, "height": 1080})).new_page()
        scr.on("pageerror", lambda e: errs.append(f"screen: {e}"))
        await scr.goto(f"{BASE}/eco201/live.html?s={S}")
        await scr.wait_for_selector("#empty:not([hidden])")
        ok(True, "live screen opens and shows the waiting message")
        await scr.screenshot(path=f"{SHOTS}/1-screen-empty.png")
        phone = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        # جوال 1: يجرّب يبعت فاضي → لازم يطلع خطأ
        A = await (await b.new_context(**phone)).new_page()
        A.on("pageerror", lambda e: errs.append(f"phone: {e}"))
        await A.goto(f"{BASE}/eco201?s={S}")
        await A.screenshot(path=f"{SHOTS}/2-phone-vote.png")
        await A.click("#send")
        ok((await A.text_content("#err")).strip() != "", "empty answer is blocked with an error message")
        await A.click('.chip[data-v="45"]')
        ok(await A.input_value("#price") == "45", "tapping the AED 45 chip fills the price")
        await A.click("#plus"); ok(await A.input_value("#price") == "50", "+ button adds 5 (45 → 50)")
        await A.click("#minus")
        await A.click("#send")
        await A.wait_for_selector("#done:not([hidden])")
        ok((await A.text_content("#mine")).strip() == "AED 45", "phone shows the thank-you screen with its answer")
        ok(not await A.is_visible("#form"), "the form is hidden once the answer is sent")
        await A.screenshot(path=f"{SHOTS}/3-phone-done.png")
        await scr.wait_for_function("document.getElementById('n').textContent === '1'", timeout=5000)
        ok(True, "screen updated to 1 student without refreshing")
        ok(not await scr.is_visible("#empty"), "the waiting message disappears after the first vote")
        # جوالات 2..20 بتكتب أرقام
        prices = [30, 35, 40, 40, 45, 45, 50, 50, 50, 55, 60, 35, 40, 45, 25, 70, 50, 40, 45]
        for i, pr in enumerate(prices):
            pg = await (await b.new_context(**phone)).new_page()
            pg.on("pageerror", lambda e: errs.append(f"phone{i}: {e}"))
            await pg.goto(f"{BASE}/eco201?s={S}")
            await pg.fill("#price", str(pr))
            await pg.click("#send")
            await pg.wait_for_selector("#done:not([hidden])")
            await pg.context.close()
        await scr.wait_for_function("document.getElementById('n').textContent === '20'", timeout=8000)
        ok(True, "20 phones voted, screen shows 20")
        allp = [45] + prices
        q45 = sum(1 for x in allp if x >= 45)
        at45 = (await scr.text_content("#at45")).strip()
        ok(at45 == f"{round(q45/20*100)}% ({q45})", f"'would buy at AED 45' = {at45} (expected {round(q45/20*100)}% ({q45}))")
        s = sorted(allp); med = (s[9] + s[10]) / 2
        ok((await scr.text_content("#med")).strip() == f"AED {med:g}", f"median = {(await scr.text_content('#med')).strip()} (expected AED {med:g})")
        best = max(set(allp), key=lambda p: (p * sum(1 for x in allp if x >= p), -p))
        ok((await scr.text_content("#rev")).strip() == f"AED {best}", f"revenue-max price = {(await scr.text_content('#rev')).strip()} (expected AED {best})")
        q40 = sum(1 for x in allp if x >= 40)
        ped = abs(((q45 - q40) / ((q45 + q40) / 2)) / (5 / 42.5))
        ok((await scr.text_content("#ped")).startswith(f"{ped:.2f}"), f"class elasticity = {(await scr.text_content('#ped')).strip()} (expected {ped:.2f})")
        # الجوال الأول يغيّر جوابه
        await A.click("#change"); await A.fill("#price", "100"); await A.click("#send")
        await A.wait_for_selector("#done:not([hidden])")
        await scr.wait_for_function("document.getElementById('n').textContent === '20' && document.getElementById('chart').innerHTML.includes('100')", timeout=5000)
        ok(True, "changing an answer updates the curve and keeps the count at 20")
        await scr.wait_for_timeout(700)
        paths = await scr.eval_on_selector_all("#chart path", "ps => ps.map(p => p.getAttribute('d'))")
        ok(len(paths) == 1, f"the class curve is drawn as one clean step line ({len(paths)} line(s))")
        qr = await scr.inner_html("#qr")
        ok("<svg" in qr or "<img" in qr, "QR code drawn on the screen")
        await scr.screenshot(path=f"{SHOTS}/4-screen-live.png")
        # إعادة تحميل الشاشة: لازم ترجع الأصوات
        await scr.reload(); await scr.wait_for_function("document.getElementById('n').textContent === '20'", timeout=5000)
        ok(True, "refreshing the screen keeps all 20 answers")

        # ===== المختبر =====
        L = await (await b.new_context(viewport={"width": 1600, "height": 900})).new_page()
        L.on("pageerror", lambda e: errs.append(f"lab: {e}"))
        await L.goto(f"{BASE}/eco201/lab.html")
        st = (await L.text_content("#status")).strip()
        ok("Equilibrium" in st and (await L.text_content("#qd")) == "150", "lab opens at equilibrium: AED 45, 150 tickets")
        await L.screenshot(path=f"{SHOTS}/5-lab-market.png")
        async def setp(v):
            await L.eval_on_selector("#price", "(e,v)=>{e.value=v;e.dispatchEvent(new Event('input'))}", v)
        await setp(40)
        ok((await L.text_content("#ped")) == "1.55" and (await L.text_content("#rev")) == "AED 7,200", "AED 40 → PED 1.55 and spending AED 7,200 (matches the report)")
        ok("Shortage of 50" in await L.text_content("#status"), "AED 40 shows a shortage of 50 tickets (matches Table 1)")
        await setp(50); ok("Surplus of 50" in await L.text_content("#status"), "AED 50 shows a surplus of 50 (matches Table 1)")
        await L.check("#cost"); await L.click("#to-eq")
        ok("P* = AED 48, Q* = 132" in await L.text_content("#m-explain"), "supply left-shift → P* 48, Q* 132 (matches the report)")
        await L.uncheck("#cost"); await L.check("#eid"); await L.click("#to-eq")
        eidtxt = await L.text_content("#m-explain")
        ok("P* = AED 50" in eidtxt, f"Eid demand shift → {eidtxt.split('.')[0]}")
        await L.screenshot(path=f"{SHOTS}/6-lab-eid.png")
        await L.click('[data-tab="costs"]')
        async def setq(v):
            await L.eval_on_selector("#q", "(e,v)=>{e.value=v;e.dispatchEvent(new Event('input'))}", v)
        await setq(100); a100 = await L.text_content("#atc")
        await setq(180); a180 = await L.text_content("#atc")
        ok(a100 == "AED 28.00" and a180 == "AED 19.11", f"ATC at 100 = {a100}, at 180 = {a180} (report: 28.00, 19.11)")
        await L.screenshot(path=f"{SHOTS}/7-lab-costs.png")
        await L.click('[data-tab="prices"]')
        ok(await L.locator(".bar-row").count() == 7, "price tab shows all 7 cinemas")
        await L.screenshot(path=f"{SHOTS}/8-lab-prices.png")
        ok(not errs, "no JavaScript errors on any page" + ("" if not errs else ": " + "; ".join(errs[:3])))
        await b.close()
    print(f"\n{fails} FAILED" if fails else "\nALL PASSED")
asyncio.run(main())
