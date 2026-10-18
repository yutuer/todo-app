"""把 lab/overlay.html 的皮肤层叠到最新的 index.html 上，生成 style-showcase.html。

设计要点：仓库里不保存 style-showcase.html，避免出现"第二份 app 副本"。
每次部署时现生成，主站一改，演示页自动跟着变。

用法：
    python3 lab/build.py            # 生成 style-showcase.html
    python3 lab/build.py --check    # 只校验 overlay 结构，不写文件
"""

import io
import sys

APP = 'index.html'
OVERLAY = 'lab/overlay.html'
OUT = 'style-showcase.html'

REQUIRED_IN_OVERLAY = [
    'class="skin-bar"',
    'data-skin="cyber"',
    'body[data-skin="ink"]',
]


def main() -> int:
    check_only = '--check' in sys.argv

    html = io.open(APP, encoding='utf-8').read()
    overlay = io.open(OVERLAY, encoding='utf-8').read()

    missing = [k for k in REQUIRED_IN_OVERLAY if k not in overlay]
    if missing:
        print('overlay 结构不完整，缺少: %s' % missing)
        return 1

    if '</body>' not in html:
        print('index.html 缺少 </body>，无法叠加')
        return 1

    if check_only:
        print('OK: overlay %d 字符，index.html %d 字符' % (len(overlay), len(html)))
        return 0

    out = html.replace('</body>', overlay + '</body>', 1)
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(out)
    print('built %s: %d bytes (app %d + overlay %d)'
          % (OUT, len(out.encode('utf-8')), len(html.encode('utf-8')), len(overlay.encode('utf-8'))))
    return 0


if __name__ == '__main__':
    sys.exit(main())
