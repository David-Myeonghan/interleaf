#!/usr/bin/env python3
"""Draws the extension icons.

No image library is installed on this machine, so the shapes are rasterised by
hand and the PNG is assembled from zlib-deflated scanlines. Supersampling gives
the rounded corners a clean edge at 16px, where the icon has to read as a page
with a highlighted line and a note beside it.
"""
import struct
import zlib
from pathlib import Path

SS = 8  # supersampling factor

INK = (0x1F, 0x24, 0x30)
PAPER = (0xFF, 0xFD, 0xF5)
MARK = (0xFF, 0xE2, 0x7A)
NOTE = (0xC8, 0xA8, 0x3A)


def rounded_rect(x, y, w, h, r):
    def inside(px, py):
        if not (x <= px <= x + w and y <= py <= y + h):
            return False
        for cx, cy in ((x + r, y + r), (x + w - r, y + r),
                       (x + r, y + h - r), (x + w - r, y + h - r)):
            if abs(px - cx) > r or abs(py - cy) > r:
                continue
            if (px < x + r or px > x + w - r) and (py < y + r or py > y + h - r):
                return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
        return True
    return inside


def compose(size):
    """Returns an RGBA buffer for one icon at `size` pixels."""
    n = size * SS
    u = n / 32.0  # design grid is 32 units wide

    plate = rounded_rect(0, 0, n, n, 7 * u)
    page = rounded_rect(6 * u, 4 * u, 13 * u, 24 * u, 1.5 * u)
    band = rounded_rect(8 * u, 12 * u, 9 * u, 3.4 * u, 0.6 * u)
    card = rounded_rect(21 * u, 13 * u, 7 * u, 10 * u, 1.2 * u)

    rows = []
    for py in range(n):
        row = []
        for px in range(n):
            cx, cy = px + 0.5, py + 0.5
            if not plate(cx, cy):
                row.append((0, 0, 0, 0))
            elif band(cx, cy):
                row.append(MARK + (255,))
            elif page(cx, cy):
                row.append(PAPER + (255,))
            elif card(cx, cy):
                row.append(NOTE + (255,))
            else:
                row.append(INK + (255,))
        rows.append(row)

    # Average each SS x SS block back down, which is what smooths the curves.
    out = bytearray()
    for y in range(size):
        out.append(0)  # PNG filter type 0
        for x in range(size):
            r = g = b = a = 0
            for dy in range(SS):
                for dx in range(SS):
                    pr, pg, pb, pa = rows[y * SS + dy][x * SS + dx]
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
            count = SS * SS
            if a:
                out += bytes((round(r / a), round(g / a), round(b / a), round(a / count)))
            else:
                out += bytes((0, 0, 0, 0))
    return bytes(out)


def write_png(path, size, raw):
    def chunk(tag, payload):
        body = tag + payload
        return struct.pack('>I', len(payload)) + body + struct.pack('>I', zlib.crc32(body))

    header = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', header)
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    Path(path).write_bytes(png)
    return len(png)


if __name__ == '__main__':
    out = Path(__file__).resolve().parent.parent / 'extension' / 'icons'
    out.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        written = write_png(out / f'icon{size}.png', size, compose(size))
        print(f'icon{size}.png  {written} bytes')
