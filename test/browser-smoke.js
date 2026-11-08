"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path");
const {FIELDS}=require("../data/fields");
const Field=require("../public/field-format");
const {startSandbox,stopSandbox,launchBrowser,openUser}=require("./browser-support");
const port=process.env.SMOKE_PORT||"3090";
(async()=>{
    const sandbox=startSandbox(port);let browser;
    try {
        await sandbox.ready;browser=await launchBrowser();
        const host=await openUser(browser,{port,room:"roborace-smoke",name:"Host",viewport:{width:1440,height:1000}});
        const guest=await openUser(browser,{port,room:"roborace-smoke",name:"Guest",viewport:{width:1440,height:1000}});
        const errors=[];host.page.on("pageerror",e=>errors.push(e.message));
        assert.equal(await host.page.locator("h1").innerText(),"RoboRace");
        await host.page.getByRole("button",{name:"Присоединиться к игре"}).click();
        await guest.page.getByRole("button",{name:"Присоединиться к игре"}).click();
        await host.page.getByRole("button",{name:"Открыть редактор поля"}).click();
        const editor=host.page.getByRole("dialog",{name:"Редактор поля"});
        assert.equal(await editor.locator(".race-start").count(),8);
        await editor.getByRole("button",{name:"Яма",exact:true}).click();
        const board=editor.locator(".rr-editor-board");
        // Automatic landscape view: transform cell coordinates into the frame.
        const clickCell=async(x,y)=>{const b=await board.boundingBox();let u=(x+.5)/12,v=(y+.5)/16;
            const rotated=await board.evaluate(e=>e.classList.contains("rr-view-landscape"));
            await board.click({position:{x:3+(rotated?1-v:u)*(b.width-6),y:3+(rotated?u:v)*(b.height-6)}});};
        const fileInput=editor.locator('input[type="file"]');
        const importField=payload=>fileInput.setInputFiles({name:"arena.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(payload))});
        const exportField=async()=>{
            const downloadPromise=host.page.waitForEvent("download");
            await editor.getByRole("button",{name:"Экспорт JSON"}).click();
            return JSON.parse(fs.readFileSync(await (await downloadPromise).path(),"utf8"));
        };
        // A complete catalog document enters the editor without converting its geometry.
        await importField(FIELDS[0]);
        const catalogExport=await exportField();
        assert.equal(catalogExport.version,1);
        assert.deepStrictEqual(catalogExport.features,Field.read(FIELDS[0]).features);
        assert.deepStrictEqual(catalogExport.routes[0].flags,FIELDS[0].routes[0].flags);
        await editor.locator(".rr-editor-clear").click();
        for(let y=3;y<6;y++)for(let x=3;x<6;x++)await clickCell(x,y);
        assert.equal(await editor.locator(".race-pit").count(),1,"connected pits must use one continuous area");
        const payload=await exportField();
        assert.equal(payload.format,"roborace-field");assert.equal(payload.features.pits.length,9);
        // A checkpoint on a laser's path must stay beneath the visible beam.
        payload.routes[0].flags=[[2,2],[3,2],[4,2],[5,2],[6,2],[7,1]];
        payload.features.gears={"2,2":1};
        payload.features.conveyors["3,2"]="east";
        payload.features.pushers=[{x:4,y:2,direction:"north",active:[2,4]}];
        payload.features.repairs.push("5,2");
        payload.features.walls.push("0,2,west","4,2,south");
        payload.features.lasers=[{x:0,y:2,direction:"east",count:1}];
        payload.features.repairs.push("1,12");
        payload.features.conveyors["2,13"]="east";
        await editor.getByRole("button",{name:"↶ Отменить",exact:true}).click();
        await importField(payload);
        await editor.locator(".race-flag-icon").first().waitFor();
        assert.equal(await editor.locator(".race-flag-icon").count(),6,"all checkpoints must use the same open-centre marker");
        const editedExport=await exportField();
        assert(editedExport.features.repairs.includes("1,12"),"start geometry was lost on browser import/export");
        await editor.getByRole("button",{name:"Выбрать это поле",exact:true}).click();
        await editor.waitFor({state:"hidden"});
        await host.page.locator(".large-course-preview .race-field-lasers").waitFor();
        assert.equal(await host.page.locator(".large-course-preview .race-flag-icon").count(),6);
        await host.page.getByRole("button",{name:"Начать игру"}).click();
        await host.page.locator(".program .card").first().waitFor();
        assert.equal(await host.page.locator(".board .robot").count(),2);
        assert.equal(await host.page.locator(".board .race-robot-number").count(),0,"robots must not carry number badges");
        assert.equal(await host.page.locator(".board .race-flag-icon").count(),6);
        assert.equal(await host.page.locator(".board .race-flag-next").getAttribute("data-number"),"1","own next checkpoint must stand out");
        assert(await host.page.locator(".board .race-checkpoint-repair").first().isVisible(),"every checkpoint needs its repair symbol");
        const layers=await host.page.locator(".board").evaluate(board=>{
            const beam=board.querySelector(".race-field-lasers"),flag=board.querySelector(".flag");
            return {beam:Number(getComputedStyle(beam).zIndex),flag:Number(getComputedStyle(flag).zIndex)||0};
        });
        assert(layers.beam>layers.flag,"laser must be painted over the checkpoint");
        fs.mkdirSync(path.resolve(__dirname,"../artifacts"),{recursive:true});
        await host.page.evaluate(()=>{const render=RaceArt.render;window.customFieldRenders=0;
            RaceArt.render=(...args)=>{window.customFieldRenders++;return render(...args);};});
        await host.page.setViewportSize({width:390,height:760});
        await host.page.getByRole("button",{name:"Авто",exact:true}).click();
        await guest.page.getByRole("button",{name:"Авто",exact:true}).click();
        await host.page.getByRole("button",{name:"Готов",exact:true}).click();
        await guest.page.getByRole("button",{name:"Готов",exact:true}).click();
        await host.page.getByRole("button", {name:/Игроки ·/}).click();
        await host.page.locator(".rr-player-registers .public-register.current").first().waitFor({timeout:20000});
        assert.equal(await host.page.evaluate(()=>window.customFieldRenders),0,"unchanged custom geometry was regenerated during resize or execution");
        await host.page.getByRole("button", {name:"Закрыть игроков"}).click();
        // Render the same board component with changing per-player progress.
        const fixture={phase:"programming",userId:"one",playerSlots:["one","two"],
            flags:[{number:1,x:2,y:2},{number:2,x:4,y:2},{number:3,x:6,y:2}],
            playerStats:{one:{checkpoints:0,lives:3},two:{checkpoints:2,lives:3}}};
        const renderCheckpoints=async(state)=>{
            await host.page.evaluate(state=>{
                let proof=document.getElementById("checkpoint-proof");
                if(!proof){proof=document.createElement("div");proof.id="checkpoint-proof";proof.className="roborace-app";document.body.append(proof);}
                ReactDOM.render(React.createElement(BoardCheckpoints,{state}),proof);
            },state);
            return host.page.locator("#checkpoint-proof .race-flag-next").evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.number)));
        };
        assert.deepStrictEqual(await renderCheckpoints(fixture),[1]);
        assert.deepStrictEqual(await renderCheckpoints({...fixture,playerStats:{...fixture.playerStats,one:{checkpoints:1,lives:3}}}),[2]);
        assert.deepStrictEqual(await renderCheckpoints({...fixture,userId:"two"}),[3],"players must see their own next goal");
        assert.deepStrictEqual(await renderCheckpoints({...fixture,userId:"spectator"}),[]);
        assert.deepStrictEqual(await renderCheckpoints({...fixture,phase:"finished"}),[]);
        for(const stats of [{checkpoints:3,lives:3,finished:true},{checkpoints:0,lives:0}])
            assert.deepStrictEqual(await renderCheckpoints({...fixture,playerStats:{one:stats}}),[]);
        assert.deepStrictEqual(await renderCheckpoints({...fixture,historyReview:{actual:false,playerStats:{one:{checkpoints:1,lives:3}}}}),[2],"history must highlight the next goal from the selected moment");
        // Corner markers stay upright; their hit areas must follow all view rotations.
        await host.page.setViewportSize({width:1440,height:900});
        const hintCells=[[2,2],[4,2],[6,2],[8,2],[2,4]];
        for(const angle of [0,90,180,270]){
            await host.page.evaluate(({angle,cells})=>{
                let proof=document.getElementById("hint-proof");
                if(!proof){proof=document.createElement("div");proof.id="hint-proof";document.body.append(proof);}
                proof.className=`roborace-app ${boardViewClass(angle)}`;
                Object.assign(proof.style,{position:"fixed",left:"100px",top:"70px",width:angle%180?"640px":"480px",height:angle%180?"480px":"640px",zIndex:999,background:"#596c73"});
                proof.style.setProperty("--rr-view-angle",`${angle}deg`);
                const state={flags:cells.map(([x,y],i)=>({x,y,number:i+1})),robots:[],fieldFeatures:{
                    gears:{"2,2":1},conveyors:{"4,2":"east"},pushers:[{x:6,y:2,direction:"north",active:[2,4]}],repairs:["8,2"],
                    lasers:[{x:0,y:4,direction:"east",count:1}],walls:[]}};
                ReactDOM.render(React.createElement("div",{className:"board rr-view-canvas"},
                    React.createElement(BoardCheckpoints,{state}),React.createElement(BoardHints,{state,enabled:true,viewAngle:angle}),
                    React.createElement(LaserEffects,{viewAngle:angle,shots:[{id:1,source:"board",start:{x:3.5,y:6.5},end:{x:5.5,y:6.5},direction:"east",count:2,targetUserId:"target"}]})),proof);
            },{angle,cells:hintCells});
            const damage=await host.page.locator("#hint-proof .laser-impact-label").evaluate(n=>{
                const text=n.querySelector("text"),animation=text.getAnimations()[0];animation.pause();
                const sample=time=>{animation.currentTime=time;const m=text.getScreenCTM();return {x:m.e,y:m.f,upright:m.a>0&&m.d>0&&Math.abs(m.b)<.001&&Math.abs(m.c)<.001};};
                const start=sample(210),end=sample(560),anchor=new DOMPoint(0,0).matrixTransform(n.getScreenCTM()),label=new DOMPoint(0,-.42).matrixTransform(text.getScreenCTM());
                return {start,end,above:label.y<anchor.y,centered:Math.abs(label.x-anchor.x)<.01};
            });
            assert(damage.start.upright&&damage.end.upright&&damage.above&&damage.centered&&Math.abs(damage.start.x-damage.end.x)<.01&&damage.end.y<damage.start.y,`${angle}: laser damage must remain upright above the robot and float upwards on screen`);
            for(const [index,title] of ["Шестерня","Конвейер","Толкатель","Ремонтная станция","Лазер"].entries()){
                const expectFlag=async()=>host.page.waitForFunction(number=>[...document.querySelectorAll(".field-tooltip strong")].some(n=>n.textContent===`Флаг ${number}`),index+1,{timeout:3000}).catch(async error=>{
                    await host.page.screenshot({path:path.resolve(__dirname,"../artifacts/hint-failure.png")});
                    throw new Error(`Flag hint ${angle}/${index}: ${await host.page.locator(".field-tooltip strong").allTextContents()}; ${error.message}`);
                });
                const flag=host.page.locator("#hint-proof .flag").nth(index);
                const number=await flag.locator(".race-checkpoint-number").boundingBox();
                await host.page.mouse.move(number.x+number.width/2,number.y+number.height/2);
                await expectFlag();
                assert.equal(await host.page.locator("#hint-proof circle.field-hint-outline").count(),0,"flags must highlight their corner symbols, never a central circle");
                assert.equal(await host.page.locator("#hint-proof rect.field-hint-outline").count(),2);
                const repair=await flag.locator(".race-checkpoint-repair").boundingBox();
                await host.page.mouse.move(repair.x+repair.width/2,repair.y+repair.height/2);
                await expectFlag();
                const cell=await flag.boundingBox();
                for(const [x,y] of [[.04,.5],[.96,.5],[.5,.04],[.5,.96]]){
                    await host.page.mouse.move(cell.x+cell.width*x,cell.y+cell.height*y);
                    await expectFlag();
                }
                await host.page.mouse.move(cell.x+cell.width/2,cell.y+cell.height/2);
                await host.page.waitForFunction(title=>[...document.querySelectorAll(".field-tooltip strong")].some(n=>n.textContent===title),title,{timeout:2500}).catch(async error=>{
                    await host.page.screenshot({path:path.resolve(__dirname,"../artifacts/hint-failure.png")});
                    throw new Error(`Hint ${angle}/${index}: expected ${title}, saw ${await host.page.locator(".field-tooltip strong").allTextContents()}; ${error.message}`);
                });
            }
        }
        await host.page.evaluate(()=>{const proof=document.getElementById("hint-proof");ReactDOM.unmountComponentAtNode(proof);proof.remove();});
        assert.deepStrictEqual(errors,[]);
        assert(!sandbox.output().includes("[sandbox] WARNING"),sandbox.output());
        console.log("Editor import/export, custom-field game, checkpoint hints and screen-facing effects passed.");
    } finally {if(browser)await browser.close();stopSandbox(sandbox.server);}
})().catch(e=>{console.error(e);process.exitCode=1});
