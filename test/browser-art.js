"use strict";
const assert=require("assert"),path=require("path");
const art=require("../public/arena-art"),{launchBrowser,screenshot}=require("./browser-support");
const directions=["north","east","south","west"],opposite={north:"south",east:"west",south:"north",west:"east"};
const f={conveyors:{},express:[],conveyorConnections:[],walls:[],gears:{},pushers:[],pits:[]};
function addFlow(slot,conveyors,links,express,turns=0){
    const rotate=key=>{let[x,y]=key.split(",").map(Number);for(let i=0;i<turns;i++)[x,y]=[2-y,x];return `${x+(slot%4)*3},${y+Math.floor(slot/4)*3}`;};
    for(const[key,d]of Object.entries(conveyors)){const cell=rotate(key);f.conveyors[cell]=directions[(directions.indexOf(d)+turns)%4];if(express)f.express.push(cell);}
    for(const link of links)f.conveyorConnections.push(link.split("|").map(rotate).join("|"));
}
for(let turn=0;turn<4;turn++)addFlow(turn,{"1,2":"north","1,1":"east","2,1":"east"},["1,2|1,1","1,1|2,1"],true,turn);
addFlow(4,{"0,1":"east","1,2":"north","1,1":"north","1,0":"north"},["0,1|1,1","1,2|1,1","1,1|1,0"],true);
const triple={"0,1":"east","2,1":"west","1,2":"north","1,1":"north","1,0":"north"},links=["0,1|1,1","2,1|1,1","1,2|1,1","1,1|1,0"];
addFlow(5,triple,links,true);addFlow(6,triple,links,false,1);addFlow(7,triple,["1,1|1,0"],true);
for(let i=0;i<4;i++){const x=i*3+1,y=7;f.pushers.push({x,y,direction:directions[i],active:[1,3,5]});f.walls.push(`${x},${y},${opposite[directions[i]]}`);}
f.gears["1,10"]=1;f.gears["4,10"]=-1;f.walls.push("7,10,east","7,10,south","9,9,south");f.pits.push("10,10","11,10","10,11");
(async()=>{
    let browser;
    try{
        browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1200,height:1200}});
        const svg=art.render(f,{rows:12,columns:12,id:"proof",beams:false});
        await page.setContent(`<style>body{margin:0}svg{display:block;width:1200px;height:1200px}</style>${svg}`);
        const markingBounds=await page.locator(".race-belt-markings").evaluateAll(nodes=>nodes.map(el=>{const b=el.getBBox();return {x:b.x,y:b.y,right:b.x+b.width,bottom:b.y+b.height};}));
        assert(markingBounds.every(b=>b.x>=0&&b.y>=0&&b.right<=100&&b.bottom<=100),"conveyor markings leave their tile");
        const gearRadii=await page.locator(".race-gear-arrow path").evaluateAll(nodes=>nodes.map(p=>{
            let max=0;for(let i=0;i<=100;i++){const q=p.getPointAtLength(p.getTotalLength()*i/100);max=Math.max(max,Math.hypot(q.x,q.y));}
            return max+parseFloat(getComputedStyle(p).strokeWidth)/2;
        }));
        assert(gearRadii.every(r=>r<30),"gear arrow touches the inner rim");
        assert.notEqual(await page.locator(".race-gear-cw .race-gear-arrow").getAttribute("fill"),await page.locator(".race-gear-ccw .race-gear-arrow").getAttribute("fill"));
        const dir=path.resolve(__dirname,"../artifacts");
        await screenshot(page,{path:path.join(dir,"art-review.png")});
        const proof={pushers:[],walls:[]},patterns=[[1,3,5],[2,4],[5,4,3,2,1]];
        for(const[y,active]of patterns.entries())for(const[x,direction]of directions.entries()){
            proof.pushers.push({x,y,direction,active});proof.walls.push(`${x},${y},${opposite[direction]}`);
        }
        await page.setContent(`<style>body{margin:0}svg{display:block;width:800px;height:600px}</style>${art.render(proof,{rows:3,columns:4,id:"pusher-proof"})}`);
        const schedules=await page.locator(".race-pusher").evaluateAll(nodes=>nodes.map(p=>{
            const badge=p.querySelector(".race-pusher-schedule"),plate=badge.querySelector("rect"),texts=[...badge.querySelectorAll("text")];
            const origin=new DOMPoint(0,0).matrixTransform(badge.getCTM()).matrixTransform(p.getCTM().inverse()),x=origin.x,y=origin.y;
            const facing=p.dataset.direction,vertical=facing==="east"||facing==="west",bounds=plate.getBoundingClientRect(),positions=texts.map(t=>t.getBoundingClientRect());
            const distance={north:100-y,south:y,east:x,west:100-x}[facing];
            return {distance,boundaryMount:p.dataset.boundaryMount==="true",center:vertical?y:x,vertical,shapeVertical:bounds.height>bounds.width,
                digits:texts.map(t=>t.textContent).join(""),
                upright:texts.every(t=>{const m=t.getCTM();return m.a>0&&m.d>0&&Math.abs(m.b)<.01&&Math.abs(m.c)<.01;}),
                contained:positions.every(b=>b.left>=bounds.left-.1&&b.right<=bounds.right+.1&&b.top>=bounds.top-.1&&b.bottom<=bounds.bottom+.1),
                ordered:positions.every((b,i)=>!i||(vertical?b.top>positions[i-1].bottom:b.left>positions[i-1].right))};
        }));
        assert.equal(schedules.length,12);
        await screenshot(page,{path:path.join(dir,"pushers-review.png"),clip:{x:0,y:0,width:800,height:600}});
        for(const[i,s]of schedules.entries()){
            assert(Math.abs(s.distance-(s.boundaryMount?35:15))<.1,"phase plate must hug the visible inside of its mounting wall for every facing");
            assert(Math.abs(s.center-50)<.1&&s.vertical===s.shapeVertical,"phase plate must follow the wall");
            assert(s.upright&&s.ordered&&s.contained,`digits must stay upright, ordered and inside the phase plate: ${i} ${JSON.stringify(s)}`);
            assert.equal(s.digits,["135","24","12345"][Math.floor(i/4)]);
        }
        const elements={gears:{"0,0":1,"0,1":1},conveyors:{"1,0":"east","1,1":"east"},express:["1,0","1,1"],repairs:["4,0","4,1"],pushers:[0,1].map(y=>({x:2,y,direction:"north",active:[1,3,5]})),lasers:[0,1].map(y=>({x:3,y,direction:"east",count:1})),walls:["2,0,south","2,1,south","3,0,west","3,1,west"]};
        const markers=Array.from({length:5},(_,x)=>`<g class="proof-flag" transform="translate(${x*100} 100)">${art.checkpointMarkup(x+1)}</g>`).join("");
        const elementProof=art.render(elements,{columns:5,rows:2,id:"flag-proof",beams:false}).replace("</svg>",markers+"</svg>");
        await page.setContent(`<style>body{margin:0}svg{display:block;width:1000px;height:400px}</style>${elementProof}`);
        assert.equal(await page.locator(".proof-flag").count(),5);
        const badgeBounds=await page.locator(".proof-flag").evaluateAll(nodes=>nodes.map(n=>{
            const text=n.querySelector(".race-checkpoint-number"),style=getComputedStyle(text),ctx=document.createElement("canvas").getContext("2d");
            ctx.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const m=ctx.measureText(text.textContent),stroke=parseFloat(style.strokeWidth)/2;
            const b={x:Number(text.getAttribute("x"))-m.width/2-m.actualBoundingBoxLeft-stroke,
                y:Number(text.getAttribute("y"))-m.actualBoundingBoxAscent-stroke,
                width:m.actualBoundingBoxLeft+m.actualBoundingBoxRight+stroke*2,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent+stroke*2};
            const p=n.querySelector(".race-checkpoint-repair"),r=p.getBBox();
            const local=(x,y)=>new DOMPoint(x,y).matrixTransform(p.getCTM()).matrixTransform(n.getCTM().inverse());
            const top=local(r.x,r.y),bottom=local(r.x+r.width,r.y+r.height);
            return {x:b.x,y:b.y,w:b.width,h:b.height,open:[...n.querySelectorAll(".race-checkpoint > path")].every(el=>el.getAttribute("fill")==="none"),repair:{x:top.x,y:top.y,w:bottom.x-top.x,h:bottom.y-top.y},alpha:[...p.querySelectorAll('path[fill-opacity]')].map(el=>Number(el.getAttribute("fill-opacity")))};
        }));
        assert(badgeBounds.every(b=>b.open&&b.x>=54&&b.y>=9&&b.x+b.w<=90&&b.y+b.h<b.repair.y&&b.h>=35),"outlined corner numbers must stay inside the frame and preserve the mechanism's centre");
        assert(badgeBounds.every(b=>b.repair.x>=54&&b.repair.y>=54&&b.repair.w<=37&&b.repair.h<=37&&b.repair.x+b.repair.w<=90&&b.repair.y+b.repair.h<=90&&b.y+b.h<b.repair.y),"repair icons must fit inside the frame without overlapping the number");
        assert(await page.locator(".proof-flag .race-checkpoint").evaluateAll(nodes=>nodes.every(n=>Number(n.getAttribute("opacity"))>0&&Number(n.getAttribute("opacity"))<1)),"checkpoint artwork must remain slightly transparent");
        assert(badgeBounds.every(b=>b.alpha.length===2&&b.alpha.every(a=>a===.25)),"repair icon backings must remain translucent");
        assert.deepStrictEqual(await page.locator(".proof-flag .race-checkpoint-repair path").first().getAttribute("d"),await page.locator(".race-repair path").first().getAttribute("d"),"checkpoint repair must reuse the full repair-cell silhouette");
        await screenshot(page,{path:path.join(dir,"flags-on-elements-review.png"),clip:{x:0,y:0,width:1000,height:400}});
        const borderProof={walls:["0,0,north","0,0,west","2,2,east","2,2,south"],starts:[{x:1,y:1,slot:1}]};
        await page.setContent(`<style>body{margin:0}svg{display:block;width:600px;height:600px}</style>${art.render(borderProof,{rows:3,columns:3,id:"border-proof"})}`);
        const borders=await page.locator(".race-wall").evaluateAll(nodes=>nodes.map(n=>{
            const b=n.getBBox(),m=n.getCTM(),root=n.ownerSVGElement.getCTM().inverse();
            return [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(m).matrixTransform(root);return [p.x,p.y];});
        }));
        assert(borders.flat().every(([x,y])=>x>=0&&y>=0&&x<=300&&y<=300),"all outer walls must fit inside the image, including the bottom and right rims");
        assert(await page.locator(".race-start path").evaluateAll(nodes=>nodes.every(n=>n.getAttribute("fill")==="none")),"start slots must be painted floor markings without solid token backings");
        await screenshot(page,{path:path.join(dir,"outer-walls-and-start.png"),clip:{x:0,y:0,width:600,height:600}});
        const edgeProof={walls:[],pits:["1,0","1,7","0,1","7,1","7,3"],conveyors:{"2,0":"north","2,7":"south","0,2":"west","7,2":"east","3,0":"north"},
            gears:{"0,0":1},lasers:[{x:4,y:0,direction:"south",count:1},{x:4,y:7,direction:"north",count:2},{x:0,y:4,direction:"east",count:3},{x:7,y:4,direction:"west",count:1},{x:4,y:4,direction:"east",count:1}],
            pushers:[{x:6,y:0,direction:"south",active:[1,3,5]},{x:6,y:7,direction:"north",active:[2,4]},{x:0,y:6,direction:"east",active:[1,2,3,4,5]},{x:7,y:6,direction:"west",active:[1,2,3,4,5]}]};
        for(let i=0;i<8;i++){
            if(i!==3)edgeProof.walls.push(`${i},0,north`, `7,${i},east`);
            edgeProof.walls.push(`${i},7,south`,`0,${i},west`);
        }
        edgeProof.walls.push("3,4,east");
        const beamMarkup=art.laserSegments(edgeProof,{rows:8,columns:8}).map(s=>`<path d="M${s.x1*100} ${s.y1*100}L${s.x2*100} ${s.y2*100}" fill="none" stroke="#f58a88" stroke-width="2"/>`).join("");
        const edgeSvg=art.render(edgeProof,{rows:8,columns:8,id:"edge-terrain",beams:false})
            .replace("</svg>",`<g class="proof-upper-beams">${beamMarkup}</g></svg>`);
        await page.setContent(`<style>body{margin:0}svg{display:block;width:800px;height:800px}</style>${edgeSvg}`);
        const covered=await page.evaluate(()=>{
            const hit=(x,y)=>Boolean(document.elementFromPoint(x,y)?.closest(".race-outer-walls"));
            return Array.from({length:8},(_,i)=>({north:hit(i*100+50,.5),south:hit(i*100+50,799.5),west:hit(.5,i*100+50),east:hit(799.5,i*100+50)}));
        });
        assert(covered.every((edge,i)=>edge.south&&edge.west&&edge.north===(i!==3)&&edge.east===(i!==3)),
            "Terrain, pit teeth or device backs show outside the perimeter wall: "+JSON.stringify(covered));
        const outerPlates=await page.locator('.race-pusher[data-boundary-mount="true"] .race-pusher-schedule').evaluateAll(nodes=>nodes.map(n=>{
            const b=n.getBoundingClientRect();
            const texts=[...n.querySelectorAll("text")].map(t=>t.getBoundingClientRect());
            const origin=new DOMPoint(0,0).matrixTransform(n.getCTM()),direction=n.closest(".race-pusher").dataset.direction;
            const distance={south:origin.y,north:800-origin.y,east:origin.x,west:800-origin.x}[direction];
            return {distance,inside:texts.every(t=>t.left>=b.left&&t.right<=b.right&&t.top>=b.top&&t.bottom<=b.bottom)};
        }));
        assert(outerPlates.length===4&&outerPlates.every(p=>p.inside&&p.distance===35),"Boundary walls cover pusher schedules");
        assert(await page.evaluate(()=>Boolean(document.elementFromPoint(413,430)?.closest(".race-laser-source"))),
            "Interior mounting walls cover the source housing");
        await screenshot(page,{path:path.join(dir,"outer-wall-terrain-review.png"),clip:{x:0,y:0,width:800,height:800}});
        console.log("Conveyor art, flag markers, pusher schedules and clean perimeter walls over pits, belts and devices on all four sides passed.");
    }finally{if(browser)await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
