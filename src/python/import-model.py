"""Derive bounded, inert overlay data; never write live state."""
from process_limits import apply_memory_limit
if __name__ == '__main__':
    apply_memory_limit()
import sys, json, zipfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from pptx import Presentation
from import_pptx import derive_model
from lxml import etree
src, base = sys.argv[1:3]
from package_safety import validate_package, record_validation
validated_images = validate_package(src)
prs = Presentation(src)
if not 1 <= len(prs.slides) <= 200:
    raise ValueError('Import supports 1 to 200 slides')
model = derive_model(prs, Path(src).name, base)
encoded = json.dumps(model)
if len(encoded.encode()) > 2 * 1024 * 1024:
    raise ValueError('Imported model exceeds 2 MiB')
record_validation(src, validated_images)
print(encoded)
