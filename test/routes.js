"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path");
const {makeGame}=require("./game-fixture");
const {COURSE_CARDS,BOARD_FEATURES}=require("../data/catalog");
const types=["move1","move2","move3","backup","left","right","uturn"];
const card=type=>({id:type,type,label:type,priority:500});
const directions=["north","east","south","west"];
const signature=s=>`${s.x},${s.y},${s.direction},${s.phase}`;
async function transition(game,state,type){
    const robot=game.getRobot("runner"),player=game.players.runner;
    Object.assign(robot,{x:state.x,y:state.y,direction:state.direction,headingTurns:directions.indexOf(state.direction),destroyed:false,eliminated:false,withdrawn:false});
    Object.assign(player,{damage:0,lives:3,poweredDown:false,finished:false,lockedRegisters:[]});
    game.room.phase="resolving";game.room.register=state.phase+1;game.room.log=[];game.room.boardEvents=[];
    await game.executeCard(robot,card(type));
    game.moveConveyors(true);game.moveConveyors(false);game.activatePushers();game.activateGears();
    game.applyLaserHits(game.fireAllLasers());
    if(robot.destroyed||robot.eliminated||player.damage>0||robot.x===null)return null;
    return {x:robot.x,y:robot.y,direction:robot.direction,phase:(state.phase+1)%5};
}
async function leg(game,start,goal){
    const nodes=[{state:start,parent:-1,type:null}],seen=new Set([signature(start)]);
    for(let i=0;i<nodes.length;i++){
        const node=nodes[i];
        if(node.state.x===goal[0]&&node.state.y===goal[1]&&node.state.phase===0){
            const program=[];let cursor=i;while(nodes[cursor].parent>=0){program.push(nodes[cursor].type);cursor=nodes[cursor].parent;}
            return {program:program.reverse(),state:node.state};
        }
        for(const type of types){const next=await transition(game,node.state,type);if(!next)continue;const key=signature(next);if(seen.has(key))continue;seen.add(key);nodes.push({state:next,parent:i,type});}
    }
    throw Error(`No safe phased route to ${goal} on ${game.room.course.name}`);
}
async function plan(course,start){
    const g=makeGame(course,1);g.room.flags=[];
    let state={...start,direction:"north",phase:0},program=[];
    for(const flag of course.flags){const result=await leg(g,state,flag);program.push(...result.program);state=result.state;}
    return program;
}
async function replayRegisters(course,start,program){
    const g=makeGame(course,1);Object.assign(g.getRobot("runner"),start);g.room.phase="resolving";
    for(let i=0;i<program.length&&g.room.phase!=="finished";i++){
        const robot=g.getRobot("runner");g.room.register=i%5+1;
        if(i%5===0)g.players.runner.checkpointAvailable=g.players.runner.checkpoints+1;
        await g.executeCard(robot,card(program[i]));g.moveConveyors(true);g.moveConveyors(false);g.activatePushers();g.activateGears();g.applyLaserHits(g.fireAllLasers());g.touchCheckpoints();
        assert(!robot.destroyed&&g.players.runner.damage===0,`${course.name}: unsafe witness program`);
        if(i%5===4)g.cleanupRound();
    }
    assert.equal(g.room.winnerId,"runner",`${course.name}: phased program did not finish`);
}
async function fullMatch(course,program,count){
    const g=makeGame(course,count);
    // Other participants are valid, stationary recharging robots. Simultaneous
    // movement/collisions and competitive laser behavior have separate tests.
    g.startRound=()=>{};g.room.phase="programming";
    for(let offset=0;offset<program.length&&g.room.phase!=="finished";offset+=5){
        g.room.round++;g.players.runner.checkpointAvailable=g.players.runner.checkpoints+1;
        const cards=program.slice(offset,offset+5).map((type,i)=>({...card(type),id:`round-${offset}-${i}`}));
        g.players.runner.hand=cards;g.players.runner.selected=cards.map(c=>c.id);g.players.runner.locked=true;
        for(const id of g.room.playerSlots.slice(1)){g.players[id].poweredDown=true;g.players[id].locked=true;g.players[id].selected=Array(5).fill(null);}
        await g.resolveRound();
        assert(!g.getRobot("runner").destroyed,`${course.name}/${count}: runner was lost`);
        if(g.room.phase!=="finished")g.room.phase="programming";
    }
    assert.equal(g.room.winnerId,"runner",`${course.name}/${count}: full match did not finish`);
    const saved=JSON.parse(JSON.stringify(g.getSnapshot()));const restored=makeGame(course,count);restored.setSnapshot(saved);
    assert.equal(restored.room.winnerId,"runner");
    return g.room.round;
}
async function run(){
    const report=[];
    for(const course of COURSE_CARDS){
        const starts=BOARD_FEATURES[course.board].starts;
        const programs=[];
        for(let slot=0;slot<starts.length;slot++){
            const program=await plan(course,starts[slot]);await replayRegisters(course,starts[slot],program);programs.push(program);
        }
        const entry={course:course.id,allEightStartsFinishWithoutDamage:true,registers:programs.map(p=>p.length),program:programs[0]};
        if(["arena-02-a","arena-12-c"].includes(course.id)){
            entry.matches={};for(const count of [2,4,8])entry.matches[count]=await fullMatch(course,programs[0],count);
        }
        report.push(entry);console.log(`${course.name}: 8 safe phased routes; ${programs[0].length/5} planned rounds from start 1.`);
    }
    fs.mkdirSync(path.resolve(__dirname,"../artifacts"),{recursive:true});
    fs.writeFileSync(path.resolve(__dirname,"../artifacts/routes.json"),JSON.stringify(report,null,2));
    console.log("All courses finished through actual register phases; controlled 2/4/8-player matches passed.");
}
module.exports={plan,replayRegisters,transition,types};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
