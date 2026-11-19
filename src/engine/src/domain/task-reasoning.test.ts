import { describe,expect,it } from "vitest";
import { DEFAULT_SETTINGS,newBook, type TaskReasoning } from "./types";
import { effectiveReasoningEffort,taskReasoningChoice,validateTaskReasoningOverrides } from "./task-reasoning";
describe("Reasoning routing task > endpoint, libro > task",()=>{
  it("eredita endpoint e poi rispetta task e libro senza cambiare altri task",()=>{
    const settings=structuredClone(DEFAULT_SETTINGS);
    settings.endpoints[0]!.reasoningEffort="high";
    const book=newBook("Storia","Titolo","Stile","Audience");
    expect(effectiveReasoningEffort("brainstorm",settings,book,settings.endpoints[0]!)).toBe("high");
    settings.taskReasoningEfforts={brainstorm:"low",prose:"medium"};
    expect(effectiveReasoningEffort("brainstorm",settings,book,settings.endpoints[0]!)).toBe("low");
    book.taskReasoningEfforts={brainstorm:"automatic"};
    expect(taskReasoningChoice("brainstorm",settings,book,settings.endpoints[0]!)).toBe("automatic");
    expect(effectiveReasoningEffort("brainstorm",settings,book,settings.endpoints[0]!)).toBeUndefined();
    expect(effectiveReasoningEffort("prose",settings,book,settings.endpoints[0]!)).toBe("medium");
    book.taskReasoningEfforts={brainstorm:"xhigh"};
    expect(effectiveReasoningEffort("brainstorm",settings,book,settings.endpoints[0]!)).toBe("xhigh");
  });
  it("blocca override malformati e kind non previsti prima della rete",()=>{
    for(const v of [null,[],{brainstorm:"unlimited"},{unknown:"low"},{brainstorm:null},{brainstorm:1}]){
      expect(()=>validateTaskReasoningOverrides(v)).toThrow();
    }
    const settings=structuredClone(DEFAULT_SETTINGS);
    const book=newBook("Storia","Titolo","Stile","Audience");
    settings.taskReasoningEfforts={prose:"oops" as TaskReasoning};
    expect(()=>effectiveReasoningEffort("brainstorm",settings,book,settings.endpoints[0]!)).toThrow();
    settings.taskReasoningEfforts=undefined;
    book.taskReasoningEfforts={unknown:"low"} as typeof book.taskReasoningEfforts;
    expect(()=>effectiveReasoningEffort("brainstorm",settings,book,settings.endpoints[0]!)).toThrow();
  });
});
