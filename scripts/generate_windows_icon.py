from __future__ import annotations

import argparse
import shutil
import subprocess
from pathlib import Path

from PIL import Image

ICON_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


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


def regenerate_app_png(svg_path: Path, app_png: Path, inset: float) -> None:
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
        render_inset_png(source_png, app_png, inset)
    finally:
        if source_png.exists():
            source_png.unlink()


def write_ico(app_png: Path, ico_path: Path) -> None:
    ico_path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(app_png).convert("RGBA")
    image.save(ico_path, format="ICO", sizes=ICON_SIZES)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Windows icon file for Wails build.")
    parser.add_argument("--svg", required=True, help="Source SVG path")
    parser.add_argument("--app-png", required=True, help="Intermediate app PNG path")
    parser.add_argument("--ico", required=True, help="Output ICO path")
    parser.add_argument("--inset", type=float, default=0.85, help="Inset ratio for icon content")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    svg_path = Path(args.svg)
    app_png = Path(args.app_png)
    ico_path = Path(args.ico)

    if args.inset <= 0 or args.inset > 1:
        raise ValueError("--inset must be in the range (0, 1].")

    regenerate_app_png(svg_path, app_png, args.inset)
    if not app_png.exists():
        raise RuntimeError(f"Expected app PNG was not created: {app_png}")

    write_ico(app_png, ico_path)


if __name__ == "__main__":
    main()
