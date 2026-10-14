"""Copy a deck and add one external hyperlink relationship (to file:///etc/passwd) to its presentation part.

Used by test/js/security.test.js to prove that import refuses decks with external links. It is a separate program
so that the test, which talks to the local server over HTTP, runs no inline code.
Usage: python external_link_deck.py SOURCE.pptx DESTINATION.pptx
"""
import sys
import zipfile

src, dst = sys.argv[1:]
with zipfile.ZipFile(src) as z, zipfile.ZipFile(dst, 'w') as w:
    for n in z.namelist():
        b = z.read(n)
        if n == 'ppt/_rels/presentation.xml.rels':
            b = b.replace(b'</Relationships>', b'<Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="file:///etc/passwd" TargetMode="External"/></Relationships>')
        w.writestr(n, b)
