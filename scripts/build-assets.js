"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {createCanvas,loadImage} = require("@napi-rs/canvas");
const {FIELDS}=require("../data/fields");
const Field=require("../public/field-format");
const {geometryHash,rendererHash,verifyAssets}=require("./asset-inputs");
const root = path.resolve(__dirname,"..");
const manifest = [];
const digest = buffer => crypto.createHash("sha256").update(buffer).digest("hex");
function write(file,svg,description) {
    const target=path.join(root,file);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,svg+"\n");
    manifest.push({file,kind:"svg-illustration",generator:"public/arena-art.js",sha256:digest(fs.readFileSync(target)),description});
}
async function main() {
    const art=require("../public/arena-art");
    async function boardBitmap(features,id,description) {
        const svg=art.render(features,{rows:16,starts:features.starts,id,beams:false});
        const image=await loadImage(Buffer.from(svg));
        const canvas=createCanvas(1440,1920);
        canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
        const thumbnail=createCanvas(300,400);
        thumbnail.getContext("2d").drawImage(canvas,0,0,300,400);
        const outputs=[[canvas,"",86,"precomputed-arena"],[thumbnail,"-thumb",82,"arena-thumbnail"]];
        for(const [bitmap,suffix,quality,kind] of outputs){
            const buffer=bitmap.toBuffer("image/webp",quality),file=`public/assets/boards/${id}${suffix}.webp`;
            fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});
            fs.writeFileSync(path.join(root,file),buffer);
            manifest.push({file,kind,generator:"public/arena-art.js",source:"data/fields.js",
                geometrySha256:geometryHash(features),width:bitmap.width,height:bitmap.height,
                sha256:digest(buffer),description});
        }
    }
    for(const source of FIELDS){
        const field=Field.read(source);
        await boardBitmap(field.features,`arena-${field.id}`,field.name);
    }
    const empty = () => ({pits:[],repairs:[],gears:{},conveyors:{},express:[],walls:[],lasers:[],pushers:[]});
    function icon(name) {
        const f=empty();
        if(name.includes("straight")) {f.conveyors["0,0"]="east";if(name.startsWith("express"))f.express=["0,0"];}
        if(name==="pit")f.pits=["0,0"];
        if(name==="repair")f.repairs=["0,0"];
        if(name.startsWith("gear"))f.gears["0,0"]=name.endsWith("left")?-1:1;
        if(name==="wall")f.walls=["0,0,north"];
        if(name==="laser") {f.walls=["0,0,west"];f.lasers=[{x:0,y:0,direction:"east",count:1}];}
        if(name==="pusher") {f.walls=["0,0,west"];f.pushers=[{x:0,y:0,direction:"east",active:[2,4]}];}
        let svg=art.render(f,{columns:1,rows:1,id:"icon-"+name});
        if(name==="flag")svg=svg.replace("</svg>",art.checkpointMarkup(1)+"</svg>");
        if(name==="erase")svg=svg.replace("</svg>",'<path d="M25 65 57 27 80 49 50 82H40Z" fill="#8fa7c6" stroke="#d6e2fa" stroke-width="3"/><path d="m39 49 24 21M23 84h57" stroke="#d6e2fa" stroke-width="3"/></svg>');
        return svg;
    }
    for(const name of ["belt-straight","express-straight","pit","repair","gear-left","gear-right","wall","laser","pusher","flag","erase"])
        write(`public/assets/editor/${name}.svg`,icon(name),`Editor tool: ${name}`);
    const guide={
        "conveyor-straight":{conveyors:{"0,0":"east","1,0":"east","2,0":"east","0,2":"east","1,2":"east","2,2":"east"},express:["0,2","1,2","2,2"]},
        "conveyor-turn":{conveyors:{"1,2":"north","1,1":"east","2,1":"east"}},
        "conveyor-merge-triple":{conveyors:{"0,1":"east","2,1":"west","1,2":"north","1,1":"north","1,0":"north"},express:["0,1","2,1","1,2","1,1","1,0"]},
        "pusher-odd":{walls:["1,1,west"],pushers:[{x:1,y:1,direction:"east",active:[1,3,5]}]},
        "gear-clockwise":{gears:{"0,1":1,"2,1":-1}},
        "laser-double":{walls:["0,1,west","2,1,east"],lasers:[{x:0,y:1,direction:"east",count:2}]},
        "wall":{walls:["1,0,east","1,1,east","1,2,east"]},
        "pit":{pits:["1,0","0,1","1,1","2,1","1,2"]},"repair":{repairs:["1,1"]}
    };
    for(const [name,f] of Object.entries(guide))write(`public/assets/guide/${name}.svg`,art.render({...empty(),...f},{rows:name==="conveyor-turn"?4:3,columns:3,id:"guide-"+name}),`Guide scene: ${name}`);
    for(const wall of [false,true]){
        const name=wall?"collision-wall":"collision";
        write(`public/assets/guide/${name}.svg`,art.render({...empty(),walls:wall?["3,2,east"]:[]},{rows:5,columns:6,id:"guide-"+name}),`Guide scene: ${name}`);
    }
    fs.writeFileSync(path.join(root,"public/assets/manifest.json"),JSON.stringify({brand:"RoboRace",version:1,rendererSha256:rendererHash(root),
        lockfileSha256:digest(fs.readFileSync(path.join(root,"package-lock.json"))),
        assets:manifest},null,2)+"\n");
    verifyAssets(root);
    console.log(`Built ${manifest.length} field, editor and guide assets; SVG field masters are not stored.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
