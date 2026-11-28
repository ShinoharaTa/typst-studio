"""PNG の IDAT を zlib レベル 9 で圧縮し直す（画素は変えない。標準ライブラリだけで動く）

typst の PNG 出力は速さ優先の圧縮で、単色の多いプレースホルダーでも数百 KB になるため。
使い方: python3 recompress-png.py <png>...
"""
import struct
import sys
import zlib


def chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def recompress(path: str) -> None:
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path}: not a PNG")
    pos, idat, before, after = 8, b"", [], []
    while pos < len(data):
        (n,) = struct.unpack(">I", data[pos : pos + 4])
        kind, body = data[pos + 4 : pos + 8], data[pos + 8 : pos + 8 + n]
        pos += 12 + n
        if kind == b"IDAT":
            idat += body
        elif idat:
            after.append((kind, body))
        else:
            before.append((kind, body))
    packed = zlib.compress(zlib.decompress(idat), 9)
    out = data[:8] + b"".join(chunk(k, b) for k, b in before) + chunk(b"IDAT", packed)
    out += b"".join(chunk(k, b) for k, b in after)
    open(path, "wb").write(out)
    print(f"{path}: {len(data)} -> {len(out)} bytes", file=sys.stderr)


for p in sys.argv[1:]:
    recompress(p)
