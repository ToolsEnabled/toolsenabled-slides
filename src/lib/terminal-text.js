'use strict';
// Shared by the local view reader and its text CLI; pane parsing applies the
// same rule again at the client boundary. Never interpret document text.
function clean(value,maximum=8000,singleLine=false){
 let text=typeof value==='string'?value:String(value??'');
 text=text.replace(/#launch=[a-f0-9]{64}/gi,'#launch=[redacted]').replace(/(X-Slides-Session[\s:=]+)[a-f0-9]{64}/gi,'$1[redacted]').replace(/(slides_dashboard_\d+=)[a-f0-9]{64}/gi,'$1[redacted]').replace(/(instanceId[\s"':=]+)[a-f0-9]{48}/gi,'$1[redacted]');
 text=text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu,c=>!singleLine&&(c==='\n'||c==='\t')?c:'\ufffd');
 if(singleLine)text=text.replace(/\s+/gu,' ');
 const chars=Array.from(text),truncated=chars.length>maximum;
 return {text:truncated?chars.slice(0,maximum).join('')+'…':text,truncated};
}
module.exports={clean};
