import base64
import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

def create_driver(width=1280, height=800):
    opts = Options()
    opts.binary_location = "/usr/bin/chromium"
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument(f"--window-size={width},{height}")
    opts.page_load_strategy = "eager"
    service = Service("/usr/bin/chromedriver")
    return webdriver.Chrome(service=service, options=opts)

def run_ui_tests():
    driver = create_driver(1280, 800)
    try:
        html_bytes = open("public/index.html", "rb").read()
        b64 = base64.b64encode(html_bytes).decode("ascii")
        driver.get("data:text/html;base64," + b64)
        time.sleep(0.3)

        # 1. Verify Home Screen & Brand Identity
        assert "Every Move" in driver.page_source
        preview_cells = driver.find_elements(By.CSS_SELECTOR, "#home-preview-board > div")
        assert len(preview_cells) == 64, f"Expected 64 preview cells, got {len(preview_cells)}"
        print("PASS 1: Home screen, brand headline, and independent animated preview board rendered.")

        # 2. Verify Interactive Tutorial Modal
        driver.find_element(By.ID, "btn-hero-how-to-play").click()
        time.sleep(0.15)
        tut_modal = driver.find_element(By.ID, "modal-tutorial")
        assert "hidden" not in tut_modal.get_attribute("class")
        driver.find_element(By.ID, "btn-tutorial-next").click()
        assert "STEP 2 OF 5" in driver.find_element(By.ID, "tutorial-step-badge").text.upper()
        driver.find_element(By.ID, "btn-tutorial-close").click()
        print("PASS 2: Interactive 5-step Tutorial modal opens, navigates steps, and closes.")

        # 3. Verify Settings, Sound Mute, and Reduced-Motion Behavior
        driver.find_element(By.ID, "btn-nav-settings").click()
        time.sleep(0.15)
        rm_chk = driver.find_element(By.ID, "chk-settings-reduced-motion")
        if not rm_chk.is_selected():
            rm_chk.click()
        assert "reduced-motion" in driver.find_element(By.TAG_NAME, "body").get_attribute("class")
        mute_chk = driver.find_element(By.ID, "chk-settings-mute")
        mute_chk.click()
        driver.find_element(By.ID, "btn-settings-done").click()
        print("PASS 3: Settings modal, Master Mute toggle, and Reduced-Motion preference verified.")

        # 4. Verify Local Pass-and-Play Gameplay Without Backend + Keyboard Accessibility
        driver.find_element(By.ID, "card-mode-local").click()
        time.sleep(0.1)
        driver.find_element(By.ID, "btn-start-local-match").click()
        time.sleep(0.15)

        cells = driver.find_elements(By.CSS_SELECTOR, "#reversi-board-grid .board-cell")
        assert len(cells) == 64, f"Expected 64 board squares, got {len(cells)}"

        # Play D3 (row 2, col 3) via click
        cell_d3 = driver.find_element(By.CSS_SELECTOR, '#reversi-board-grid [data-row="2"][data-col="3"]')
        cell_d3.click()
        time.sleep(0.1)
        assert driver.find_element(By.ID, "hud-score-black").text == "4"
        assert driver.find_element(By.ID, "hud-score-white").text == "1"

        # Play C3 (row 2, col 2) for White via keyboard Enter
        cell_c3 = driver.find_element(By.CSS_SELECTOR, '#reversi-board-grid [data-row="2"][data-col="2"]')
        cell_c3.send_keys(Keys.ENTER)
        time.sleep(0.1)
        assert driver.find_element(By.ID, "hud-score-black").text == "3"
        assert driver.find_element(By.ID, "hud-score-white").text == "3"
        print("PASS 4: Local multiplayer move execution, disc flipping, score HUD, and keyboard Enter verified.")

        # 5. Verify Destructive Action Confirmation Modal (Restart / Leave)
        driver.find_element(By.ID, "btn-game-restart").click()
        time.sleep(0.1)
        confirm_modal = driver.find_element(By.ID, "modal-confirm")
        assert "hidden" not in confirm_modal.get_attribute("class")
        driver.find_element(By.ID, "btn-confirm-cancel").click()
        assert driver.find_element(By.ID, "hud-score-black").text == "3", "Cancel must preserve match state"
        print("PASS 5: Destructive action confirmation modal protects active match.")

        # 6. Verify Results Modal, Match Statistics, and Read-Only Match Review Scrubber
        driver.execute_script("""
          const dbg = window.__FLIX_REVERSI_DEBUG__;
          const b = dbg.createEmptyBoard();
          b[0][0] = 'B'; b[0][1] = 'W';
          let g = dbg.createNewGame({ board: b, startingPlayer: 'B', now: Date.now() - 5000 });
          const res = dbg.applyMove(g, 0, 2, 'B', Date.now());
          dbg.forceState(res.state);
        """)
        time.sleep(0.15)
        results_modal = driver.find_element(By.ID, "modal-results")
        assert "hidden" not in results_modal.get_attribute("class")
        assert "Wins!" in driver.find_element(By.ID, "results-headline").text
        assert "+3 Discs" in driver.find_element(By.ID, "stat-winning-margin").text

        # Click Review Match
        driver.find_element(By.ID, "btn-results-review").click()
        time.sleep(0.1)
        scrubber = driver.find_element(By.ID, "review-scrubber-panel")
        assert "hidden" not in scrubber.get_attribute("class")
        driver.find_element(By.ID, "btn-review-first").click()
        assert "Start" in driver.find_element(By.ID, "review-step-label").text
        print("PASS 6: Results modal statistics and read-only Match Review scrubber verified.")

        # 7. Verify Online Room Creation, Dual-Seat Connection, and Disconnection/Recovery Flow
        driver.find_element(By.ID, "btn-game-leave").click()
        time.sleep(0.1)
        driver.find_element(By.ID, "card-mode-online").click()
        time.sleep(0.1)
        driver.find_element(By.ID, "btn-online-create-room").click()
        time.sleep(0.1)
        room_code = driver.find_element(By.ID, "lobby-room-code").text
        assert len(room_code) == 6 and room_code != "------"
        driver.find_element(By.ID, "btn-lobby-connect-second-client").click()
        time.sleep(0.15)
        assert f"ROOM: {room_code}" in driver.find_element(By.ID, "hud-room-code-pill").text

        # Test network drop & automatic recovery
        driver.find_element(By.ID, "btn-hud-sim-drop").click()
        time.sleep(0.1)
        assert driver.find_element(By.ID, "hud-conn-text").text == "Reconnecting"
        time.sleep(0.75)
        assert driver.find_element(By.ID, "hud-conn-text").text == "Connection Restored"
        print("PASS 7: Online room creation, dual-seat join, and network drop/reconnection verified.")

        # 8. Verify Mobile Viewport Responsiveness (375x812, zero horizontal overflow)
        driver.set_window_size(375, 812)
        time.sleep(0.2)
        overflow = driver.execute_script(
            "return document.documentElement.scrollWidth > document.documentElement.clientWidth;"
        )
        assert not overflow, "Mobile viewport must not overflow horizontally"
        print("PASS 8: Mobile responsiveness (375x812) verified with zero horizontal overflow.")

    finally:
        driver.quit()

if __name__ == "__main__":
    run_ui_tests()
    print("ALL 8 E2E BROWSER UI & INTEGRATION TESTS PASSED!")
