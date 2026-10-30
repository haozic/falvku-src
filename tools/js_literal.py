# -*- coding: utf-8 -*-
"""极简 JS 字面量解析器：把页面里的 `itemELMT=[{...}]` 解成 Python 对象。

不能用 json.loads —— 这些是 JS 字面量（键和值用单引号），
且值里常含 HTML（`brief` 字段带 <a href="...">，双引号会破坏 JSON）。
"""


class JsParseError(ValueError):
    pass


def parse_js(text, i=0):
    """从 text[i] 开始解析一个 JS 值，返回 (value, next_index)。"""
    n = len(text)
    while i < n and text[i] in " \t\r\n":
        i += 1
    if i >= n:
        raise JsParseError("意外结束")
    ch = text[i]

    if ch == "'" or ch == '"':
        return _parse_string(text, i)
    if ch == "{":
        return _parse_object(text, i)
    if ch == "[":
        return _parse_array(text, i)
    # 数字 / true / false / null / undefined
    j = i
    while j < n and (text[j].isalnum() or text[j] in "+-._"):
        j += 1
    tok = text[i:j]
    if tok == "true":
        return True, j
    if tok == "false":
        return False, j
    if tok in ("null", "undefined", ""):
        return None, j
    try:
        return (int(tok) if tok.isdigit() else float(tok)), j
    except ValueError:
        return tok, j


def _parse_string(text, i):
    quote = text[i]
    i += 1
    out = []
    n = len(text)
    while i < n:
        c = text[i]
        if c == "\\":
            i += 1
            if i >= n:
                break
            e = text[i]
            mapping = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f",
                       "v": "\v", "0": "\0", "\\": "\\", "'": "'", '"': '"', "/": "/"}
            if e == "u" and i + 4 < n:
                try:
                    out.append(chr(int(text[i + 1:i + 5], 16)))
                    i += 5
                    continue
                except ValueError:
                    pass
            out.append(mapping.get(e, e))
            i += 1
            continue
        if c == quote:
            return "".join(out), i + 1
        out.append(c)
        i += 1
    raise JsParseError("字符串未闭合")


def _parse_object(text, i):
    i += 1
    obj = {}
    n = len(text)
    while i < n:
        while i < n and text[i] in " \t\r\n,":
            i += 1
        if i < n and text[i] == "}":
            return obj, i + 1
        if i < n and (text[i] == "'" or text[i] == '"'):
            key, i = _parse_string(text, i)
        else:
            j = i
            while j < n and (text[j].isalnum() or text[j] in "_$"):
                j += 1
            if j == i:
                raise JsParseError("对象键解析失败 @%d" % i)
            key = text[i:j]
            i = j
        while i < n and text[i] in " \t\r\n":
            i += 1
        if i < n and text[i] == ":":
            i += 1
        val, i = parse_js(text, i)
        obj[key] = val
    raise JsParseError("对象未闭合")


def _parse_array(text, i):
    i += 1
    arr = []
    n = len(text)
    while i < n:
        while i < n and text[i] in " \t\r\n,":
            i += 1
        if i < n and text[i] == "]":
            return arr, i + 1
        val, i = parse_js(text, i)
        arr.append(val)
    raise JsParseError("数组未闭合")


def parse_js_array_at(text, start):
    """text[start] 必须是 '['，返回解析出的数组。"""
    if text[start] != "[":
        raise JsParseError("不是数组起点")
    val, _ = _parse_array(text, start)
    return val


def find_array_blob(text, pattern_start):
    """从 pattern_start（'[' 的下标）扫描到配对的 ']'，返回切片文本。"""
    depth = 0
    i = pattern_start
    n = len(text)
    in_str = False
    quote = ""
    esc = False
    while i < n:
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == quote:
                in_str = False
        else:
            if c in "'\"":
                in_str = True
                quote = c
            elif c == "[":
                depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    return text[pattern_start:i + 1]
        i += 1
    raise JsParseError("数组未闭合")
