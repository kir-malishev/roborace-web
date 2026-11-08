"use strict";

const assert = require("assert");
const init = require("../module");
let GameState;
class RoomState { constructor() { this.room = {}; } }
const registry = {RoomState, games: {roborace: {id: "test"}}, handleAppPage() {},
    createRoomManager(_path, Type) { GameState = Type; }};
init({app: {use() {}}, users: registry, static() { return () => {}; }}, "/field-editor-test");

function game() {
    const instance = new GameState("host", {}, {send() {}});
    instance.userRegistry = {send() {}};
    instance.room.playerSlots = ["host", "guest"];
    instance.room.playerNames = {host: "Host", guest: "Guest"};
    return instance;
}

const FieldFormat = require("../public/field-format");
function document(value) {
    return {format:"roborace-field",version:1,name:value.name || "Test field",
        features:{...value.features,starts:value.features.starts || FieldFormat.emptyGeometry().starts},
        routes:[{name:"Test route",flags:value.flags}],rotation:value.editorRotation || 0};
}

const blank = () => ({pits: [], repairs: [], gears: {}, conveyors: {}, express: [],
    hintConnections: [], conveyorConnections: [], walls: [], lasers: [], pushers: []});

{
    const instance = game();
    const features = blank();
    features.conveyors = {"2,2": "east", "3,2": "south"};
    features.conveyorConnections = ["2,2|3,2"];
    features.express = ["2,2"];
    features.pits = ["8,8", "8,9"];
    features.repairs = ["4,4"];
    features.gears = {"5,5": -1};
    features.lasers = [{x: 0, y: 4, direction: "east", count: 2}];
    features.pushers = [{x: 6, y: 6, direction: "north", active: [1,3,5]}];
    instance.userEvent("guest", "set-authored-course", [document({name: "Wrong host", start: init.START_CARDS[0],
        features, flags: [[7,7]]})]);
    assert.notEqual(instance.room.course.id, "authored", "non-host changed the field");
    instance.userEvent("host", "set-authored-course", [document({name: "New factory", start: init.START_CARDS[0],
        features, flags: [[7,7]]})]);
    assert.equal(instance.room.course.id, "authored");
    assert.equal(instance.room.course.board, "Custom");
    assert.equal(instance.features.conveyors["3,2"], "south");
    assert(instance.features.walls.has("0,4,west"), "laser did not acquire its mounting wall");
    assert(instance.features.walls.has("6,6,south"), "pusher did not acquire its mounting wall");
    assert.equal(instance.publicState().fieldFeatures.lasers[0].count, 2);
    instance.startGame();
    assert.equal(instance.room.phase, "programming");
    const robot = instance.getRobot("host");
    robot.x = 2; robot.y = 2; robot.direction = "north";
    instance.moveConveyors(false);
    assert.deepStrictEqual([robot.x,robot.y,robot.direction], [3,2,"east"],
        "edited conveyor route did not turn the robot after arrival");
    const snapshot = JSON.parse(JSON.stringify(instance.getSnapshot()));
    const restored = game();
    restored.setSnapshot(snapshot);
    assert.equal(restored.features.conveyors["3,2"], "south", "authored field was lost on restore");
    assert.equal(restored.room.course.customFeatures.pits.length, 2);
}

{
    const instance = game();
    const features = blank();
    features.repairs = ["4,4"];
    instance.userEvent("host", "set-authored-course", [document({start: init.START_CARDS[0],
        features, flags: [[4,4]]})]);
    assert.equal(instance.room.course.id, "authored", "flag on a repair tile was rejected");
    assert(instance.features.repairs.has("4,4"), "repair tile was lost beneath its flag");
}

{
    const instance = game();
    const features = blank();
    features.pits = ["1,1", "2,1"];
    features.walls = ["1,1,east", "2,1,west", "1,1,north", "2,1,east"];
    instance.userEvent("host", "set-authored-course", [document({start: init.START_CARDS[0],
        features, flags: [[7,7]]})]);
    assert.equal(instance.room.course.id, "authored", "field with an internal pit wall was rejected");
    assert(!instance.features.walls.has("1,1,east") && !instance.features.walls.has("2,1,west"),
        "internal pit walls were not removed");
    assert(instance.features.walls.has("1,1,north") && instance.features.walls.has("2,1,east"),
        "pit boundary walls were removed");
}

{
    const instance = game();
    const features = blank();
    features.conveyors = {"4,5": "east", "5,4": "south", "5,6": "north", "5,5": "east"};
    features.conveyorConnections = ["4,5|5,5", "5,4|5,5", "5,6|5,5"];
    instance.userEvent("host", "set-authored-course", [document({start: init.START_CARDS[0], features, flags: [[7,7]]})]);
    instance.startGame();
    const robot = instance.getRobot("host");
    for (const [x,y,direction] of [[4,5,"north"],[5,4,"west"],[5,6,"east"]]) {
        robot.x = x; robot.y = y; robot.direction = "north"; robot.destroyed = false;
        instance.moveConveyors(false);
        assert.deepStrictEqual([robot.x,robot.y,robot.direction], [5,5,direction],
            `robot arriving at three-way merge from ${x},${y} turned incorrectly`);
    }
}

{
    const instance = game();
    const unrelated = blank();
    unrelated.conveyors = {"4,5": "east", "5,5": "north"};
    instance.userEvent("host", "set-authored-course", [document({start: init.START_CARDS[0], features: unrelated, flags: [[7,7]]})]);
    const separate = instance.features;
    assert(!separate.conveyorConnections.has("4,5|5,5"),
        "touching conveyors were silently joined without a drawn route");
    instance.startGame();
    const robot = instance.getRobot("host");
    robot.x = 4; robot.y = 5; robot.direction = "north";
    instance.moveConveyors(false);
    assert.deepStrictEqual([robot.x,robot.y,robot.direction], [5,5,"north"],
        "touching but unconnected conveyors turned the robot");
}

{
    const instance = game();
    const bad = blank();
    bad.pits = ["12,0"];
    instance.userEvent("host", "set-authored-course", [document({start: init.START_CARDS[0], features: bad, flags: [[1,1]]})]);
    assert.notEqual(instance.room.course.id, "authored", "out-of-bounds feature was accepted");
    bad.pits = ["1,1"];
    instance.userEvent("host", "set-authored-course", [document({start: init.START_CARDS[0], features: bad, flags: [[1,1]]})]);
    assert.notEqual(instance.room.course.id, "authored", "flag inside pit was accepted");
    bad.pits = [];
    bad.lasers = [null];
    instance.userEvent("host", "set-authored-course", [document({start: init.START_CARDS[0], features: bad, flags: [[1,1]]})]);
    assert.notEqual(instance.room.course.id, "authored", "malformed laser was accepted");
}

{
    const instance = game();
    const start = init.START_CARDS[0];
    const layout = instance.publicState().startTemplates[start];
    const features = {...blank(), fullField: true, conveyors: {...layout.conveyors, "2,13": "east"},
        express: [...layout.express], walls: [...layout.walls], repairs: ["1,12"],
        lasers: [{x: 0, y: 11, direction: "south", count: 1}]};
    instance.userEvent("host", "set-authored-course", [document({start, editorRotation: 90,
        features, flags: [[1,12]]})]);
    assert.equal(instance.room.course.id, "authored", "edits on the start card were rejected");
    assert.equal(instance.room.course.editorRotation, 90);
    assert.equal(instance.publicState().fieldFeatures.conveyors["2,13"], "east");
    assert(instance.publicState().fieldFeatures.repairs.includes("1,12"));
    instance.startGame();
    const robot = instance.getRobot("host");
    robot.x = 0; robot.y = 13;
    assert.equal(instance.traceLaser(0,11,"south",true).target, robot,
        "factory laser stopped at the start-card boundary");
    robot.x = 2; robot.y = 13; robot.direction = "north";
    instance.moveConveyors(false);
    assert.deepStrictEqual([robot.x,robot.y], [3,13], "start-card conveyor did not move the robot");
    const restoredStart = game();
    restoredStart.setSnapshot(JSON.parse(JSON.stringify(instance.getSnapshot())));
    assert.equal(restoredStart.room.course.editorRotation, 90, "editor rotation metadata was lost on restore");
    assert(restoredStart.features.repairs.has("1,12"), "start-card edits were lost on restore");
    const invalid = game();
    invalid.userEvent("host", "set-authored-course", [document({start,
        features: {...features, pits: ["5,14"]}, flags: [[1,12]]})]);
    assert.notEqual(invalid.room.course.id, "authored", "a fixed starting cell was edited");
    const editableWall = game();
    editableWall.userEvent("host", "set-authored-course", [document({start,
        features: {...features, walls: features.walls.filter((wall) => wall !== "5,14,west")}, flags: [[1,12]]})]);
    assert.equal(editableWall.room.course.id, "authored", "a wall bordering a start number could not be removed");
}

{
    const instance = game();
    const blocked = blank();
    blocked.conveyors = {"1,1": "east", "2,1": "east"};
    blocked.conveyorConnections = ["1,1|2,1"];
    blocked.pushers = [{x: 2, y: 1, direction: "east", active: [1]}];
    instance.userEvent("host", "set-authored-course", [document({start: init.START_CARDS[0],
        features: blocked, flags: [[7,7]]})]);
    assert.notEqual(instance.room.course.id, "authored", "conveyor crossed a pusher mounting wall");
}

{
    const instance = game();
    const features = blank();
    features.pushers = [{x: 4, y: 4, direction: "north", active: [1,3,5]},
        {x: 4, y: 4, direction: "east", active: [3,4]}];
    instance.userEvent("host", "set-authored-course", [document({start: init.START_CARDS[0], features, flags: [[7,7]]})]);
    assert.notEqual(instance.room.course.id, "authored", "overlapping pushers on one cell were accepted");
    features.pushers[1].active = [2,4];
    instance.userEvent("host", "set-authored-course", [document({start: init.START_CARDS[0], features, flags: [[7,7]]})]);
    assert.equal(instance.room.course.id, "authored", "pushers with disjoint registers were rejected");
}

for (const board of Object.keys(init.BOARD_FEATURES)) {
    const instance = game();
    const template = instance.publicState().boardTemplates[board];
    instance.userEvent("host", "set-authored-course", [JSON.parse(JSON.stringify(template))]);
    assert.equal(instance.room.course.id, "authored", `standard template ${board} was rejected`);
    assert.deepStrictEqual(instance.room.course.flags,template.routes[0].flags,"selected route was ignored");
    const restored=game();restored.setSnapshot(JSON.parse(JSON.stringify(instance.getSnapshot())));
    assert.deepStrictEqual(restored.room.course.customFeatures.starts,template.features.starts,"start positions were lost on restore");
}

{
    const instance=game(),features=blank();
    features.starts=FieldFormat.emptyGeometry().starts;
    features.starts[0]={x:0,y:13};
    instance.userEvent("host","set-authored-course",[document({features,flags:[[7,7]]})]);
    instance.room.startAssignments={host:0,guest:1};
    instance.startGame();
    assert.deepStrictEqual([instance.getRobot("host").x,instance.getRobot("host").y],[0,13],"spawn used a preset instead of document geometry");
    const snapshot=JSON.parse(JSON.stringify(instance.getSnapshot()));
    const presets=require("../data/start").START_TEMPLATES,preset=presets[init.START_CARDS[0]],previous=preset.starts;
    try {
        preset.starts=previous.map(point=>({...point,y:12}));
        const restored=game();restored.setSnapshot(snapshot);
        assert.deepStrictEqual(restored.publicState().startPositions,features.starts,"preset changes altered a saved field");
    } finally {preset.starts=previous;}
}

console.log("Custom field validation, mechanics, clone and restore passed.");
