#!/usr/bin/env python3
"""
xhs-search — 小红书搜索聚合脚本(解决"搜索不全")。

xiaohongshu-cli 的 `xhs search` 每次只返回一页(默认 ~20 条),单次调用必然漏结果。
本脚本:
  - 循环翻页(--pages,默认 3 页)直到没有更多结果
  - 多关键词(--kw 可多次)分别搜索后合并
  - 按 note 的 id/title 去重
  - 两次调用间退避(--pause),失败(ok:false)重试一次并把错误透出

用法示例:
  python3 scripts/xhs-search.py --kw "华中师范大学" --kw "桂子山" --pages 3 --sort latest
  python3 scripts/xhs-search.py --kw "华师 文学院" --sort popular --type video

输出:合并后的 JSON:
  {ok, total, unique, queries, results: [{kw, sort, page, title, url, id, payload}]}
"""
import argparse
import json
import subprocess
import sys
import time

MAX_PAGE_RESULTS_GUARD = 500  # 每关键词最多收 500 条,防失控


def run_xhs(xhs_bin: str, args: list[str], timeout: int) -> dict:
    try:
        proc = subprocess.run(
            [xhs_bin, *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except FileNotFoundError:
        return {"ok": False, "error": {"message": f"找不到 {xhs_bin},请先安装 xiaohongshu-cli 并确认 PATH"}}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": {"message": f"xhs 命令超时(>{timeout}s)"}}

    out = (proc.stdout or "").strip()
    if not out:
        return {"ok": False, "error": {"message": f"xhs 无输出(exit={proc.returncode}):{(proc.stderr or '').strip()[:200]}"}}
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return {"ok": False, "error": {"message": f"xhs 输出不是 JSON(exit={proc.returncode}):{out[:300]}"}}


def find_entries(data):
    """从 search 的 data 里取出笔记列表(xhs-cli 的字段名不固定,多兜底)。"""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("notes", "items", "results", "feeds", "data", "list"):
            if isinstance(data.get(key), list):
                return data[key]
        # 单个笔记对象
        if data.get("id") or data.get("note_id"):
            return [data]
    return []


def note_key(entry: dict) -> str:
    for field in ("id", "note_id", "noteId"):
        if entry.get(field):
            return str(entry[field])
    title = entry.get("title") or entry.get("display_title") or ""
    url = entry.get("link") or entry.get("url") or ""
    return f"{title}|{url}"


def entry_meta(entry: dict) -> dict:
    return {
        "id": entry.get("id") or entry.get("note_id"),
        "title": entry.get("title") or entry.get("display_title") or "",
        "url": entry.get("link") or entry.get("url") or "",
        "author": entry.get("user") or entry.get("author") or entry.get("nickname") or "",
        "liked_count": entry.get("liked_count") or entry.get("like_count") or "",
        "collected_count": entry.get("collected_count") or entry.get("collect_count") or "",
        "created_at": entry.get("created_at") or entry.get("time") or entry.get("display_time") or "",
        "payload": entry,
    }


def search_keyword(xhs_bin: str, kw: str, sort: str, typ: str, pages: int, pause: float, timeout: int):
    results = []
    seen = set()
    errors = []
    last_total = 0

    for page in range(1, pages + 1):
        attempt = 0
        resp = None
        while attempt < 2:
            if attempt > 0:
                time.sleep(pause * 2)
            resp = run_xhs(xhs_bin, ["search", kw, "--sort", sort, "--type", typ, "--page", str(page), "--json"], timeout)
            if resp.get("ok"):
                break
            attempt += 1

        if resp is None:
            errors.append({"page": page, "error": "无法启动 xhs"})
            break
        if not resp.get("ok"):
            err = resp.get("error", {})
            code = err.get("code", "") if isinstance(err, dict) else ""
            message = err.get("message", str(err)) if isinstance(err, dict) else str(err)
            errors.append({"page": page, "code": code, "message": message})
            if code in ("not_authenticated", "ip_blocked", "verification_required"):
                break  # 登录/风控类错误,继续翻页无意义
            break

        entries = find_entries(resp.get("data"))
        before = len(seen)
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            key = note_key(entry)
            if not key or key in seen:
                continue
            seen.add(key)
            meta = entry_meta(entry)
            meta["kw"] = kw
            meta["sort"] = sort
            meta["page"] = page
            results.append(meta)

        if len(entries) == 0 or len(seen) == before:
            break  # 本页无新增 → 到底了
        last_total = len(seen)
        if last_total >= MAX_PAGE_RESULTS_GUARD:
            break
        time.sleep(pause)

    return results, errors


def main() -> int:
    parser = argparse.ArgumentParser(description="小红书翻页聚合搜索")
    parser.add_argument("--kw", action="append", required=True, help="关键词(可多次指定)")
    parser.add_argument("--pages", type=int, default=3, help="每个关键词最多翻页数(默认 3)")
    parser.add_argument("--sort", choices=["general", "popular", "latest"], default="latest", help="排序(默认 latest,信息时效优先)")
    parser.add_argument("--type", choices=["all", "video", "image"], default="all", help="笔记类型过滤")
    parser.add_argument("--pause", type=float, default=2.0, help="请求间退避秒数(默认 2)")
    parser.add_argument("--xhs-bin", default="xhs", help="xhs 可执行文件(默认 xhs)")
    parser.add_argument("--timeout", type=int, default=60, help="单次 xhs 调用超时秒数")
    args = parser.parse_args()

    all_results = []
    all_errors = []
    queries = []
    for kw in args.kw:
        queries.append(kw)
        results, errors = search_keyword(args.xhs_bin, kw, args.sort, args.type, args.pages, args.pause, args.timeout)
        all_results.extend(results)
        all_errors.extend(errors)

    # 全局去重(多关键词交叉时同一条笔记)
    seen = set()
    unique = []
    for r in all_results:
        key = note_key(r.get("payload") or r)
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(r)

    print(json.dumps({
        "ok": True,
        "tool": "xhs-search",
        "total": len(all_results),
        "unique": len(unique),
        "queries": queries,
        "errors": all_errors,
        "results": unique,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
