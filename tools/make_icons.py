#!/usr/bin/env python3
"""Generates FixYouTube's toolbar/store icons (pure standard library).

Design: a red rounded square containing a white "play" triangle with a small
white check mark in the lower-right corner. Rendered with 4x4 supersampling.

Usage: python3 tools/make_icons.py
"""
import os
import struct
import zlib

SIZES = [16, 32, 48, 128]
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "FixYouTube", "icons")
RED = (204, 0, 0)
WHITE = (255, 255, 255)
SS = 4  # Supersampling factor per axis.


def inside_rounded_rect(x, y, size, radius):
    if x < 0 or y < 0 or x > size or y > size:
        return False
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def inside_triangle(x, y, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])

    d1, d2, d3 = sign((x, y), a, b), sign((x, y), b, c), sign((x, y), c, a)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def near_segment(x, y, p, q, width):
    px, py = p
    qx, qy = q
    dx, dy = qx - px, qy - py
    t = max(0.0, min(1.0, ((x - px) * dx + (y - py) * dy) / (dx * dx + dy * dy)))
    ex, ey = px + t * dx - x, py + t * dy - y
    return ex * ex + ey * ey <= (width / 2) ** 2


def render(size):
    s = float(size)
    radius = s * 0.22
    # Play triangle, slightly left of center to leave room for the check mark.
    tri = ((s * 0.30, s * 0.24), (s * 0.30, s * 0.70), (s * 0.68, s * 0.47))
    # Check mark in the lower-right corner.
    check = ((s * 0.56, s * 0.76), (s * 0.66, s * 0.86), (s * 0.86, s * 0.62))
    stroke = max(s * 0.09, 1.6)

    rows = []
    for py in range(size):
        row = bytearray([0])  # PNG filter type: none.
        for px in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(SS):
                for sx in range(SS):
                    x = px + (sx + 0.5) / SS
                    y = py + (sy + 0.5) / SS
                    if not inside_rounded_rect(x, y, s, radius):
                        continue
                    white = inside_triangle(x, y, *tri) or near_segment(x, y, check[0], check[1], stroke) or near_segment(
                        x, y, check[1], check[2], stroke
                    )
                    color = WHITE if white else RED
                    acc[0] += color[0]
                    acc[1] += color[1]
                    acc[2] += color[2]
                    acc[3] += 255
            n = SS * SS
            alpha = acc[3] / n
            if alpha > 0:
                # Un-premultiply the averaged color.
                cov = acc[3] / 255
                pixel = [round(acc[i] / cov) for i in range(3)] + [round(alpha)]
            else:
                pixel = [0, 0, 0, 0]
            row.extend(pixel)
        rows.append(bytes(row))
    return b"".join(rows)


def png(size, raw):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA.
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, f"{size}.png")
        with open(path, "wb") as f:
            f.write(png(size, render(size)))
        print("wrote", os.path.normpath(path))


if __name__ == "__main__":
    main()
