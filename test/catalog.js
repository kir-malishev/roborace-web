"use strict";
const assert=require("assert");
const {BOARD_FEATURES,COURSE_CARDS,START_CARDS}=require("../data/catalog");
const vectors={north:[0,-1],east:[1,0],south:[0,1],west:[-1,0]},opposite={north:"south",east:"west",south:"north",west:"east"};
assert.equal(Object.keys(BOARD_FEATURES).length,11);assert.equal(COURSE_CARDS.length,33);assert.equal(START_CARDS.length,1);
const starts=BOARD_FEATURES[COURSE_CARDS[0].board].starts;
assert.deepStrictEqual(starts.map(p=>p.x),[5,6,4,7,3,8,2,9]);
for(const [name,f] of Object.entries(BOARD_FEATURES)){
    assert.equal(COURSE_CARDS.filter(c=>c.board===name).length,3);assert(f.lasers.length>0);
    for(const key of [...f.pits,...f.repairs,...Object.keys(f.conveyors),...Object.keys(f.gears)]){
        const [x,y]=key.split(",").map(Number);assert(x>=0&&x<12&&y>=0&&y<16,`${name}: out-of-bounds cell`);
    }
    for(const key of [...f.repairs,...Object.keys(f.conveyors),...Object.keys(f.gears)])assert(!f.pits.has(key),`${name}: element in a pit`);
    for(const key of f.express)assert(f.conveyors[key],`${name}: express without a lane`);
    for(const device of [...f.lasers,...f.pushers])assert(f.walls.has(`${device.x},${device.y},${opposite[device.direction]}`),`${name}: missing device mount`);
    for(const link of f.conveyorConnections){const [from,to]=link.split("|");const [x,y]=from.split(",").map(Number),[dx,dy]=vectors[f.conveyors[from]];assert.equal(to,`${x+dx},${y+dy}`);assert(f.conveyors[to]);assert(!f.walls.has(`${from},${f.conveyors[from]}`));assert(!f.walls.has(`${to},${opposite[f.conveyors[from]]}`));}
    for(const c of COURSE_CARDS.filter(c=>c.board===name)){
        assert.equal(c.min,2);assert.equal(c.max,8);assert(!Object.hasOwn(c,"specialRules"));
        assert(c.flags.length<=4);assert(!Object.hasOwn(c,"group"));assert(!Object.hasOwn(c,"description"));
        assert.equal(new Set(c.flags.map(p=>p.join(","))).size,c.flags.length);
        for(const p of c.flags)assert(!f.pits.has(p.join(","))&&!f.conveyors[p.join(",")],`${c.name}: checkpoint must be on stable floor`);
    }
}
const {FIELDS}=require("../data/fields");
for(const field of FIELDS)assert.deepStrictEqual(require("../public/field-format").geometry(BOARD_FEATURES[field.name]),require("../data/catalog").FIELD_DOCUMENTS[field.name].features,"runtime geometry must match the field document");
const pad=BOARD_FEATURES[COURSE_CARDS[0].board];
assert.equal(Object.keys(pad.conveyors).filter(key=>Number(key.split(",")[1])>=12).length,16);
for(const p of starts)assert(!pad.conveyors[`${p.x},${p.y}`],"starting grid must stay clear");
// Restoring a lobby must not bring back stale course coordinates alongside new art.
const {makeGame}=require("./game-fixture");
const g=makeGame(),snapshot=JSON.parse(JSON.stringify(g.getSnapshot()));
for(const rotation of [90,180,270]){
    const rotated=makeGame({...COURSE_CARDS[0],rotation}).features;
    assert.deepStrictEqual(rotated.starts,starts,"rotating the factory moved the starting grid");
    assert.equal(rotated.conveyors["1,14"],"north","rotating the factory changed a start conveyor");
    assert(rotated.walls.has("0,15,south"),"rotating the factory moved a start boundary");
}
snapshot.room.phase="lobby";snapshot.room.course={...snapshot.room.course,flags:[[0,2]]};
snapshot.room.courses=[snapshot.room.course];snapshot.room.boardImages={obsolete:"missing"};
g.setSnapshot(snapshot);
assert.deepStrictEqual(g.room.course.flags,COURSE_CARDS[0].flags);
assert.equal(g.room.courses.length,33);
assert.equal(g.room.boardImages[g.room.course.board],require("../data/catalog").BOARD_IMAGES[g.room.course.board]);
assert(g.publicState().boardTemplates[g.room.course.board]);
snapshot.room.phase="programming";snapshot.room.course={id:"retired-course",board:"retired-board",start:START_CARDS[0]};
g.setSnapshot(snapshot);assert.equal(g.room.phase,"lobby");assert.equal(g.room.course.id,COURSE_CARDS[0].id);assert.equal(g.room.robots.length,0);
const fresh=makeGame(COURSE_CARDS[32]),running=JSON.parse(JSON.stringify(fresh.getSnapshot()));running.room.phase="programming";
fresh.setSnapshot(running);assert.equal(fresh.room.phase,"programming");assert.equal(fresh.room.course.id,COURSE_CARDS[32].id);
console.log("Eleven reviewed fields, 33 routes, launch geometry, retired-field migration and new-game restore passed.");
