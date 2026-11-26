"""把 dist 产物写进 APK 的 assets/public 目录，路径统一使用正斜杠。

aapt2 的 -A 参数在 Windows 上会把子目录写成反斜杠（assets/public\\assets\\x.js），
AssetManager 按 assets/public/assets/x.js 查找会失败，所以这里自己压。
"""
import os
import sys
import zipfile


def main() -> int:
    apk, root = sys.argv[1], sys.argv[2]
    if not os.path.isdir(root):
        print(f"assets 目录不存在：{root}")
        return 1

    with zipfile.ZipFile(apk, "a", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, _dirnames, filenames in os.walk(root):
            for name in filenames:
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, root).replace("\\", "/")
                zf.write(full, "assets/" + rel)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
