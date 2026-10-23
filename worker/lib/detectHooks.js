const FILLER = new Set(["um","uh","so","okay","ok","anyway","basically","well","like","right"]);
const CURIOSITY = new Set(["why","how","what","secret","truth","mistake","wrong","never","impossible","danger","problem","failed","failure","shocking","crazy","worst","best","hidden","wait","unless","instead","because","but","however","suddenly","discovered","revealed","survive","lost","found","money","free","prove","imagine","nobody","everyone","finally","scared","angry","love","hate","win","lose","died","death","fight","caught","escape","kya","kyun","kaise","sach","galti","khatarnaak","achanak","nahi","sabse","dekho","socho","chalo","sun","लेकिन","क्यों","कैसे","सच","गलती","खतरा","अचानक","नहीं","सबसे"]);
const EMOTION = new Set(["love","hate","fear","afraid","angry","happy","sad","shocked","surprised","scared","amazing","terrible","worst","best","evil","betrayed","win","lose","fight","death","destroyed","shocking","dar","khush","gussa","kamaal","maza","hairaan","डर","खुश","गुस्सा","कमाल","मज़ा","हैरान"]);
const PAYOFF = new Set(["finally","realized","discovered","revealed","result","therefore","because","turns","out","ended","won","lost","escaped","survived","proved","means","hence","आखिर","फिर","तभी","इसलिए","पता","जीत","बच","निकला"]);
function normalizeWords(words) {
  if (!Array.isArray(words)) return [];
  return words.map((w) => ({ text: String((w && (w.word || w.text)) || "").trim(), start: Number((w && (w.start !== undefined ? w.start : w.startTime)) || 0), end: Number((w && (w.end !== undefined ? w.end : w.endTime)) || 0) }))
    .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= 0 && w.end > w.start)
    .sort((a,b) => a.start-b.start);
}
function tokens(text) { return String(text || "").toLowerCase().replace(/[’']/g,"").match(/[a-z0-9\u0900-\u097f]+/g) || []; }
function clamp(n,min,max) { return Math.max(min,Math.min(max,n)); }
function textOf(words) { return words.map((w)=>w.text).join(" "); }
function pauses(words) {
  const out=[];
  for(let i=1;i<words.length;i++){const gap=words[i].start-words[i-1].end;if(gap>=0.38&&gap<=4.5)out.push({time:(words[i].start+words[i-1].end)/2,strength:clamp((gap-0.35)/1.4,0,1)});}
  return out;
}
function scoreWindow(segment, allWords, start, end, visuals, audioEvents, pauseEvents) {
  const text=textOf(segment), t=tokens(text); if(t.length<12)return null;
  const first=segment.filter((w)=>w.start<start+4), ft=tokens(textOf(first)), opening=textOf(first).toLowerCase();
  const curiosity=t.reduce((n,x)=>n+(CURIOSITY.has(x)?1:0),0), emotion=t.reduce((n,x)=>n+(EMOTION.has(x)?1:0),0);
  const endingWords=segment.filter((w)=>w.end>=end-6);
  const endingTokens=tokens(textOf(endingWords));
  const payoff=endingTokens.reduce((n,x)=>n+(PAYOFF.has(x)?1:0),0);
  const contextless=["he","she","it","they","this","that","these","those","because","and","then","उसने","उन्होंने","यह","वह"].includes(ft[0]||"");
  const questions=t.reduce((n,x)=>n+((["why","how","what","when","where","who","which","क्या","क्यों","कैसे"].includes(x))?1:0),0);
  const contrast=t.reduce((n,x)=>n+((["but","however","instead","although","unless","except","yet","लेकिन","मगर"].includes(x))?1:0),0);
  const density=t.length/Math.max(1,end-start), firstToken=ft[0]||"";
  const nearestPause=(target)=>pauseEvents.reduce((best,e)=>Math.abs(e.time-target)<2.2&&Math.abs(e.time-target)<best.distance?{strength:e.strength,distance:Math.abs(e.time-target)}:best,{strength:0,distance:Infinity}).strength;
  const startPause=nearestPause(start), endPause=nearestPause(end);
  let visual=0;
  for(const e of visuals){const time=Number(e&&e.time);if(!Number.isFinite(time)||time<start||time>end)continue;visual+=clamp(Number(e.strength)||0.5,0,1)*(time-start<=4?1.15:0.28);}
  visual=clamp(visual/2.2,0,1);
  const audioNearStart=(audioEvents||[]).reduce((best,e)=>{const distance=Math.abs(Number(e&&e.time)-start);return Number.isFinite(distance)&&distance<1.8?Math.max(best,clamp(Number(e.strength)||0.35,0,1)*(1-distance/1.8)):best;},0);
  const audioNearEnd=(audioEvents||[]).reduce((best,e)=>{const distance=Math.abs(Number(e&&e.time)-end);return Number.isFinite(distance)&&distance<1.8?Math.max(best,clamp(Number(e.strength)||0.35,0,1)*(1-distance/1.8)):best;},0);
  const questionOpening=opening.includes("?")||ft.some((x)=>["why","how","what","क्या","क्यों","कैसे"].includes(x));
  let score=clamp(ft.length/7,0,1)+(questionOpening?1.05:0)+clamp(curiosity/Math.max(2,t.length*0.055),0,1)*1.35+clamp(emotion/3,0,1)*0.75+clamp(questions/3,0,1)*0.5+clamp(contrast/2,0,1)*0.8+(t.some((x)=>/[0-9]/.test(x))?0.25:0)+(/[.!?।]$/.test(text.trim())?0.35:0)+clamp((density-0.8)/2.2,0,1)*0.55+startPause*0.45+endPause*0.2+visual*0.75+audioNearStart*0.45+audioNearEnd*0.15+clamp(payoff/2,0,1)*0.55;
  if(FILLER.has(firstToken))score-=0.7;if(contextless)score-=0.45;if(ft.length<3)score-=0.35;if(end-start<12)score-=0.35;if(end-start>65)score-=(end-start-65)/45;if(t.length<18)score-=0.3;
  const reasons=[];if(questionOpening)reasons.push("curiosity-led opening");if(curiosity>=2)reasons.push("curiosity-building language");if(emotion>=2)reasons.push("emotional language");if(contrast>0)reasons.push("contrast or turning point");if(visual>=0.25)reasons.push("visual change near opening");if(payoff>0)reasons.push("includes an outcome or payoff");if(audioNearStart>=0.3)reasons.push("audio pause near opening");if(startPause>=0.4)reasons.push("natural speech boundary");if(!reasons.length)reasons.push("transcript flow and speech boundaries");
  return {title:text.length>72?text.slice(0,69).trim()+"...":text,hookReason:reasons.slice(0,3).join("; "),startTime:Number(start.toFixed(2)),endTime:Number(end.toFixed(2)),score,signals:{curiosity,emotion,questions,contrast,visual}};
}
function createFallbackHooks(words,numClips,videoDuration,signalOptions) {
  const all=normalizeWords(words);if(!all.length)throw new Error("No timestamped words are available for hook detection.");
  const count=clamp(Number(numClips)||6,1,7), startTime=Math.max(0,all[0].start), lastEnd=all[all.length-1].end;
  const endTime=Number.isFinite(Number(videoDuration))&&Number(videoDuration)>0?Math.min(Number(videoDuration),lastEnd):lastEnd;
  if(endTime-startTime<10)throw new Error("The spoken portion is too short to create a 10-second clip.");
  const visuals=Array.isArray(signalOptions&&signalOptions.visualEvents)?signalOptions.visualEvents.slice(0,24):[], audioEvents=Array.isArray(signalOptions&&signalOptions.audioEvents)?signalOptions.audioEvents.slice(0,80):[], pauseEvents=pauses(all), map=new Map();
  const lengths=[15,22,30,40,52].filter((n)=>n<=endTime-startTime);if(!lengths.length)lengths.push(Math.min(10,endTime-startTime));
  const step=Math.max(2.5,Math.min(8,(endTime-startTime)/100));
  let startIndex=0;
  for(let start=startTime;start<=endTime-10;start+=step){
    while(startIndex<all.length&&all[startIndex].end<=start)startIndex++;
    if(startIndex>=all.length)break;
    const first=all[startIndex];
    for(const length of lengths){
      const limit=Math.min(endTime,start+length);
      let endIndex=startIndex;
      while(endIndex<all.length&&all[endIndex].start<limit)endIndex++;
      if(endIndex<=startIndex)continue;
      const last=all[endIndex-1];
      if(last.end<=first.start)continue;
      const s=Math.max(startTime,first.start-0.08),e=Math.min(endTime,last.end+0.18);
      if(e-s<10||e-s>90)continue;
      const segment=all.slice(startIndex,endIndex).filter((w)=>w.start>=s&&w.end<=e);
      const candidate=scoreWindow(segment,all,s,e,visuals,audioEvents,pauseEvents);
      if(!candidate)continue;
      const key=Math.round(s/2)+":"+Math.round(e/2),old=map.get(key);
      if(!old||candidate.score>old.score)map.set(key,candidate);
    }
  }
  const ranked=Array.from(map.values()).sort((a,b)=>b.score-a.score),selected=[];
  for(const c of ranked){const overlap=selected.some((x)=>{const inter=Math.max(0,Math.min(c.endTime,x.endTime)-Math.max(c.startTime,x.startTime));return inter/Math.max(0.01,Math.min(c.endTime-c.startTime,x.endTime-x.startTime))>0.58;});if(!overlap)selected.push(c);if(selected.length>=count)break;}
  if(selected.length<count){
    for(const c of ranked){
      if(selected.some((x)=>Math.abs(x.startTime-c.startTime)<8))continue;
      const tooSimilar=selected.some((x)=>{
        const inter=Math.max(0,Math.min(c.endTime,x.endTime)-Math.max(c.startTime,x.startTime));
        const ratio=inter/Math.max(0.01,Math.min(c.endTime-c.startTime,x.endTime-x.startTime));
        return ratio>0.82;
      });
      if(tooSimilar)continue;
      selected.push(c);
      if(selected.length>=count)break;
    }
  }
  if(!selected.length){const len=Math.min(30,endTime-startTime);for(let i=0;i<count;i++){const s=startTime+i*Math.max(0,endTime-startTime-len)/Math.max(1,count-1),first=all.find((w)=>w.end>s);let last=null;for(let j=all.length-1;j>=0;j--){if(all[j].start<s+len){last=all[j];break;}}if(first&&last&&last.end-first.start>=10){const segment=all.filter((w)=>w.start>=first.start&&w.end<=last.end),text=textOf(segment);selected.push({title:text.slice(0,72),hookReason:"Distinct speech segment; no strong semantic cues were detected.",startTime:first.start,endTime:last.end,score:0,signals:{}});}}}
  return selected.sort((a,b)=>a.startTime-b.startTime).map(({score,signals,...item})=>item);
}
async function detectHookSegments(transcript,numClips,videoDuration,words,signalOptions) {
  if(typeof transcript!=="string"||!transcript.trim())throw new Error("Transcript is required for hook detection.");
  const started=Date.now(),hooks=createFallbackHooks(words,numClips||6,videoDuration,signalOptions||{});
  console.log("[Hooks] Local multi-signal ranking selected "+hooks.length+" clips in "+(Date.now()-started)+"ms; visualEvents="+(Array.isArray(signalOptions&&signalOptions.visualEvents)?signalOptions.visualEvents.length:0)+" audioEvents="+(Array.isArray(signalOptions&&signalOptions.audioEvents)?signalOptions.audioEvents.length:0));
  return hooks;
}
function extractJson(text){return JSON.parse(String(text||"").trim());}
module.exports={detectHookSegments,extractJson,createFallbackHooks};
