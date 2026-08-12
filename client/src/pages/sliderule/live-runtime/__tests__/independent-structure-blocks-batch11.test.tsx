import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import { usageForBlock } from "../../component-usage";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary, type ExperienceBlockInstance } from "../block-registry";
import { ciJobCanRun, commandDraftValid, documentMoveValid, INDEPENDENT_STRUCTURE_BATCH11_LABELS, phaseOverridesValid, rackPlacementValid, serialBatchAllocationValid } from "../independent-structure-blocks-batch11";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";

const rows={demo:[{id:"a",createdAt:"2026-08-11",values:{name:"API",side:"front",position:8,height:2,lane:0,status:"placed",type:"engineStop",attr:"duration",attrType:"number",required:"true",value:"30",available:"true",plan:"Growth",phase:"TRIAL",price:0,override:0,collection:"Product",permission:"edit",parent:"",current:"true",writable:"true",descendant:"false",stage:"Build",job:"compile",jobStatus:"failed",needs:"success",parallel:1,authorized:"true",item:"Terminal",serial:"SN-1",batch:"B-1",qty:1,target:1,warehouse:"East"}}]};
const bindings:Record<string,ExperienceBlockInstance["binding"]>={
  DatacenterRackUnitPlanner:{entityRef:"demo",assetNameFieldRef:"name",sideFieldRef:"side",unitPositionFieldRef:"position",unitHeightFieldRef:"height",horizontalLaneFieldRef:"lane",placementStatusFieldRef:"status",targets:["rack"]},
  DeviceCommandDispatchConsole:{entityRef:"demo",commandTypeFieldRef:"type",attributeNameFieldRef:"attr",attributeTypeFieldRef:"attrType",requiredFieldRef:"required",attributeValueFieldRef:"value",availableFieldRef:"available",targets:["device"]},
  SubscriptionPhaseOverrideComposer:{entityRef:"demo",planNameFieldRef:"plan",phaseTypeFieldRef:"phase",catalogPriceFieldRef:"price",overridePriceFieldRef:"override",targets:["subscription"]},
  DocumentPermissionMovePlanner:{entityRef:"demo",collectionNameFieldRef:"collection",permissionFieldRef:"permission",parentCollectionFieldRef:"parent",currentCollectionFieldRef:"current",writableFieldRef:"writable",descendantFieldRef:"descendant",targets:["document"]},
  CiStageJobGraphConsole:{entityRef:"demo",stageNameFieldRef:"stage",jobNameFieldRef:"job",jobStatusFieldRef:"jobStatus",dependencyStatusFieldRef:"needs",parallelCountFieldRef:"parallel",authorizedFieldRef:"authorized",targets:["pipeline"]},
  SerialBatchAllocationScanner:{entityRef:"demo",itemNameFieldRef:"item",serialNumberFieldRef:"serial",batchNumberFieldRef:"batch",quantityFieldRef:"qty",requiredQuantityFieldRef:"target",warehouseFieldRef:"warehouse",targets:["stock"]},
};
describe("independent structure block batch 11",()=>{
  it("keeps globally unique explicit families",()=>{const c=catalogJson as {blocks:Array<{type:string;structureFamily?:string;structureDelta?:string;rendererKey:string}>};const all=c.blocks.filter(x=>x.structureFamily),selected=Object.keys(INDEPENDENT_STRUCTURE_BATCH11_LABELS).map(type=>c.blocks.find(x=>x.type===type)!);expect(new Set(all.map(x=>x.structureFamily)).size).toBe(all.length);expect(selected.every(x=>x.structureDelta)).toBe(true);expect(new Set(selected.map(x=>x.rendererKey)).size).toBe(6)});
  it("renders six desktop and phone structures",()=>{for(const type of Object.keys(INDEPENDENT_STRUCTURE_BATCH11_LABELS)){const block={id:type,type,props:{surface:"plain"},binding:bindings[type]};const desktop=renderToStaticMarkup(<ExperienceBlockBoundary block={block} entityRows={rows}/>),phone=renderToStaticMarkup(<PhoneExperienceBlock block={block} entityRows={rows}/>);expect(BLOCK_DEFINITIONS[type]?.phone,type).toBe(true);expect(desktop,type).not.toContain("尚未绑定");expect(phone,type).toContain('data-testid="phone-')}});
  it("uses distinct non-table signatures",()=>{const d=new Set<string>(),m=new Set<string>();for(const type of Object.keys(INDEPENDENT_STRUCTURE_BATCH11_LABELS)){const u=usageForBlock(type);expect(u.desktop).not.toContain("Table");expect(u.phone).not.toContain("M.Table");d.add(u.desktop.slice().sort().join("|"));m.add(u.phone.slice().sort().join("|"))}expect(d.size).toBe(6);expect(m.size).toBe(6)});
  it("enforces source-derived gates",()=>{expect(rackPlacementValid([{id:"a",side:"front",position:1,height:2,lane:0}],10)).toBe(true);expect(commandDraftValid(true,[{required:true,value:"x"}])).toBe(true);expect(phaseOverridesValid(["TRIAL"],[{phase:"TRIAL",price:0}])).toBe(true);expect(documentMoveValid("a","b",true,false)).toBe(true);expect(ciJobCanRun("manual",true,["success"])).toBe(true);expect(serialBatchAllocationValid(2,[{serial:"A",quantity:1},{serial:"B",quantity:1}])).toBe(true)});
});
