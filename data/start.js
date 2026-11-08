"use strict";
const FieldFormat=require("../public/field-format");
const range=(from,to)=>Array.from({length:to-from+1},(_,i)=>from+i);
const START_CARDS=["Стартовая площадка"];
const START_TEMPLATES={[START_CARDS[0]]:{
    ...FieldFormat.emptyGeometry(),
    starts:[5,6,4,7,3,8,2,9].map(x=>({x,y:14})),
    conveyors:{"2,15":"west","1,15":"north","1,14":"north","1,13":"north","1,12":"east","2,12":"east","3,12":"east","4,12":"north",
        "9,15":"east","10,15":"north","10,14":"north","10,13":"north","10,12":"west","9,12":"west","8,12":"west","7,12":"north"},
    express:[],walls:[...range(12,15).flatMap(y=>[`0,${y},west`,`11,${y},east`]),...range(0,11).map(x=>`${x},15,south`)]
}};
for(const layout of Object.values(START_TEMPLATES)) layout.conveyorConnections=FieldFormat.inferConnections(layout);
module.exports={START_CARDS,START_TEMPLATES};
