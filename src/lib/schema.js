'use strict';
function validate(value,schema,where='arguments'){
 if(schema.enum&&!schema.enum.includes(value))throw new Error(`${where} must be one of ${schema.enum.join(', ')}`);
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${where} must be an object`);
  for(const key of schema.required||[])if(value[key]===undefined)throw new Error(`${where}.${key} is required`);
  for(const [key,item] of Object.entries(value)){if(!Object.hasOwn(schema.properties||{},key))throw new Error(`Unknown ${where}.${key}`);validate(item,schema.properties[key],`${where}.${key}`);}
 }else if(schema.type==='array'){
  if(!Array.isArray(value)||value.length>200)throw new Error(`${where} must be an array of at most 200 items`);
  value.forEach((v,i)=>validate(v,schema.items||{},`${where}[${i}]`));
 }else if(schema.type==='string'){
  if(typeof value!=='string'||value.length>16000)throw new Error(`${where} must be a string of at most 16000 characters`);
 }else if(['number','integer'].includes(schema.type)){
  if(typeof value!=='number'||!Number.isFinite(value)||(schema.type==='integer'&&!Number.isInteger(value)))throw new Error(`${where} must be a finite ${schema.type}`);
  if((schema.minimum!==undefined&&value<schema.minimum)||(schema.maximum!==undefined&&value>schema.maximum))throw new Error(`${where} is out of range`);
 }else if(schema.type==='boolean'&&typeof value!=='boolean')throw new Error(`${where} must be boolean`);
}
module.exports={validate};
