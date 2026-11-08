"use strict";
const assert=require("assert"),path=require("path");
const {launchBrowser,openUser,startSandbox,stopSandbox,screenshot}=require("./browser-support");
const {makeGame}=require("./game-fixture");
const port=process.env.GUIDE_BROWSER_PORT||"3094";
const artifacts=path.resolve(__dirname,"../artifacts");
const near=(actual,expected,message)=>assert(Math.abs(actual-expected)<.1,`${message}: ${actual} != ${expected}`);

// Seek only when checking authored scene poses. Playback controls are checked
// separately on a newly opened example without modifying its animation clock.
async function sample(locator,progress,selectors){
    return locator.evaluate(async(element,{progress,selectors})=>{
        const animations=element.getAnimations({subtree:true});
        animations.forEach(animation=>animation.pause());
        await Promise.all(animations.map(animation=>animation.ready));
        animations.forEach(animation=>animation.currentTime=Number(animation.effect.getTiming().duration)*progress);
        await new Promise(requestAnimationFrame);
        return selectors.map(selector=>{
            const node=element.querySelector(selector),style=getComputedStyle(node),m=new DOMMatrix(style.transform);
            return {x:m.e,y:m.f,a:m.a,b:m.b,opacity:Number(style.opacity)};
        });
    },{progress,selectors});
}

async function checkPlayback(dialog,selector){
    const page=dialog.page(),scene=dialog.locator(selector);
    const running=()=>page.waitForFunction(selector=>{
        const animations=document.querySelector(selector).getAnimations({subtree:true});
        return animations.length>0&&animations.every(animation=>animation.playState==="running"&&animation.currentTime>300);
    },selector,{timeout:4000});
    const pausedTimes=()=>scene.evaluate(async element=>{
        const animations=element.getAnimations({subtree:true});
        await Promise.all(animations.map(animation=>animation.ready));
        return animations.map(animation=>({time:animation.currentTime,paused:animation.playState==="paused"}));
    });
    await running();
    await dialog.getByRole("button",{name:"Пауза",exact:true}).click();
    const paused=await pausedTimes();
    assert(paused.length>0&&paused.every(animation=>animation.paused),"Pause did not stop the running animations");
    await page.waitForTimeout(150);
    assert.deepStrictEqual(await pausedTimes(),paused,"Paused animation kept advancing");
    await dialog.getByRole("button",{name:"Сначала",exact:true}).click();
    const restarted=await pausedTimes();
    assert(restarted.length>0&&restarted.every(animation=>animation.paused&&animation.time<50),"Replay did not rewind the paused example");
    await dialog.getByRole("button",{name:"Продолжить",exact:true}).click();
    await running();
}

async function engineExample(kind){
    const cells=kind==="wall"?[[3,2,"east"]]:kind==="chain"?[[1,2,"east"],[2,2,"north"],[3,2,"south"]]
        :kind==="headon"?[[1,2,"east"],[2,2,"west"]]:[[1,2,"east"],[2,3,"north"]];
    const game=makeGame(undefined,cells.length);
    game.room.course={...game.room.course,customFeatures:{fullField:true,pits:[],repairs:[],gears:{},
        conveyors:{},express:[],walls:kind==="wall"?["3,2,east"]:[],lasers:[],pushers:[]}};
    game.room.robots.forEach((robot,index)=>Object.assign(robot,{x:cells[index][0],y:cells[index][1],direction:cells[index][2]}));
    const snapshot=()=>game.room.robots.map(robot=>({x:robot.x*60+30,y:robot.y*60+30,direction:robot.direction}));
    const initial=snapshot();
    const commands=[{robot:0,steps:1,priority:570}];
    if(["priority","passing","headon"].includes(kind))commands.push({robot:1,steps:kind==="passing"?2:1,priority:kind==="passing"?680:490});
    const execute=command=>game.executeCard(game.room.robots[command.robot],{type:`move${command.steps}`,label:"Forward",priority:command.priority});
    commands.sort((left,right)=>right.priority-left.priority);
    await execute(commands[0]);
    const first=snapshot();
    if(commands[1])await execute(commands[1]);
    const final=snapshot();
    if(kind==="passing")assert(!game.room.boardEvents.some(event=>event.type==="push"),"Passing example must have no collisions");
    if(kind==="headon")assert.deepStrictEqual(final,initial,"Facing robots must return to their starting cells");
    if(kind==="wall")assert.deepStrictEqual(final,initial,"The single robot must stop at the wall");
    return {initial,first,final};
}

async function engineConveyor(steps){
    const game=makeGame(undefined,1),robot=game.room.robots[0];
    game.room.course={...game.room.course,customFeatures:{fullField:true,pits:[],repairs:[],gears:{},
        conveyors:{"1,2":"north","1,1":"east","2,1":"east"},express:[],walls:[],lasers:[],pushers:[]}};
    Object.assign(robot,{x:1,y:3,direction:"north",headingTurns:0});
    const snapshot=()=>({x:robot.x*100+50,y:robot.y*100+50,direction:robot.direction});
    await game.executeCard(robot,{type:`move${steps}`,label:"Forward",priority:steps===1?570:680});
    const card=snapshot();game.moveConveyors(false);
    return {card,belt:snapshot()};
}

(async()=>{
    const sandbox=startSandbox(port);let browser;
    try{
        await sandbox.ready;browser=await launchBrowser();
        const host=(await openUser(browser,{port,room:"guide-browser",name:"Host",viewport:{width:1440,height:1000}})).page;
        const errors=[];host.on("pageerror",error=>errors.push(error.message));
        await host.getByRole("button",{name:"Как играть",exact:true}).click();
        const guide=host.getByRole("dialog",{name:"Как играть в RoboRace"});
        const flags=guide.locator(".rr-guide-example");
        const samples=[{progress:.3,x:140,checks:[1,0,0]},{progress:.6,x:250,checks:[1,1,0]},
            {progress:.9,x:360,checks:[1,1,1]}];
        for(const expected of samples){
            const [robot,...checks]=await sample(flags,expected.progress,[".rr-example-flag-robot",...Array.from({length:3},(_,i)=>`.rr-example-collected-${i+1}`)]);
            near(robot.x,expected.x,"flag stop");near(robot.y,60,"flag row");
            assert.deepStrictEqual(checks.map(check=>check.opacity),expected.checks,"Flags must count one at a time");
        }
        await screenshot(host,{path:path.join(artifacts,"guide-how-wide.png")});
        await guide.getByRole("tab",{name:"Элементы поля"}).click();
        await host.waitForFunction(()=>{const images=[...document.querySelectorAll(".guide-element-visual img")];return images.length>0&&images.every(img=>img.complete&&img.naturalWidth);});
        await screenshot(host,{path:path.join(artifacts,"guide-elements-wide.png")});
        await guide.getByRole("tab",{name:"Урон и Перезагрузка"}).click();
        await host.keyboard.press("Escape");
        assert.equal(await host.getByRole("button",{name:"Как играть",exact:true}).evaluate(button=>button===document.activeElement),true);

        const guest=(await openUser(browser,{port,room:"guide-browser",name:"Guest"})).page;
        await host.getByRole("button",{name:"Присоединиться к игре"}).click();
        await guest.getByRole("button",{name:"Присоединиться к игре"}).click();
        await host.getByRole("button",{name:"Начать игру"}).click();
        await host.locator(".program .card").first().waitFor();
        const side=host.locator(".game-side-hud"),scroll=side.locator(".dock-scroll");
        const size=()=>side.locator(".rr-player-registers").first().evaluate(element=>({width:element.getBoundingClientRect().width,left:element.getBoundingClientRect().left}));
        await scroll.evaluate(element=>element.style.maxHeight=`${element.scrollHeight+20}px`);
        assert(await scroll.evaluate(element=>element.scrollHeight<=element.clientHeight+1),"Sidebar baseline must not already scroll");
        const before=await size();
        assert(await side.locator(".rr-game-guide").evaluate(element=>element.open),"Guide must start expanded for a new user");
        await side.locator(".quick-guide details > summary").click();
        await side.locator(".rr-game-journal > summary").click();
        assert(await scroll.evaluate(element=>element.scrollHeight>element.clientHeight),"Disclosure must actually introduce a scrollbar");
        const after=await size();near(after.width,before.width,"Disclosure must not narrow player registers");near(after.left,before.left,"Disclosure must not shift player registers");
        const buttons=await side.locator(".quick-guide-actions button").evaluateAll(nodes=>nodes.map(button=>({
            y:button.getBoundingClientRect().top,height:button.getBoundingClientRect().height,fits:button.scrollWidth<=button.clientWidth+1})));
        assert(buttons.length>0&&buttons.every(button=>button.fits&&Math.abs(button.y-buttons[0].y)<1),"Guide buttons must fit on one row");
        await screenshot(host,{path:path.join(artifacts,"guide-sidebar-wide.png")});
        await scroll.evaluate(element=>element.style.removeProperty("max-height"));

        await side.getByRole("button",{name:"КОНВЕЙЕРЫ",exact:true}).click();
        const conveyor=host.getByRole("dialog",{name:"Как поворачивают конвейеры"});
        const demo=conveyor.locator(".conveyor-demo-grid");
        assert(await conveyor.locator(".conveyor-demo-svg").evaluateAll(async nodes=>{
            const checks=await Promise.all(nodes.map(async node=>{
                const source=await fetch(node.querySelector("image").getAttribute("href")).then(response=>response.text());
                return new DOMParser().parseFromString(source,"image/svg+xml").documentElement.getAttribute("viewBox")===node.getAttribute("viewBox");
            }));return checks.every(Boolean);
        }),"Conveyor background and animation must use the same scene dimensions");
        const motion=[".conveyor-demo-good-robot",".conveyor-demo-good-robot .conveyor-demo-robot",".conveyor-demo-card-robot",".conveyor-demo-card-robot .conveyor-demo-robot"];
        assert.deepStrictEqual(await conveyor.locator(".rr-demo-card strong").allTextContents(),["Вперёд 1","Вперёд 2"]);
        const expectedConveyors=await Promise.all([engineConveyor(1),engineConveyor(2)]);
        const duringFirstStep=await sample(demo,.22,motion),duringSecondStep=await sample(demo,.28,motion);
        assert(duringFirstStep[2].y-duringSecondStep[2].y>5,"Forward 2 must move continuously between its steps");
        let state=await sample(demo,.44,motion);
        for(const [index,expected] of expectedConveyors.entries()){
            near(state[index*2].x,expected.card.x,"card x matches engine");near(state[index*2].y,expected.card.y,"card y matches engine");
            near(state[index*2+1].a,1,"Card arrival must keep the nose");
        }
        state=await sample(demo,.8,motion);
        for(const [index,expected] of expectedConveyors.entries()){
            near(state[index*2].x,expected.belt.x,"belt x matches engine");near(state[index*2].y,expected.belt.y,"belt y matches engine");
        }
        near(state[1].b,1,"belt arrival must turn immediately");near(state[3].a,1,"card arrival keeps its nose");
        assert.deepStrictEqual(await sample(demo,.98,motion),state,"Robots must stop after this single card and belt phase");
        await screenshot(host,{path:path.join(artifacts,"guide-conveyors-wide.png")});
        await host.keyboard.press("Escape");
        await side.getByRole("button",{name:"КОНВЕЙЕРЫ",exact:true}).click();
        await checkPlayback(conveyor,".conveyor-demo-grid");
        await host.keyboard.press("Escape");
        assert(await side.getByRole("button",{name:"КОНВЕЙЕРЫ",exact:true}).evaluate(button=>button===document.activeElement));

        await side.getByRole("button",{name:"КОЛЛИЗИИ",exact:true}).click();
        const collisions=host.getByRole("dialog",{name:"Столкновения и приоритет"});
        const collisionTabs=[["priority","Кто первым"],["passing","Без столкновения"],["headon","Друг в друга"],["wall","Стена"],["chain","Цепочка"]];
        assert.deepStrictEqual(await collisions.locator(".rr-collision-choices button").allTextContents(),collisionTabs.map(([,label])=>label));
        for(const [kind,label] of collisionTabs){
            await collisions.getByRole("button",{name:label,exact:true}).click();
            const example=collisions.locator(".rr-collision-example"),expected=await engineExample(kind);
            const selectors=expected.final.map((_,index)=>`.rr-collision-${kind}-${index}`);
            assert.equal(await example.locator(".rr-collision-robot").count(),expected.final.length);
            const first=await sample(example,.5,selectors);
            first.forEach((robot,index)=>{near(robot.x,expected.first[index].x,"first command x");near(robot.y,expected.first[index].y,"first command y");});
            if(kind==="passing")assert.deepStrictEqual(await example.locator(".rr-collision-commands span").allTextContents(),["Вперёд 1 570","Вперёд 2 680"]);
            const final=await sample(example,.92,selectors);
            final.forEach((robot,index)=>{near(robot.x,expected.final[index].x,`${kind}: engine x`);near(robot.y,expected.final[index].y,`${kind}: engine y`);});
            await screenshot(host,{path:path.join(artifacts,`guide-collision-${kind}-wide.png`)});
        }
        await host.keyboard.press("Escape");

        for(const viewport of [{width:1366,height:600},{width:320,height:640}]){
            await host.setViewportSize(viewport);
            if(viewport.width<1000)await host.locator(".rr-players-open").click();
            for(const [button,title,file] of [["КОЛЛИЗИИ","Столкновения и приоритет","collisions"],["КОНВЕЙЕРЫ","Как поворачивают конвейеры","conveyors"],["Как играть","Как играть в RoboRace","how"]]){
                await side.getByRole("button",{name:button,exact:true}).click();
                const dialog=host.getByRole("dialog",{name:title,exact:true});
                await host.waitForFunction(()=>[...document.querySelectorAll(".guide-backdrop")].every(element=>getComputedStyle(element).opacity==="1"));
                const dimensions=await dialog.evaluate(element=>({width:element.clientWidth,scroll:element.scrollWidth,right:element.getBoundingClientRect().right}));
                assert(dimensions.scroll<=dimensions.width+1&&dimensions.right<=viewport.width,`${file}: horizontal overflow at ${viewport.width}`);
                await screenshot(host,{path:path.join(artifacts,`guide-${file}-${viewport.width}.png`)});
                if(file==="collisions"&&viewport.width===320){
                    for(const [kind,label] of collisionTabs.slice(1)){
                        await dialog.getByRole("button",{name:label,exact:true}).click();
                        assert(await dialog.locator(".rr-collision-choices").evaluate(element=>element.scrollWidth<=element.clientWidth+1),"Collision choices must fit on mobile");
                        await screenshot(host,{path:path.join(artifacts,`guide-collision-${kind}-320.png`)});
                    }
                }
                await host.keyboard.press("Escape");
            }
            if(viewport.width<1000)await host.getByRole("button",{name:"Закрыть игроков"}).click();
        }

        await host.emulateMedia({reducedMotion:"reduce"});
        await host.locator(".rr-players-open").click();
        await side.getByRole("button",{name:"КОЛЛИЗИИ",exact:true}).click();
        assert.equal(await collisions.locator(".rr-collision-example").getAttribute("data-static"),"true");
        assert.equal(await collisions.locator(".rr-collision-example").evaluate(element=>element.getAnimations({subtree:true}).length),0);
        for(const [kind,label] of collisionTabs){
            await collisions.getByRole("button",{name:label,exact:true}).click();
            const expected=await engineExample(kind);
            const final=await sample(collisions.locator(".rr-collision-example"),0,expected.final.map((_,index)=>`.rr-collision-${kind}-${index}`));
            final.forEach((robot,index)=>{near(robot.x,expected.final[index].x,`${kind}: static x`);near(robot.y,expected.final[index].y,`${kind}: static y`);});
        }
        await host.keyboard.press("Escape");
        await side.getByRole("button",{name:"КОНВЕЙЕРЫ",exact:true}).click();
        assert.equal(await demo.getAttribute("data-static"),"true");
        assert.equal(await demo.evaluate(element=>element.getAnimations({subtree:true}).length),0);
        await host.keyboard.press("Escape");
        await side.getByRole("button",{name:"Как играть",exact:true}).click();
        assert.equal(await flags.getAttribute("data-static"),"true");
        assert.equal(await flags.evaluate(element=>element.getAnimations({subtree:true}).length),0);
        await host.keyboard.press("Escape");
        await side.locator(".rr-game-guide > summary").click();
        await host.waitForFunction(()=>localStorage.getItem("roborace-guide-expanded")==="false");
        await host.reload();await host.locator(".program .card").first().waitFor();
        assert(!await side.locator(".rr-game-guide").evaluate(element=>element.open),"Collapsed guide preference must survive reload");
        assert.deepStrictEqual(errors,[]);
        assert(!sandbox.errors(),sandbox.errors());
        console.log("Guide playback, engine-verified examples, stable sidebar, responsive and reduced-motion views passed.");
    }finally{if(browser)await browser.close();stopSandbox(sandbox.server);}
})().catch(error=>{console.error(error);process.exitCode=1;});
