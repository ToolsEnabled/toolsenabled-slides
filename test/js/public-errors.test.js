'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const {Client}=require('../helpers/mcp-client');
test('invalid imports and renderer diagnostics disclose no private paths or traceback',async()=>{
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'slides-private-'));fs.writeFileSync(path.join(workspace,'bad.pptx'),'not a ZIP');const sock=net.createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));const client=new Client({SLIDES_WORKSPACE:workspace,SUITE_PORT:String(port)});
 const created=require('node:child_process').spawnSync(require('../../src/lib/prerequisites').python(),['-c',`from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches
import sys
p=Presentation();s=p.slides.add_slide(p.slide_layouts[6]);d=CategoryChartData();d.categories=['Q1'];d.add_series('Sales',[10]);s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED,0,0,Inches(6),Inches(4),d);p.save(sys.argv[1])`,path.join(workspace,'chart.pptx')],{encoding:'utf8'});assert.equal(created.status,0,created.stderr);
 try{await client.tool('ppt_lock',{slide_ids:['s1']});const bad=await client.request('tools/call',{name:'ppt_import',arguments:{path:'bad.pptx'}});assert(bad.isError);const chart=await client.request('tools/call',{name:'ppt_import',arguments:{path:'chart.pptx'}});assert(chart.isError);assert.match(JSON.stringify(chart),/embedded workbooks/);assert.match(JSON.stringify(chart),/PNG, JPEG or GIF/);const renderer=await client.request('tools/call',{name:'ppt_renderer',arguments:{}});for(const result of [bad,chart,renderer]){const text=JSON.stringify(result);assert(!/Traceback|\.slides-state|\.venv|\/sandbox\/|\/tmp\/|[A-Z]:\\\\/.test(text),text);}}
 finally{await client.close();fs.rmSync(workspace,{recursive:true,force:true});}
});
