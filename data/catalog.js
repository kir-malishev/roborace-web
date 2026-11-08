"use strict";
// The reviewed field geometry is the sole source for the game, editor and art.
const FieldFormat=require("../public/field-format");
const {FIELDS}=require("./fields");
const {START_CARDS,START_TEMPLATES}=require("./start");
const assetHashes=Object.fromEntries(require("../public/assets/manifest.json").assets.map(asset=>[asset.file,asset.sha256]));
const imageUrl=file=>"/roborace/"+file.slice(7)+(assetHashes[file]?"?v="+assetHashes[file].slice(0,12):"");
const EMPTY_FEATURES={...FieldFormat.hydrate(FieldFormat.emptyGeometry()),conveyorTurns:{}};
const ids=new Set(),names=new Set();
for(const field of FIELDS){
    if(!field.id || ids.has(field.id) || names.has(field.name)) throw new Error("Catalog fields need unique ids and names");
    ids.add(field.id);names.add(field.name);
}
const FIELD_DOCUMENTS=Object.fromEntries(FIELDS.map(field=>[field.name,FieldFormat.read(field)]));
const BOARD_FEATURES=Object.fromEntries(Object.values(FIELD_DOCUMENTS).map(c=>[c.name,FieldFormat.hydrate(c.features)]));
const BOARD_IDS=Object.fromEntries(FIELDS.map(c=>[c.name,`arena-${c.id}`]));
const BOARD_IMAGES=Object.fromEntries(FIELDS.map(c=>[c.name,imageUrl(`public/assets/boards/${BOARD_IDS[c.name]}.webp`)]));
const BOARD_THUMBNAILS=Object.fromEntries(FIELDS.map(c=>[c.name,imageUrl(`public/assets/boards/${BOARD_IDS[c.name]}-thumb.webp`)]));
const COURSE_CARDS=Object.values(FIELD_DOCUMENTS).flatMap(c=>c.routes.map((r,index)=>({
    id:`arena-${c.id}-${String.fromCharCode(97+index)}`,fieldId:c.id,name:r.name,board:c.name,
    routeLabel:String.fromCharCode(0x410+index),
    start:START_CARDS[0],rotation:0,flags:r.flags,
    min:2,max:8,players:"2–8",recommendedMin:r.recommendedMin,recommendedMax:r.recommendedMax,
    length:`${r.flags.length} флага`,level:r.difficulty
})));
module.exports={FIELD_DOCUMENTS,BOARD_FEATURES,BOARD_IDS,BOARD_IMAGES,BOARD_THUMBNAILS,START_CARDS,START_TEMPLATES,COURSE_CARDS,EMPTY_FEATURES};
