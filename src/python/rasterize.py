"""Render every PDF page with the local pypdfium2 wheel."""
from process_limits import apply_memory_limit
if __name__ == '__main__':
    apply_memory_limit()
import sys
from pathlib import Path
import pypdfium2 as pdfium
source, dest = sys.argv[1:3]
out = Path(dest); out.mkdir(parents=True, exist_ok=True)
with pdfium.PdfDocument(source) as pdf:
    if not 1 <= len(pdf) <= 200:
        raise ValueError('PNG export supports 1 to 200 pages')
    for i in range(len(pdf)):
        page = pdf[i]
        scale = min(1600 / max(page.get_size()), 3)
        bitmap = page.render(scale=scale)
        image = bitmap.to_pil()
        image.save(out / f'slide-{i+1}.png')
        image.close(); bitmap.close(); page.close()
