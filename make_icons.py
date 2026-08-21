from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'icon_source.png'
OUT = ROOT / 'icons'
OUT.mkdir(exist_ok=True)

with Image.open(SOURCE) as image:
    image = image.convert('RGBA')
    if image.width != image.height:
        size = min(image.size)
        left = (image.width - size) // 2
        top = (image.height - size) // 2
        image = image.crop((left, top, left + size, top + size))
    for size in (16, 32, 48, 128):
        resized = image.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(OUT / f'icon{size}.png', 'PNG', optimize=True)
        print(f'icon{size}.png: {resized.width}x{resized.height}, mode={resized.mode}')
