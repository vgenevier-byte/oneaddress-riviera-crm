/** Ported from the audited v3 native generator; formulas, mappings and geometry retained. */
import type { SlideTextSpec } from "./presentation-assets";
import type { ProjectState, GalleryPhoto } from "./model";
export type PreparedPhoto = GalleryPhoto & {width:number;height:number};
export type PhotoCell = {index:number;x:number;y:number;w:number;h:number;captionY:number;captionH:number;font:number};
export function renderedFont(spec: SlideTextSpec,text: unknown){if(typeof document === "undefined")return spec.size; const fitContext=document.createElement("canvas").getContext("2d"); if(!fitContext)throw new Error("Mesure typographique indisponible."); let size=spec.size;if(spec.id===32&&String(text).includes('\n')){spec={...spec,size:13.8};size=13.8;}const longest=Math.max(...String(text).split('\n').map(s=>s.length));if(spec.id===13&&spec.font==='Georgia'&&longest>42)size=25;if([15,20,24,28,32,36,51,54].includes(spec.id)&&spec.size>=23&&longest>13)size=Math.min(size,20);const min=Math.max(6.3,spec.size*.65);function linesAt(sz: number){fitContext!.font=(spec.bold?'bold ':'')+sz+'px '+spec.font;let lines=0;for(const para of String(text).split('\n')){let line='';for(const word of para.split(' ')){const next=line?line+' '+word:word;if(line&&fitContext!.measureText(next).width>spec.w-1){lines++;line=word;}else line=next;}lines++;}return lines;}while(size>min&&linesAt(size)*size*(spec.line||1.1)>spec.h+1)size=Math.max(min,size-.3);return size;}
export function photoLayout(items: PreparedPhoto[]): PhotoCell[]{
  const box={x:40.32,y:164,w:879.12,h:337};
  const n=items.length;if(!n)return [];
  const gx=n>36?6:10,gy=n>36?8:13,cap=n>40?10:n>18?12:15;
  let best: {raw: {start:number;count:number;h:number}[];scale:number;score:number}|null=null;
  const ratios=items.map(p=>Math.max(.08,Math.min(20,p.width/p.height)));
  for(let rows=1;rows<=Math.min(n,Math.ceil(Math.sqrt(n)*1.8)+1);rows++){
    const counts=Array.from({length:rows},(_,r)=>Math.floor(n/rows)+(r>=rows-n%rows?1:0));
    let start=0,raw=[],sumH=0;
    for(const count of counts){
      const sum=ratios.slice(start,start+count).reduce((a,b)=>a+b,0);
      const h=Math.max(1,(box.w-(count-1)*gx)/sum);
      raw.push({start,count,h});start+=count;sumH+=h;
    }
    const scale=Math.min(1,Math.max(.001,(box.h-rows*cap-(rows-1)*gy)/sumH));
    let area=0;for(const row of raw)for(let j=row.start;j<row.start+row.count;j++)area+=ratios[j]*(row.h*scale)**2;
    const smallest=Math.min(...raw.map(r=>r.h*scale));
    const score=area*(smallest<30?.88:1);
    if(!best||score>best.score)best={raw,scale,score};
  }
  if(!best)return [];
  const chosen=best;
  const totalH=chosen.raw.reduce((s,r)=>s+r.h*chosen.scale+cap,0)+(chosen.raw.length-1)*gy;
  let y=box.y+(box.h-totalH)/2;const cells=[];
  for(const row of chosen.raw){
    const h=row.h*chosen.scale;
    const rowW=ratios.slice(row.start,row.start+row.count).reduce((s,r)=>s+r*h,0)+(row.count-1)*gx;
    let x=box.x+(box.w-rowW)/2;
    for(let j=row.start;j<row.start+row.count;j++){
      const w=ratios[j]*h;
      cells.push({index:j,x,y,w,h,captionY:y+h+2,captionH:cap-2,font:n>40?6.7:n>18?7.5:8.5});
      x+=w+gx;
    }
    y+=h+cap+gy;
  }
  return cells;
}
export function photoCaption(p: GalleryPhoto,index: number){return String(index+1).padStart(2,'0')+'  ·  '+(p.page?'p. '+p.page:p.source==='Photo de synthèse'?'Synthèse':'Ajout manuel');}
export function galleryHeaderTexts(state: ProjectState,count: number): Record<number,string>{return {
  7:'PHOTOTHÈQUE DU BIEN  •  ANNEXE FACULTATIVE',
  9:'IZORD INVEST  ·  CÔTE D’AZUR  ·  PHOTOGRAPHIES DU DOSSIER',
  10:'03',11:'Photothèque du bien',
  12:(state.project||'Projet à renseigner')+'  |  '+count+' photo'+(count>1?'s':'')+' disponible'+(count>1?'s':'')
};}
