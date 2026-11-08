"use strict";
const init=require("../module");
let GameState;
class RoomState {constructor(){this.room={};} emit(){} }
const registry={RoomState,handleAppPage(){},createRoomManager(path,Type){GameState=Type},send(){},log(){}};
init({app:{use(){}},users:registry,static(){return()=>{}}},"/fixture");
function makeGame(course=init.COURSE_CARDS[0],count=2){
    const g=new GameState("runner",{},{send(){}});
    g.userRegistry={send(){}};g.registry=registry;g.room.course=course;
    g.room.board={name:course.board,start:course.start,size:12};
    g.room.flags=course.flags.map(([x,y],i)=>({x,y,homeX:x,homeY:y,number:i+1}));
    g.room.playerSlots=Array.from({length:count},(_,i)=>i?`parked-${i}`:"runner");
    g.room.playerNames=Object.fromEntries(g.room.playerSlots.map(id=>[id,id]));
    g.room.startAssignments=Object.fromEntries(g.room.playerSlots.map((id,i)=>[id,i]));
    const starts=g.features.starts;
    g.room.robots=g.room.playerSlots.map((userId,slot)=>({userId,slot,...starts[slot],direction:"north",headingTurns:0,color:"#63d6c5",archive:{...starts[slot]},eliminated:false,destroyed:false}));
    g.players=Object.fromEntries(g.room.playerSlots.map((id,i)=>[id,{hand:[],selected:Array(5).fill(null),registers:[],lockedRegisters:[],autoFilledRegisters:[],locked:true,
        damage:i?1:0,lives:3,checkpoints:0,checkpointAvailable:1,poweredDown:!!i,powerDownIntent:false,powerDownNextRound:false,powerDownDamage:0}]));
    g.deck=[];g.discard=[];g.destructionCounter=0;g.boardEventCounter=0;
    g.showStage=async()=>{};g.update=()=>{};g.addLog=()=>{};
    return g;
}
module.exports={makeGame,GameState};
