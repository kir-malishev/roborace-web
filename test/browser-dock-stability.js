"use strict";
const assert=require("assert"),path=require("path");
const {startSandbox,stopSandbox,launchBrowser,openUser, screenshot}=require("./browser-support");
const port=process.env.DOCK_STABILITY_PORT||"3077";
(async()=>{
    const sandbox=startSandbox(port);let browser;
    try{
        await sandbox.ready;browser=await launchBrowser();
        const {page}=await openUser(browser,{port,room:"stable-dock",name:"Host",viewport:{width:1440,height:900}});
        const {page:guest}=await openUser(browser,{port,room:"stable-dock",name:"Guest"});
        const errors=[];page.on("pageerror",e=>errors.push(e.message));
        await page.getByRole("button",{name:"Присоединиться к игре"}).click();
        await guest.getByRole("button",{name:"Присоединиться к игре"}).click();
        await page.getByRole("button",{name:"Начать игру"}).click();
        await page.locator(".program .card").first().waitFor();
        await page.locator(".game-pause-controls .pause").click();
        await page.locator(".pause-banner").waitFor();
        await page.evaluate(()=>{
            const app=ReactDOM.render(React.createElement(Game),document.getElementById("root"));
            window.__dockStability={app,state:{...app.state},privateState:JSON.parse(JSON.stringify(app.privateState))};
        });
        const variants=["hand-9","hand-3","hand-1","powered-down","resolving","resolving-4","resolving-8","power-down-choice","reentry","finished","spectator","paused"];
        const boxes=()=>page.evaluate(()=>{
            const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
            const scroll=document.querySelector(".bottom-dock-scroll");
            return {board:rect(".board-viewport"),dock:rect(".bottom-dock"),reserve:parseFloat(getComputedStyle(document.querySelector(".game-screen")).getPropertyValue("--rr-program-reserved-space")),scrollable:scroll.scrollHeight>scroll.clientHeight+1};
        });
        for(const viewport of [{width:1440,height:900},{width:1366,height:650},{width:800,height:650},{width:390,height:760}]){
            await page.setViewportSize(viewport);let baseline;
            for(const variant of variants){
                await page.evaluate(async variant=>{
                    const {app,state:base,privateState:saved}=window.__dockStability;
                    const state={phase:"programming",paused:false,userId:base.userId,playerSlots:base.playerSlots,
                        playerStats:base.playerStats,playerNames:base.playerNames,robots:base.robots,programs:{},
                        hudCollapsed:innerWidth<1000,bottomDockCollapsed:false,historyReview:{actual:true,entries:[]},
                        reentryUserId:base.userId,winner:base.userId,register:1,stage:"Исполнение программы"};
                    const privateState={...saved,locked:false,poweredDown:false,finished:false,lives:3,selected:[],registerCards:[],lockedRegisters:[]};
                    if(variant.startsWith("hand-"))privateState.hand=saved.hand.slice(0,Number(variant.slice(5)));
                    if(variant==="powered-down")Object.assign(privateState,{hand:[],poweredDown:true});
                    if(variant.startsWith("resolving")){
                        state.phase="resolving";
                        if(variant==="resolving-8" || variant==="resolving-4"){
                            state.playerSlots=[base.userId,...Array.from({length:Number(variant.slice(-1))-1},(_,i)=>`proof-${i}`)];
                            state.playerStats={...base.playerStats};state.playerNames={...base.playerNames};
                            for(const id of state.playerSlots){state.playerStats[id]={lives:3,damage:0,checkpoints:0};state.playerNames[id]=`Игрок ${state.playerSlots.indexOf(id)+1}`;}
                        }
                        for(const id of state.playerSlots)state.programs[id]={cards:saved.hand.slice(0,5)};
                    }
                    if(variant==="power-down-choice"){
                        state.phase="power-down-choice";state.powerDownChoice={answered:0,total:2};
                        privateState.powerDownChoice={eligible:true,answered:false};
                    }
                    if(variant==="reentry"){
                        state.phase="reentry";
                        privateState.reentry={active:true,needsPowerDownChoice:true,candidates:[
                            {x:2,y:14,archive:true,directions:["north","east","south","west"]},
                            {x:3,y:14,directions:["north","east","south","west"]}]};
                    }
                    if(variant==="finished")state.phase="finished";
                    if(variant==="spectator")state.playerSlots=base.playerSlots.filter(id=>id!==base.userId);
                    if(variant==="paused")state.paused=true;
                    app.privateState=privateState;
                    await new Promise(resolve=>app.setState(state,resolve));
                    window.scrollTo(0,0);
                },variant);
                await page.waitForTimeout(280); // Let the existing width transition finish so jumps cannot hide in it.
                const current=await boxes();
                if(!baseline)baseline=current;
                for(const name of ["board"])for(const dimension of ["x","y","width","height"])
                    assert(Math.abs(current[name][dimension]-baseline[name][dimension])<1,`${viewport.width}/${variant}: ${name}.${dimension} changed (${JSON.stringify({baseline,current})})`);
                assert.strictEqual(current.reserve,baseline.reserve,"Phase changed personal layout reservation");
                assert(current.dock.height <= current.reserve,`${viewport.width}/${variant}: panel exceeds its personal envelope: ${JSON.stringify(current)}`);
                assert(!current.scrollable,`${viewport.width}/${variant}: needless vertical program scroll`);
                if(variant.startsWith("resolving"))assert(current.dock.height < 90,"Execution leaves a large empty panel");
                assert(await page.locator(".bottom-dock .rr-dock-collapse-button").isVisible());
                if(variant==="reentry")assert(await page.getByRole("button",{name:"Возродиться",exact:true}).isVisible());
            }

            await screenshot(page,{path:path.resolve(__dirname,`../artifacts/stable-dock-${viewport.width}.png`)});
        }
        assert.deepStrictEqual(errors,[]);
        assert(!sandbox.output().includes("[sandbox] WARNING"),sandbox.output());
        console.log("Field stays fixed with a compact personal envelope across hands, 2/4/8 players, recovery, reentry, finish, spectators and pause on four screen sizes.");
    }finally{if(browser)await browser.close();stopSandbox(sandbox.server);}
})().catch(error=>{console.error(error);process.exitCode=1;});
