"""把发布的网页工程那份构建（project_site_store）托管成能在线打开的页面。纯函数：改路径、注入存储垫片、给响应头。

⚠ 2026-10-02 在线打开（project_site_store 头注）。三件事都是实测撞出来的约束，别删：

1. **必须 CSP sandbox（不带 allow-same-origin）。** 页面跑在我们自己的域名下；不隔离的话，别人发布的 JS 能带着
   看的人的登录态调我们的接口（删应用、改可见性）。iframe 上的 sandbox 属性只管嵌进来的那一次，有人直接打开
   这个地址照样执行——所以隔离写在响应头上，不靠前端。
2. **因此页面是「不透明来源」：localStorage 一碰就抛 SecurityError。** 模板做的小网页几乎都用 localStorage
   存数据（隔离真机历次：记账、喝水记录、书签……），不垫一层就白屏。垫片在页面自己的脚本之前装一个内存版
   Storage：初值从 window.name 读（外层页面放进去），每次改动 postMessage 给外层，外层存在看的人自己的浏览器里。
   直接打开（没有外层）时就是只在这一页有效的内存存储。
3. **vite 默认 base 是 "/"，产物里写的是 /assets/xxx.js。** 托管在 /api/sliderule/apps/{id}/site/ 下面，
   根路径要改成这个前缀；只改 dist 里真有的顶层条目（assets/、_whybuddy/、favicon.svg…），不碰别的斜杠。
   不透明来源加载 type=module 的脚本走 CORS，响应头要带 Access-Control-Allow-Origin: *（内容本来就是公开的）。
"""

from __future__ import annotations

import mimetypes
import re

SITE_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads"
STORAGE_MESSAGE = "wb-site-storage"
STORAGE_NAME_PREFIX = "wbstore:"

STORAGE_SHIM = (
    "<script>(function(){var d={};try{var n=window.name||\"\";if(n.indexOf(\"" + STORAGE_NAME_PREFIX + "\")===0)"
    "d=JSON.parse(n.slice(" + str(len(STORAGE_NAME_PREFIX)) + "))||{};}catch(e){}"
    "function k(){return Object.keys(d)}"
    "function s(){try{if(window.parent&&window.parent!==window)window.parent.postMessage({type:\"" + STORAGE_MESSAGE
    + "\",data:d},\"*\")}catch(e){}}"
    "function mk(persist){var m=persist?d:{};var t={getItem:function(x){x=String(x);"
    "return Object.prototype.hasOwnProperty.call(m,x)?m[x]:null},setItem:function(x,v){m[String(x)]=String(v);"
    "if(persist)s()},removeItem:function(x){delete m[String(x)];if(persist)s()},clear:function(){"
    "for(var y in m)delete m[y];if(persist)s()},key:function(i){return Object.keys(m)[i]||null}};"
    "Object.defineProperty(t,\"length\",{get:function(){return Object.keys(m).length}});return t}"
    "[[\"localStorage\",true],[\"sessionStorage\",false]].forEach(function(p){var ok=true;"
    "try{window[p[0]].getItem(\"x\")}catch(e){ok=false}"
    "if(!ok){try{Object.defineProperty(window,p[0],{value:mk(p[1]),configurable:true})}catch(e){}}});"
    "})();</script>"
)

_TEXT = (".html", ".htm", ".js", ".mjs", ".css")


def site_prefix(app_id: str) -> str:
    return f"/api/sliderule/apps/{app_id}/site/"


def resolve_path(files: dict[str, bytes], path: str) -> str | None:
    """请求路径 → dist 里的文件。目录 / 没扩展名的前端路由回落到 index.html；有扩展名但没有就是 404。"""
    clean = path.strip("/")
    if not clean:
        return "index.html"
    if ".." in clean.split("/"):
        return None
    if clean in files:
        return clean
    if clean + "/index.html" in files:
        return clean + "/index.html"
    if "." not in clean.rsplit("/", 1)[-1]:
        return "index.html"
    return None


def _rewrite(text: str, files: dict[str, bytes], prefix: str) -> str:
    tops = sorted({name.split("/", 1)[0] for name in files}, key=len, reverse=True)
    if not tops:
        return text
    pattern = re.compile(r"""(?<=["'`(=\s,])/(""" + "|".join(re.escape(t) for t in tops) + r""")(?=[/"'`)?#\s,]|$)""")
    return pattern.sub(lambda m: prefix + m.group(1), text)


def render(files: dict[str, bytes], name: str, prefix: str) -> tuple[bytes, str]:
    data = files[name]
    media = mimetypes.guess_type(name)[0] or "application/octet-stream"
    if name.endswith(".mjs"):
        media = "text/javascript"
    if not name.lower().endswith(_TEXT):
        return data, media
    text = _rewrite(data.decode("utf-8", "replace"), files, prefix)
    if name.lower().endswith((".html", ".htm")):
        head = re.search(r"<head[^>]*>", text, re.I)
        text = (text[:head.end()] + STORAGE_SHIM + text[head.end():]) if head else STORAGE_SHIM + text
        media = "text/html"
    return text.encode("utf-8"), media + "; charset=utf-8"


def site_headers(media: str) -> dict[str, str]:
    return {"Content-Type": media, "Content-Security-Policy": SITE_CSP, "Access-Control-Allow-Origin": "*",
            "Cross-Origin-Resource-Policy": "cross-origin", "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer", "Cache-Control": "no-cache"}
