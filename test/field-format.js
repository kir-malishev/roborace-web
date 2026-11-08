"use strict";
const assert=require("assert"),fs=require("fs"),vm=require("vm");
const Field=require("../public/field-format"),{FIELDS}=require("../data/fields");
const clone=value=>JSON.parse(JSON.stringify(value));
const browser={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve("../public/field-format"),"utf8"),browser);
for(const source of FIELDS){
    const field=Field.read(clone(source));
    assert.equal(field.version,1);
    assert.deepStrictEqual(clone(browser.window.RaceField.read(clone(source))),field);
    assert.deepStrictEqual(Field.read(clone(field)),field,"JSON roundtrip changed geometry or routes");
    assert.equal(field.features.starts.length,8);
    assert(field.features.conveyors["1,14"],"catalog document omitted start geometry");
}
const edited=clone(FIELDS[0]);
edited.features.repairs.push("1,12");edited.features.conveyors["2,13"]="east";
const restored=Field.read(clone(edited));
assert(restored.features.repairs.includes("1,12"));
assert.equal(restored.features.conveyors["2,13"],"east");
// Explicitly detached belts at the join must stay detached after serialization.
edited.features.conveyors["4,11"]="east";
edited.features.conveyorConnections=edited.features.conveyorConnections.filter(link=>link!=="4,12|4,11");
assert(!Field.read(clone(edited)).features.conveyorConnections.includes("4,12|4,11"));
for(const mutate of [
    doc=>{doc.version=2;},
    doc=>{doc.features.pits.push("12,0");},
    doc=>{doc.features.starts[0].y=16;},
    doc=>{doc.routes[0].flags=[[5,1]];},
    doc=>{doc.routes[0].flags=[[5,14]];},
    doc=>{doc.features.conveyorConnections.push("1,2|10,10");}
]){const bad=clone(FIELDS[0]);mutate(bad);assert.throws(()=>Field.read(bad));}
console.log("Full field documents: browser/server parity, catalog roundtrips, start edits and invalid inputs passed.");
