'use strict';
// Writes a one-slide deck that Slides did not write, for test/js/managed-presentation.test.js. It runs python-pptx in a
// child process, so it lives apart from that test, which polls the local server over HTTP and runs no program itself.
const assert=require('node:assert/strict');const fs=require('node:fs');const {spawnSync}=require('node:child_process');
const {python}=require('../../src/lib/prerequisites');
function deck(file,title){const r=spawnSync(python(),['-c','import sys\nfrom pptx import Presentation\np=Presentation()\ns=p.slides.add_slide(p.slide_layouts[0])\ns.shapes.title.text=sys.argv[2]\np.save(sys.argv[1])',file,title],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);return fs.readFileSync(file);}
module.exports={deck};
