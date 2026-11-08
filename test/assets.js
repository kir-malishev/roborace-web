"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const root=path.resolve(__dirname,".."),manifest=require("../public/assets/manifest.json");
const {geometryHash,rendererHash}=require("../scripts/asset-inputs");
const {FIELDS}=require("../data/fields"),Field=require("../public/field-format");
assert.equal(manifest.rendererSha256,rendererHash(root),"Asset renderer inputs changed; run npm run assets:build");
const fields=Object.fromEntries(FIELDS.map(field=>[`arena-${field.id}`,Field.read(field).features]));
const digest=buffer=>crypto.createHash("sha256").update(buffer).digest("hex");
assert.equal(manifest.lockfileSha256,digest(fs.readFileSync(path.join(root,"package-lock.json"))));
const expected=new Set(manifest.assets.map(asset=>asset.file));
assert(expected.size>0&&expected.size===manifest.assets.length,"Manifest is empty or contains duplicate files");
let vectors=0,bitmaps=0,thumbnails=0;
for(const asset of manifest.assets){
    const data=fs.readFileSync(path.join(root,asset.file));
    assert.equal(digest(data),asset.sha256,`Asset checksum mismatch: ${asset.file}`);
    if(asset.kind==="arena-thumbnail"||asset.kind==="precomputed-arena"){
        const id=path.basename(asset.file,".webp").replace(/-thumb$/,"");
        assert(fields[id],`Unknown field image: ${asset.file}`);
        assert.equal(asset.geometrySha256,geometryHash(fields[id]),`Geometry changed for ${id}; run npm run assets:build`);
        assert.equal(data.toString("ascii",8,12),"WEBP");
        assert(data.length<(asset.kind==="arena-thumbnail"?50000:300000),`Image exceeds its download budget: ${asset.file}`);
        if(asset.kind==="arena-thumbnail")thumbnails+=data.length;else bitmaps+=data.length;
    }else{
        assert.equal(asset.kind,"svg-illustration");vectors+=data.length;
        const svg=data.toString("utf8");
        assert(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
        assert(!/<script\b|https?:\/\/(?!www\.w3\.org)/i.test(svg));
        const references=[...svg.matchAll(/(?:xlink:)?href="([^"]+)"/g)].map(match=>match[1]);
        assert(references.every(reference=>reference.startsWith("#")),`External image dependency: ${asset.file}`);
    }
}
function scan(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const file=path.join(dir,entry.name);
    return entry.isDirectory()?scan(file):[path.relative(root,file).replace(/\\/g,"/")];
});}
assert.deepStrictEqual(new Set(scan(path.join(root,"public/assets")).filter(file=>file!=="public/assets/manifest.json")),expected,"Asset directory and manifest differ");
for(const id of Object.keys(fields))for(const suffix of ["","-thumb"])
    assert(expected.has(`public/assets/boards/${id}${suffix}.webp`),`Missing field asset: ${id}${suffix}`);
assert(vectors<500000&&bitmaps<3500000&&thumbnails<500000,"Asset set exceeds its download budget");
console.log("Asset geometry/renderer freshness, output checksums, completeness and download budgets passed.");

// Run the actual server entry point with in-memory source/file changes.
const {spawnSync}=require("child_process");
function startup(mutation){
    return spawnSync(process.execPath,["-e",`
        const fs=require('fs'),path=require('path'),Module=require('module');
        const root=process.cwd(),read=fs.readFileSync,load=Module._load;
        ${mutation}
        require('./module');
    `],{cwd:root,encoding:"utf8"});
}
assert.equal(startup("").status,0,"current graphics prevented server startup");
assert.equal(startup(`Module._load=function(id,...args){const result=load.call(this,id,...args);if(id==='../data/fields'){
    const copy=JSON.parse(JSON.stringify(result));copy.FIELDS[0].name='Renamed';copy.FIELDS[0].routes[0].flags=[[0,13]];return copy;}return result;};`).status,
    0,"names or routes unnecessarily require rebuilding backgrounds");
const cases=[
    ["geometry",`Module._load=function(id,...args){const result=load.call(this,id,...args);if(id==='../data/fields'){
        const copy=JSON.parse(JSON.stringify(result));copy.FIELDS[0].features.repairs.push('0,13');return copy;}return result;};`,"геометрия"],
    ["renderer",`fs.readFileSync=function(file,...args){const value=read.call(this,file,...args);return path.resolve(file)===path.join(root,'public/arena-art.js')?value+' ':value;};`,"исходники генератора"],
    ["corrupted WebP",`fs.readFileSync=function(file,...args){return String(file).endsWith('arena-02.webp')?Buffer.from('damaged'):read.call(this,file,...args);};`,"контрольная сумма"],
    ["missing WebP",`fs.readFileSync=function(file,...args){if(String(file).endsWith('arena-02.webp'))throw new Error('ENOENT');return read.call(this,file,...args);};`,"ENOENT"]
];
for(const [label,mutation,reason] of cases){
    const result=startup(mutation);
    assert.notEqual(result.status,0,`${label} did not prevent server startup`);
    assert(result.stderr.includes(reason)&&result.stderr.includes("npm run assets:build"),`${label}: ${result.stderr}`);
}
console.log("Server startup accepts current assets and rejects stale geometry/renderers, corrupt and missing WebP files.");
