"use strict";
const assert=require("assert");
const art=require("../public/arena-art");
const conveyors={"0,1":"east","2,1":"west","1,2":"north","1,1":"north","1,0":"north"};
const f={conveyors,conveyorConnections:["0,1|1,1","2,1|1,1","1,2|1,1","1,1|1,0"]};
const svg=art.render(f,{columns:3,rows:3,id:"test"});
const center=svg.split('data-cell="1,1"')[1].split('</g></g>')[0];
assert.equal((center.match(/class="race-flow-arrow"/g)||[]).length,3,"three inlet arrows must share one exit");
const abutment=art.render({...f,conveyorConnections:["1,1|1,0"]},{columns:3,rows:3,id:"test"});
assert(!abutment.includes('class="race-flow-arrow"'),"unconnected neighboring lanes must not indicate a turn");
const beam={walls:["3,1,east"],lasers:[{x:1,y:1,direction:"east",count:2}]};
const segments=art.laserSegments(beam);
assert.equal(segments.length,2);assert(segments.every(s=>s.x2<4&&s.x2>3));
assert(!art.render(beam,{columns:5,rows:3,beams:false}).includes('class="race-static-laser"'),"backgrounds must not bake in the upper laser layer");
assert(art.checkpointMarkup(1).includes('class="race-checkpoint-frame"'));
const boundaryBeams={walls:["0,1,west","2,1,east","1,0,north","1,2,south"],lasers:[
    {x:0,y:1,direction:"east",count:3},{x:2,y:1,direction:"west"},
    {x:1,y:0,direction:"south"},{x:1,y:2,direction:"north"}]};
const borderSegments=art.laserSegments(boundaryBeams,{columns:3,rows:3});
assert(borderSegments.every(s=>Math.min(s.x1,s.x2,s.y1,s.y2)>=.23-1e-9&&Math.max(s.x1,s.x2,s.y1,s.y2)<=2.77+1e-9),
    "Field beams must start at the visible emitter and stop inside the outer barrier");
console.log("Conveyor connection semantics and independent laser geometry passed.");
