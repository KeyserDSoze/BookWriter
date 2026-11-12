import type { BookProject, Chapter, Scene } from "./types";
import {
  summarizeTaskBookCheckpoint, type TaskBookCheckpoint,
} from "./task-book-checkpoint";

const MAX_DISPLAY_CHAPTERS = 20;
const IGNORED_PROJECT_FIELDS = new Set([
  "id","createdAt","updatedAt","remote","status","previousError",
  "phase","currentSceneId","chapters","aiBudget","modelRoutes",
  "taskReasoningEfforts",
]);
const equal = (left:unknown,right:unknown):boolean =>
  JSON.stringify(left)===JSON.stringify(right);

export type NarrativeHistoryImpact = {
  bookId:string;
  activityId:string;
  revisionBefore:string;
  revisionAfter:string;
  currentRevision:string;
  currentRevisionEqualsRecordedAfter:boolean;
  phaseChanged:boolean;
  narrativeFieldsChanged:number;
  memoryChanged:boolean;
  chaptersAdded:number;
  chaptersRemoved:number;
  chaptersChanged:number;
  chapterOrderChanged:boolean;
  sceneOrderChangedChapters:number;
  scenesAdded:number;
  scenesRemoved:number;
  scenesChanged:number;
  frozenAdded:number;
  frozenRemoved:number;
  firstChangedChapterNumber:number|null;
  candidateChapterCount:number;
  candidateChapterNumbers:number[];
  candidateChapterNumbersOmitted:number;
  globalNarrativeChange:boolean;
};

function indexedChapters(book:BookProject):Map<string,Chapter>|null{
  if(!Array.isArray(book.chapters)||book.chapters.length>200)return null;
  const ids=new Map<string,Chapter>(),numbers=new Set<number>();
  for(const chapter of book.chapters){
    if(!chapter || typeof chapter.id!=="string" || !chapter.id ||
       !Number.isSafeInteger(chapter.number) || chapter.number<1 ||
       ids.has(chapter.id) || numbers.has(chapter.number) ||
       !Array.isArray(chapter.scenes) || chapter.scenes.length>200)return null;
    const sceneIds=new Set<string>();
    for(const scene of chapter.scenes){
      if(!scene || typeof scene.id!=="string" || !scene.id ||
         sceneIds.has(scene.id))return null;
      sceneIds.add(scene.id);
    }
    ids.set(chapter.id,chapter);numbers.add(chapter.number);
  }
  return ids;
}
function sceneIndex(chapters:Map<string,Chapter>):Map<string,Scene>{
  const indexed=new Map<string,Scene>();
  for(const [chapterId,chapter] of chapters)
    for(const scene of chapter.scenes)
      indexed.set(JSON.stringify([chapterId,scene.id]),scene);
  return indexed;
}
/** Only fixed categories, numbers and revisions leave this function.
 * NEVER return a chapter/scene title, private text, secret or book object.
 * Candidate chapters are a conservative editorial review queue, not causality. */
export function compareNarrativeTaskHistory(
  raw:unknown, bookId:string,activityId:string,currentBook:BookProject,
):NarrativeHistoryImpact|null{
  if(!bookId||!activityId||currentBook.id!==bookId)return null;
  const summary=summarizeTaskBookCheckpoint(raw,bookId,activityId);
  if(!summary)return null;
  // Do not turn a malformed storage field into arbitrary UI text. A BookWriter
  // revision is an ISO timestamp written by revisionTimestamp(), not prose.
  const validRevision=(value:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
  if(!validRevision(summary.revisionBefore)||
     !validRevision(summary.revisionAfter)||
     !validRevision(currentBook.updatedAt))return null;
  const checkpoint=raw as TaskBookCheckpoint;
  const before=checkpoint.before,after=checkpoint.after;
  const beforeCh=indexedChapters(before);
  const afterCh=indexedChapters(after);
  const currentCh=indexedChapters(currentBook);
  if(!beforeCh || !afterCh || !currentCh)return null;
  const fields=new Set([...Object.keys(before),...Object.keys(after)]);
  let narrativeFieldsChanged=0;
  for(const key of fields)
    if(!IGNORED_PROJECT_FIELDS.has(key) &&
       !equal((before as unknown as Record<string,unknown>)[key],
         (after as unknown as Record<string,unknown>)[key]))
      narrativeFieldsChanged++;
  const memoryChanged=!equal(before.memory,after.memory);
  const globalNarrativeChange=narrativeFieldsChanged>0;
  const phaseChanged=before.phase!==after.phase;

  let chaptersAdded=0,chaptersRemoved=0,chaptersChanged=0;
  let sceneOrderChangedChapters=0;
  let frozenAdded=0,frozenRemoved=0;
  let earliest:number|null=null;
  const mark=(number:number)=>{
    if(earliest===null||number<earliest)earliest=number;
  };
  for(const [id,ch] of beforeCh){
    const newer=afterCh.get(id);
    if(!newer){
      chaptersRemoved++;mark(ch.number);
      if(ch.frozenAt)frozenRemoved++;
    }else{
      if(!equal(ch,newer)){
        chaptersChanged++;mark(Math.min(ch.number,newer.number));
      }
      if(!equal(ch.scenes.map(scene=>scene.id),newer.scenes.map(scene=>scene.id)))
        sceneOrderChangedChapters++;
      if(!ch.frozenAt&&newer.frozenAt)frozenAdded++;
      if(ch.frozenAt&&!newer.frozenAt)frozenRemoved++;
    }
  }
  for(const [id,ch] of afterCh)
    if(!beforeCh.has(id)){
      chaptersAdded++;mark(ch.number);
      if(ch.frozenAt)frozenAdded++;
    }

  const beforeChapterIds=before.chapters.map(ch=>ch.id);
  const afterChapterIds=after.chapters.map(ch=>ch.id);
  const chapterOrderChanged=!equal(beforeChapterIds,afterChapterIds);
  if(chapterOrderChanged){
    const firstDifferentIndex=beforeChapterIds.findIndex((id,index)=>id!==afterChapterIds[index]);
    const ordinal=firstDifferentIndex<0?Math.min(beforeChapterIds.length,afterChapterIds.length):
      firstDifferentIndex;
    const positions=[
      before.chapters[ordinal]?.number,
      after.chapters[ordinal]?.number,
    ].filter((n):n is number=>n!==undefined);
    if(positions.length)mark(Math.min(...positions));
  }
  const beforeScenes=sceneIndex(beforeCh),afterScenes=sceneIndex(afterCh);
  let scenesAdded=0,scenesRemoved=0,scenesChanged=0;
  for(const [id,scene] of beforeScenes){
    const newer=afterScenes.get(id);
    if(!newer)scenesRemoved++;
    else if(!equal(scene,newer))scenesChanged++;
  }
  for(const id of afterScenes.keys())
    if(!beforeScenes.has(id))scenesAdded++;

  const currentNumbers=[...currentCh.values()].map(ch=>ch.number)
    .filter(n=>globalNarrativeChange||earliest!==null&&n>=earliest)
    .sort((a,b)=>a-b);
  return {
    bookId,activityId,
    revisionBefore:summary.revisionBefore,revisionAfter:summary.revisionAfter,
    currentRevision:currentBook.updatedAt,
    currentRevisionEqualsRecordedAfter:currentBook.updatedAt===after.updatedAt,
    phaseChanged,narrativeFieldsChanged,memoryChanged,
    chaptersAdded,chaptersRemoved,chaptersChanged,
    chapterOrderChanged,sceneOrderChangedChapters,
    scenesAdded,scenesRemoved,scenesChanged,
    frozenAdded,frozenRemoved,firstChangedChapterNumber:earliest,
    candidateChapterCount:currentNumbers.length,
    candidateChapterNumbers:currentNumbers.slice(0,MAX_DISPLAY_CHAPTERS),
    candidateChapterNumbersOmitted:Math.max(0,currentNumbers.length-MAX_DISPLAY_CHAPTERS),
    globalNarrativeChange,
  };
}
