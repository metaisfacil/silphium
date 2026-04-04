from __future__ import annotations

import argparse
import io
import shutil
import struct
import subprocess
from pathlib import Path

from PIL import Image

ICON_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

ICNS_INFO_PLIST = """<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
    <key>com.apple.icns.icon-type</key>
    <string>Silphium</string>
</dict>
</plist>
""".encode("utf-8")


def render_inset_png(source_png: Path, output_png: Path, inset: float) -> None:
    src = Image.open(source_png).convert("RGBA")
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))

    target_side = max(1, int(1024 * inset))
    scale = target_side / max(src.width, src.height)
    new_width = max(1, int(round(src.width * scale)))
    new_height = max(1, int(round(src.height * scale)))

    src = src.resize((new_width, new_height), Image.Resampling.LANCZOS)
    x = (1024 - src.width) // 2
    y = (1024 - src.height) // 2
    canvas.paste(src, (x, y), src)
    canvas.save(output_png)


def regenerate_app_png(svg_path: Path, app_png: Path) -> None:
    magick = shutil.which("magick")
    if not magick:
        if app_png.exists():
            return
        raise RuntimeError("ImageMagick (magick) is not available and build/appicon.png does not exist.")

    source_png = app_png.with_suffix(".source.png")
    try:
        subprocess.run(
            [magick, "-background", "none", "-density", "384", str(svg_path), "-resize", "1024x1024", str(source_png)],
            check=True,
        )
        app_png.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_png, app_png)
    finally:
        if source_png.exists():
            source_png.unlink()


def write_ico(app_png: Path, ico_path: Path) -> None:
    ico_path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(app_png).convert("RGBA")
    image.save(ico_path, format="ICO", sizes=ICON_SIZES)


def write_icns(app_png: Path, icns_path: Path) -> None:
    icns_path.parent.mkdir(parents=True, exist_ok=True)
    source = Image.open(app_png).convert("RGBA")

    def resized(size: int) -> Image.Image:
        return source.resize((size, size), Image.Resampling.LANCZOS)

    def png_bytes(size: int) -> bytes:
        with io.BytesIO() as buf:
            resized(size).save(buf, format="PNG")
            return buf.getvalue()

    def argb_bytes(size: int) -> bytes:
        rgba = resized(size)
        raw = rgba.tobytes()
        pixel_count = size * size
        a = bytearray(pixel_count)
        r = bytearray(pixel_count)
        g = bytearray(pixel_count)
        b = bytearray(pixel_count)
        # Legacy ARGB chunks use planar channel data: A plane, then R, G, B.
        for px in range(pixel_count):
            i = px * 4
            r[px] = raw[i]
            g[px] = raw[i + 1]
            b[px] = raw[i + 2]
            a[px] = raw[i + 3]
        planar = bytes(a + r + g + b)
        return b"ARGB" + packbits_literal_encode(planar)

    def packbits_literal_encode(data: bytes) -> bytes:
        encoded = bytearray()
        i = 0
        # Encode as literal-only packets for broad compatibility in third-party viewers.
        while i < len(data):
            chunk = data[i : i + 128]
            encoded.append(len(chunk) - 1)
            encoded.extend(chunk)
            i += len(chunk)
        return bytes(encoded)

    info_payload = ICNS_INFO_PLIST
    if len(info_payload) < 310:
        info_payload = info_payload + (b" " * (310 - len(info_payload)))
    elif len(info_payload) > 310:
        raise RuntimeError("ICNS info plist payload exceeded 310 bytes.")

    chunks: list[tuple[bytes, bytes]] = [
        (b"ic12", png_bytes(64)),
        (b"ic07", png_bytes(128)),
        (b"ic13", png_bytes(256)),
        (b"ic08", png_bytes(256)),
        (b"ic04", argb_bytes(16)),
        (b"ic14", png_bytes(512)),
        (b"ic09", png_bytes(512)),
        (b"ic05", argb_bytes(32)),
        (b"ic10", png_bytes(1024)),
        (b"ic11", png_bytes(32)),
        (b"info", info_payload),
    ]

    total_size = 8 + sum(8 + len(payload) for _, payload in chunks)
    with icns_path.open("wb") as f:
        f.write(b"icns")
        f.write(struct.pack(">I", total_size))
        for chunk_type, payload in chunks:
            f.write(chunk_type)
            f.write(struct.pack(">I", 8 + len(payload)))
            f.write(payload)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate app icon assets for all target OS formats.")
    parser.add_argument("--svg", required=True, help="Source SVG path")
    parser.add_argument("--app-png", required=True, help="Intermediate app PNG path")
    parser.add_argument("--ico", required=True, help="Output ICO path")
    parser.add_argument("--icns", required=True, help="Output ICNS path")
    parser.add_argument(
        "--bundle-icns",
        default="",
        help="Optional macOS app bundle icon path to copy generated ICNS into if it already exists",
    )
    parser.add_argument("--inset", type=float, default=0.85, help="Inset ratio for macOS ICNS icon content")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    svg_path = Path(args.svg)
    app_png = Path(args.app_png)
    ico_path = Path(args.ico)
    icns_path = Path(args.icns)
    bundle_icns_path = Path(args.bundle_icns) if args.bundle_icns else None

    if args.inset <= 0 or args.inset > 1:
        raise ValueError("--inset must be in the range (0, 1].")

    regenerate_app_png(svg_path, app_png)
    if not app_png.exists():
        raise RuntimeError(f"Expected app PNG was not created: {app_png}")

    # Windows icon should stay uninset; inset is macOS-only for dock appearance.
    write_ico(app_png, ico_path)

    icns_source_png = app_png
    if args.inset < 1:
        icns_source_png = app_png.with_suffix(".icns.png")
        render_inset_png(app_png, icns_source_png, args.inset)
    write_icns(icns_source_png, icns_path)

    if icns_source_png != app_png and icns_source_png.exists():
        icns_source_png.unlink()

    if bundle_icns_path and bundle_icns_path.exists():
        bundle_icns_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(icns_path, bundle_icns_path)


if __name__ == "__main__":
    main()
