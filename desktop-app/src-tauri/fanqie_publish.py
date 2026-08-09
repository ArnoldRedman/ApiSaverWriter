#!/usr/bin/env python3
"""Best-effort Fanqie creator uploader using a persistent local browser profile.

The user completes Fanqie login in the opened browser once. No credentials or
cookies are written into the novel project; Playwright stores them in the
app-local browser profile.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def result(status: str, message: str, **extra: object) -> None:
    payload = {"status": status, "message": message, **extra}
    print(json.dumps(payload, ensure_ascii=False))


def first_visible(page, selectors: list[str]):
    for selector in selectors:
        locator = page.locator(selector).first
        try:
            if locator.is_visible(timeout=700):
                return locator
        except Exception:
            continue
    return None


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        result("missing_runtime", "当前设备缺少 Python Playwright，请安装 playwright 后重试。", detail=str(exc))
        return 0

    try:
        payload = json.load(sys.stdin)
        creator_url = str(payload.get("creatorURL") or "https://fanqienovel.com/main/writer")
        book_id = str(payload.get("bookId") or "").strip()
        chapter_title = str(payload.get("chapterTitle") or "").strip()
        content = str(payload.get("content") or "").strip()
        profile_dir = Path(str(payload.get("profileDir") or Path.home() / ".apisaverwriter" / "fanqie-browser"))
        profile_dir.mkdir(parents=True, exist_ok=True)
        if not chapter_title or not content:
            result("invalid", "发布章节需要标题和正文。")
            return 0

        url = creator_url
        if book_id and "book_id=" not in url:
            url += ("&" if "?" in url else "?") + f"book_id={book_id}"

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch_persistent_context(str(profile_dir), headless=False)
            page = browser.pages[0] if browser.pages else browser.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            page.wait_for_timeout(1_500)

            login_hint = page.get_by_text(re.compile(r"^(登录|扫码登录|登录/注册|立即登录)$", re.I)).first
            if login_hint.is_visible(timeout=800):
                # Keep the persistent browser open long enough for the user to scan
                # and complete login; its cookies remain in this local profile.
                for _ in range(120):
                    page.wait_for_timeout(1_500)
                    if not login_hint.is_visible(timeout=300):
                        break
                else:
                    result("login_required", "登录等待超时。请在已打开的番茄创作后台完成登录后再次发布。", url=page.url)
                    browser.close()
                    return 0

            title_input = first_visible(page, [
                "input[placeholder*='标题']", "input[placeholder*='章节']", "input[aria-label*='标题']", "input[type='text']",
            ])
            body_input = first_visible(page, [
                "textarea[placeholder*='正文']", "textarea[placeholder*='内容']", "[contenteditable='true']", "textarea",
            ])
            if title_input is None or body_input is None:
                result("manual_required", "已打开番茄创作后台，但页面结构需要手动确认；请在页面中粘贴本章内容。", url=page.url)
                browser.close()
                return 0

            title_input.fill(chapter_title)
            try:
                body_input.fill(content)
            except Exception:
                body_input.click()
                page.keyboard.insert_text(content)

            publish_button = first_visible(page, [
                "button:has-text('发布章节')", "button:has-text('发布')", "[role='button']:has-text('发布章节')", "[role='button']:has-text('发布')",
            ])
            if publish_button is None:
                result("prepared", "章节内容已填入番茄创作后台，请检查后手动点击发布。", url=page.url)
                browser.close()
                return 0
            publish_button.click()
            page.wait_for_timeout(1_500)
            result("published", "章节已提交到番茄创作后台。", url=page.url)
            browser.close()
            return 0
    except Exception as exc:
        result("error", f"番茄发布失败：{exc}")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
