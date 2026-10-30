# -*- coding: utf-8 -*-
r"""生成临时主题页面：把 index.html 复制一份并强制指定主题。

用法：
    python tools/make_dark_page.py          # 生成 tools/_dark.html（深色）
    python tools\make_dark_page.py light    # 生成 tools/_light.html（浅色）
    python tools\make_dark_page.py dark tools/_dark2.html

两个坑，都在这里处理掉了：

1. **不能靠 localStorage 传主题**：临时页与 index.html 同源（origin 只看 protocol+host+port），
   往 localStorage 写 theme 会把同 origin 的 index.html、自检页一起变成深色 —— 实测
   index.html 的 <html data-theme> 会被写成 "dark"。所以这里**只硬置 DOM 属性**。
2. **光设属性会被覆盖**：app.js 的 boot() 在 DOMContentLoaded 时调 applyTheme()，
   用 localStorage 的设置重刷 data-theme。注入脚本放在 </body> 前，
   其 DOMContentLoaded 监听器在 boot 之后注册，因此 load 后再强制一次即可生效。
"""
import io, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(ROOT, "index.html")

theme = sys.argv[1] if len(sys.argv) > 1 else 'dark'
dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "tools", "_%s.html" % theme)

html = io.open(src, encoding="utf-8").read()
base = '<base href="/">'
inject = (
    '<script>(function(){var t=%r;'
    'function force(){document.documentElement.setAttribute("data-theme",t);}'
    'force();'
    'document.addEventListener("DOMContentLoaded",function(){force();setTimeout(force,0);});'
    'window.addEventListener("load",function(){force();setTimeout(force,300);setTimeout(force,1200);});'
    '})();</script>\n</body>' % theme
)
# 每次都从 index.html 重新生成：临时页是副本，index.html 改了必须重建，
# 否则截到的是旧版页面（之前就因此漏看了顶栏改动）。
html = html.replace("<head>", "<head>\n" + base, 1)
html = html.replace("</body>", inject, 1)
io.open(dst, "w", encoding="utf-8").write(html)
print("written", dst)
