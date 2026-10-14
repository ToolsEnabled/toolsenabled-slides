"""Build a byte-reproducible source distribution without runtime artifacts."""
import sys, zipfile, hashlib
from pathlib import Path
from package_inventory import files as source_files
root=Path(__file__).resolve().parent.parent
output=Path(sys.argv[1] if len(sys.argv)>1 else root/'dist/slides-0.1.8.zip')
output.parent.mkdir(parents=True,exist_ok=True)
files=source_files(root)
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name,p in sorted(files):
        info=zipfile.ZipInfo('slides/'+name,date_time=(2026,1,1,0,0,0));info.create_system=3
        info.external_attr=(0o100755 if name in {'slides-mcp.js','src/ppt.js'} else 0o100644)<<16
        info.compress_type=zipfile.ZIP_DEFLATED
        z.writestr(info,p.read_bytes(),compresslevel=9)
print(hashlib.sha256(output.read_bytes()).hexdigest()+'  '+str(output))
