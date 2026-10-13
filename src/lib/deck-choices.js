'use strict';
const NATIVE_LAYOUTS=new Set(['title','content','bullets','section','titleonly','blank','two','compare']);
const ELEMENT_TYPES=new Set(['title','subtitle','heading','body','bullets']);
const TRANSITIONS=['none','fade'],BUILDS=['appear','fade','wipe','rise-up'],TRIGGERS=['click','with-previous','after-previous'];
module.exports={NATIVE_LAYOUTS,ELEMENT_TYPES,TRANSITIONS,BUILDS,TRIGGERS};
