"use strict";
// A lower bound from static geometry, alongside the separate phased engine run.
// It catches a nominally hard route that can collect its goals on empty floor.
const vectors={north:[0,-1],east:[1,0],south:[0,1],west:[-1,0]},opposite={north:"south",east:"west",south:"north",west:"east"};
function walkingProfile(features,start,flags){
    const walls=new Set(features.walls),pits=new Set(features.pits),devices=new Set([...features.lasers,...features.pushers].map(d=>`${d.x},${d.y}`));
    const mechanism=key=>Number(!!features.conveyors[key]||!!features.gears[key]||devices.has(key));
    const legs=[];let origin=[start.x,start.y];
    for(const goal of flags){
        const initial={x:origin[0],y:origin[1],contacts:0,steps:0},open=[initial],best=new Map([[origin.join(),initial]]);let result;
        while(open.length){
            open.sort((a,b)=>a.contacts-b.contacts||a.steps-b.steps);const node=open.shift();
            if(best.get(`${node.x},${node.y}`)!==node)continue;
            if(node.x===goal[0]&&node.y===goal[1]){result=node;break;}
            for(const[d,[dx,dy]]of Object.entries(vectors)){
                const x=node.x+dx,y=node.y+dy,key=`${x},${y}`;
                if(x<0||x>11||y<0||y>15||pits.has(key)||walls.has(`${node.x},${node.y},${d}`)||walls.has(`${key},${opposite[d]}`))continue;
                const next={x,y,contacts:node.contacts+mechanism(key),steps:node.steps+1},old=best.get(key);
                if(old&&(old.contacts<next.contacts||(old.contacts===next.contacts&&old.steps<=next.steps)))continue;
                best.set(key,next);open.push(next);
            }
        }
        if(!result)throw Error(`No geometric approach to ${goal}`);
        legs.push({contacts:result.contacts,steps:result.steps});origin=goal;
    }
    return {legs,contacts:legs.reduce((n,l)=>n+l.contacts,0),steps:legs.reduce((n,l)=>n+l.steps,0),afterFirst:legs.slice(1).reduce((n,l)=>n+l.contacts,0)};
}
module.exports={walkingProfile};
