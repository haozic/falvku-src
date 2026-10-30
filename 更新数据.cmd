@echo off
chcp 65001 >nul
title 法律法规库 - 数据更新
cd /d "%~dp0"

echo.
echo   ============================================
echo      法律法规库 - 重新抓取并重建法规库
echo   ============================================
echo.
echo   需要网络连接；国家法律法规正文约需 30-60 分钟。
echo   （浏览器会自动打开用于下载附件，抓取中断可直接重跑，已下载的会跳过）
echo   共产党员网（12371）正文约需 3 分钟，带缓存，重跑只补新的。
echo.

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo   [错误] 未检测到 Python，无法自动更新。
    echo   请安装 Python 3 后重试，或直接使用现有数据。
    pause
    exit /b 1
)

echo   [1/9] 解析人民网书架目录 ...
python tools\parse_bookdata.py
echo.
echo   [2/9] 抓取党内法规全文 ...
python tools\crawl.py
echo.
echo   [3/9] 补抓缺失的公务员管理类办法 ...
python tools\supplement4.py
echo.
echo   [4/9] 抓取共产党员网「党章党规」专页（12371）...
python tools\crawl_12371.py --list
python tools\crawl_12371_docs.py --docs
echo.
echo   [5/9] 抓取国家法律法规目录（flk）...
python tools\crawl_flk.py --stage list
echo.
echo   [6/9] 下载国家法律法规正文附件（真实浏览器）...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo   [跳过] 未检测到 Node.js，国家法律法规正文不会更新。
) else (
    python tools\make_flk_items.py --docx-only
    node tools\crawl_flk_ctx.js tools\flk_items.json tools\flk_cache 2 4000
)
python tools\finish_flk.py --docs
echo   [补] 处理少数旧版 .doc 附件（需要本机装有 Microsoft Word）...
python tools\fetch_flk_doc.py
python tools\finish_flk.py --details
python tools\finish_flk.py --merge
echo   [体检] 核对「正文 ↔ 编号」是否一致 ...
python tools\verify_flk_mapping.py
echo   [串档] 排查「不同标题却同一篇正文」的附件串档 ...
python tools\wrong_owner.py
echo   [重算] 剥离源文档「目 录」块、重建两级章节结构 ...
python tools\repair_flk_sections.py
echo.
echo   [湖北] 抓取湖北地方法规（列表 + 详情正文）...
python tools\crawl_hubei.py
echo.
echo   [7/9] 生成数据集 ...
python tools\build_dataset.py
echo.
echo   [8/9] 生成自检页 ...
python tools\make_selftest.py
echo.
echo   [9/9] 完成。请在浏览器中按 Ctrl+F5 强制刷新页面。
echo.
pause
