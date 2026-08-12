import { describe,expect,it } from "vitest";
import { bookingDiagnosticValid,criticalPathScheduleValid,INDEPENDENT_STRUCTURE_BATCH13_LABELS,mitreCoverageValid,networkPatchValid } from "../independent-structure-blocks-batch13";
describe("independent structure batch 13 gates",()=>{
 it("rejects dependency penetration",()=>{expect(criticalPathScheduleValid([{id:"a",start:0,duration:2,dependencies:[]},{id:"b",start:2,duration:1,dependencies:["a"]}])).toBe(true);expect(criticalPathScheduleValid([{id:"a",start:0,duration:2,dependencies:[]},{id:"b",start:1,duration:1,dependencies:["a"]}])).toBe(false)});
 it("requires unique bounded MITRE coverage",()=>{expect(mitreCoverageValid([{tactic:"execute",technique:"T1",coverage:80}])).toBe(true);expect(mitreCoverageValid([{tactic:"execute",technique:"T1",coverage:80},{tactic:"execute",technique:"T1",coverage:20}])).toBe(false)});
 it("keeps blocked booking reasons explicit",()=>{expect(bookingDiagnosticValid([{date:"2026-08-18",calendar:"work",reason:"busy",available:false}])).toBe(true);expect(bookingDiagnosticValid([{date:"2026-08-18",calendar:"work",reason:"",available:false}])).toBe(false)});
 it("connects only distinct free same-vlan ports",()=>{const rows=[{id:"a",occupied:false,vlan:"20"},{id:"b",occupied:false,vlan:"20"},{id:"c",occupied:true,vlan:"20"}];expect(networkPatchValid("a","b",rows)).toBe(true);expect(networkPatchValid("a","c",rows)).toBe(false);expect(Object.keys(INDEPENDENT_STRUCTURE_BATCH13_LABELS)).toHaveLength(4)});
});
