"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path");
const {FIELDS}=require("../data/fields");
const {BOARD_FEATURES,COURSE_CARDS}=require("../data/catalog");
const {makeGame}=require("./game-fixture");
const {transition,types}=require("./routes");
const {walkingProfile}=require("./route-profile");
const vectors={north:[0,-1],east:[1,0],south:[0,1],west:[-1,0]},opposite={north:"south",east:"west",south:"north",west:"east"};
function walkAccess(f,start){
    const seen=new Set([`${start.x},${start.y}`]),queue=[[start.x,start.y]],walls=new Set(f.walls);
    for(let i=0;i<queue.length;i++)for(const [d,[dx,dy]]of Object.entries(vectors)){
        const [x,y]=queue[i],nx=x+dx,ny=y+dy,key=`${nx},${ny}`;
        if(nx<0||nx>11||ny<0||ny>15||seen.has(key)||f.pits.includes(key)||walls.has(`${x},${y},${d}`)||walls.has(`${key},${opposite[d]}`))continue;
        seen.add(key);queue.push([nx,ny]);
    }
    return seen;
}
async function auditOrdinaryFloor(course,features,starts){
    const game=makeGame(course,1);game.room.flags=[];
    const signature=s=>`${s.x},${s.y},${s.direction},${s.phase}`;
    const states=starts.map(start=>({...start,direction:"north",phase:0})),indices=new Map(states.map((s,i)=>[signature(s),i])),reverse=states.map(()=>[]);
    for(let i=0;i<states.length;i++)for(const type of types){
        const next=await transition(game,states[i],type);if(!next)continue;
        const key=signature(next);let index=indices.get(key);
        if(index===undefined){index=states.length;indices.set(key,index);states.push(next);reverse.push([]);}
        reverse[index].push(i);
    }
    // A reachable cell must also permit leaving the transport system again.
    const exits=states.flatMap((s,i)=>s.y>=12?[i]:[]),canExit=new Set(exits);
    for(let i=0;i<exits.length;i++)for(const previous of reverse[exits[i]])if(!canExit.has(previous)){canExit.add(previous);exits.push(previous);}
    const usable=new Set(states.flatMap((s,i)=>s.phase===0&&canExit.has(i)?[`${s.x},${s.y}`]:[]));
    const robot=game.getRobot("runner"),pushers=new Set(features.pushers.map(d=>`${d.x},${d.y}`));let cells=0;
    for(let y=0;y<12;y++)for(let x=0;x<12;x++){
        const key=`${x},${y}`;
        if(features.pits.has(key)||features.conveyors[key]||pushers.has(key))continue;
        Object.assign(robot,{x,y,destroyed:false,eliminated:false,withdrawn:false});
        if(game.fireAllLasers().some(hit=>hit.userId==="runner"))continue;
        assert(usable.has(key),`${course.name}: floor ${key} cannot be reached at round end and safely exited`);cells++;
    }
    return {safeOrdinaryCells:cells,reachablePhaseStates:states.length};
}

(async()=>{
    const report=[];
    for(const field of FIELDS){
        const f=BOARD_FEATURES[field.name],course=COURSE_CARDS.find(c=>c.board===field.name);
        const starts=f.starts;
        const plain=makeGame(course).publicState().boardTemplates[field.name].features;
        const fullGeometry=plain;
        const profiles=field.routes.map(route=>walkingProfile(fullGeometry,starts[0],route.flags));
        assert(profiles[0].contacts<profiles[1].contacts&&profiles[1].contacts<profiles[2].contacts,field.name+": difficulty order must increase mandatory mechanical contacts");
        assert(profiles[2].afterFirst>0,field.name+": hard route is an empty-floor walk after its first goal");
        const walkFeatures=plain;
        for(const start of starts){
            const seen=walkAccess(walkFeatures,start);
            for(let y=0;y<12;y++)for(let x=0;x<12;x++){
                const key=x+","+y;
                assert(f.pits.has(key)||seen.has(key),field.name+": isolated floor "+key);
                if(f.pits.has(key))continue;
                const exits=Object.entries(vectors).filter(([d,[dx,dy]])=>{
                    const nx=x+dx,ny=y+dy,to=nx+","+ny;
                    return nx>=0&&nx<12&&ny>=0&&ny<16&&!f.pits.has(to)&&!f.walls.has(key+","+d)&&!f.walls.has(to+","+opposite[d]);
                });
                assert(exits.length>=2,field.name+": blind one-cell pocket at "+key);
            }
        }
        const floorAudit=await auditOrdinaryFloor(course,f,starts);
        report.push({id:field.id,name:field.name,walkAccessFromAllEightStarts:true,profiles,floorAudit});
        console.log(field.name+": difficulty, connected floor and "+floorAudit.safeOrdinaryCells+" safely reachable ordinary cells passed.");
    }
    fs.mkdirSync(path.resolve(__dirname,"../artifacts"),{recursive:true});
    fs.writeFileSync(path.resolve(__dirname,"../artifacts/field-checks.json"),JSON.stringify(report,null,2)+"\n");
})().catch(error=>{console.error(error);process.exitCode=1;});
