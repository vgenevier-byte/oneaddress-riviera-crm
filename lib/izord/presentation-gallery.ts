/** Optional third native slide: original geometry and editable images/captions. */
import type JSZip from "jszip";
import type { ProjectData } from "./model";
import { allPhotoItems, photoSize } from "./photos";
import { presentationSlides } from "./presentation-assets";
import { photoLayout, photoCaption, galleryHeaderTexts, renderedFont, type PreparedPhoto, type PhotoCell } from "./presentation-layout";
import { P,A,R,PKG,CT,VT,EP,parseXml,xmlText,part,setShapeText,replaceNote,emu,xesc,xmlElement,packageRelationship } from "./presentation-xml";
export function photoSlideEnabled(data: ProjectData) { return data.state.includePhotoSlide !== false && allPhotoItems(data).length > 0; }
export async function preparedPhotos(data: ProjectData,signal?: AbortSignal): Promise<PreparedPhoto[]> {
  const result: PreparedPhoto[] = [];
  // Decode sequentially: the source layout still receives all images, without
  // retaining hundreds of decoded bitmaps concurrently for a large phototheque.
  for (const photo of allPhotoItems(data)) { signal?.throwIfAborted(); result.push({...photo,...await photoSize(photo,signal)}); }
  return result;
}
function addPicture(doc: XMLDocument,tree: Element,p: PreparedPhoto,cell: PhotoCell,num: number,rid: string){
  const xml=`<p:pic xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:nvPicPr><p:cNvPr id="${num}" name="Photo ${cell.index+1}" descr="${xesc(p.label)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${emu(cell.x)}" y="${emu(cell.y)}"/><a:ext cx="${emu(cell.w)}" cy="${emu(cell.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></p:spPr></p:pic>`;
  tree.appendChild(xmlElement(doc,xml));
}
function addCaption(doc: XMLDocument,tree: Element,p: PreparedPhoto,cell: PhotoCell,num: number){
  const xml=`<p:sp xmlns:p="${P}" xmlns:a="${A}"><p:nvSpPr><p:cNvPr id="${num}" name="Légende ${cell.index+1}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(cell.x)}" y="${emu(cell.captionY)}"/><a:ext cx="${emu(cell.w)}" cy="${emu(cell.captionH)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" rIns="0" tIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="l"/><a:r><a:rPr lang="fr-FR" sz="${Math.round(cell.font*100)}"><a:solidFill><a:srgbClr val="667681"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${xesc(photoCaption(p,cell.index))}</a:t></a:r></a:p></p:txBody></p:sp>`;
  tree.appendChild(xmlElement(doc,xml));
}
export async function appendPhotoSlide(zip: JSZip,data: ProjectData,signal?: AbortSignal){
  const state=data.state;
  if(!photoSlideEnabled(data))return false;
  const items=await preparedPhotos(data,signal);if(!items.length)return false;
  const doc=parseXml(await part(zip,'ppt/slides/slide2.xml'));
  const tree=doc.getElementsByTagNameNS(P,'spTree')[0];
  for(const child of [...tree.children]){
    if(['nvGrpSpPr','grpSpPr'].includes(child.localName))continue;
    const nv=child.getElementsByTagNameNS(P,'cNvPr')[0];const sid=nv?Number(nv.getAttribute('id')):0;
    if(!nv||sid<3||sid>12)child.remove();
  }
  for(const tag of ['timing','transition','extLst']){
    for(const el of [...doc.documentElement.children])if(el.localName===tag)el.remove();
  }
  for(const [sid,text] of Object.entries(galleryHeaderTexts(state,items.length))){
    const spec=presentationSlides[1].find(s=>s.id===+sid);setShapeText(doc,sid,text,spec?.kind === "text"?renderedFont(spec,text):undefined);
  }
  const rels=parseXml(`<Relationships xmlns="${PKG}"/>`);
  const oldRels=parseXml(await part(zip,'ppt/slides/_rels/slide2.xml.rels'));
  const layout=[...oldRels.documentElement.children].find(r=>r.getAttribute('Type')?.endsWith('/slideLayout'));
  packageRelationship(rels,'rId1','slideLayout',layout?.getAttribute('Target') || (()=>{throw new Error('Disposition native absente.');})());
  packageRelationship(rels,'rId2','notesSlide','../notesSlides/notesSlide3.xml');
  let shapeId=20;
  for(const cell of photoLayout(items)){
    const p=items[cell.index],rid='rId'+(cell.index+3),media='izord_gallery_'+String(cell.index+1).padStart(3,'0')+'.jpg';
    signal?.throwIfAborted();
    zip.file('ppt/media/'+media,p.data.split(',')[1],{base64:true});
    packageRelationship(rels,rid,'image','../media/'+media);
    addPicture(doc,tree,p,cell,shapeId++,rid);addCaption(doc,tree,p,cell,shapeId++);
  }
  zip.file('ppt/slides/slide3.xml',xmlText(doc));zip.file('ppt/slides/_rels/slide3.xml.rels',xmlText(rels));
  const nd=parseXml(await part(zip,'ppt/notesSlides/notesSlide2.xml'));
  replaceNote(nd,'PHOTOTHÈQUE DU BIEN — ANNEXE FACULTATIVE\n'+(state.project||'Projet')+'\n'+items.length+' photographies. Toutes les photos disponibles dans la photothèque sont présentées, sans limite de sélection ; les doublons strictement identiques ne sont montrés qu’une fois.\nLes images sont des objets PowerPoint indépendants. Elles sont présentées intégralement, sans étirement ni recadrage. Les filigranes incorporés sont conservés.\nCette diapositive peut être supprimée ou masquée sans modifier les deux diapositives de synthèse.\nSources du dossier : '+(state.source||'À renseigner')+'\n\nINDEX DES PHOTOGRAPHIES\n'+items.map((p,i)=>String(i+1).padStart(2,'0')+' — '+p.label+(p.page?' — page '+p.page:'')+(p.source?' — '+p.source:'')).join('\n'));
  zip.file('ppt/notesSlides/notesSlide3.xml',xmlText(nd));
  const nr=parseXml(await part(zip,'ppt/notesSlides/_rels/notesSlide2.xml.rels'));
  for(const el of [...nr.documentElement.children])if(el.getAttribute('Type')?.endsWith('/slide'))el.setAttribute('Target','../slides/slide3.xml');
  zip.file('ppt/notesSlides/_rels/notesSlide3.xml.rels',xmlText(nr));
  const pr=parseXml(await part(zip,'ppt/_rels/presentation.xml.rels'));
  const nextRid='rId'+(Math.max(...[...pr.documentElement.children].map(x=>+((x.getAttribute('Id') || '').replace(/^rId/,''))||0))+1);
  packageRelationship(pr,nextRid,'slide','slides/slide3.xml');zip.file('ppt/_rels/presentation.xml.rels',xmlText(pr));
  const pres=parseXml(await part(zip,'ppt/presentation.xml'));
  const list=pres.getElementsByTagNameNS(P,'sldIdLst')[0];const sldId=pres.createElementNS(P,'p:sldId');
  sldId.setAttribute('id',String(Math.max(...[...list.children].map(x=>Number(x.getAttribute('id'))))+1));sldId.setAttributeNS(R,'r:id',nextRid);list.appendChild(sldId);
  zip.file('ppt/presentation.xml',xmlText(pres));
  const content=parseXml(await part(zip,'[Content_Types].xml'));
  for(const [name,type] of [['/ppt/slides/slide3.xml','slide'],['/ppt/notesSlides/notesSlide3.xml','notesSlide']]){
    const over=content.createElementNS(CT,'Override');over.setAttribute('PartName',name);over.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.presentationml.'+type+'+xml');content.documentElement.appendChild(over);
  }
  zip.file('[Content_Types].xml',xmlText(content));return true;
}
export async function updatePresentationMetadata(zip: JSZip){
  const pres=parseXml(await part(zip,'ppt/presentation.xml'));
  const count=pres.getElementsByTagNameNS(P,'sldId').length;
  pres.getElementsByTagNameNS(P,'sldSz')[0].setAttribute('type','screen16x9');zip.file('ppt/presentation.xml',xmlText(pres));
  if(!zip.file('docProps/app.xml'))return;
  const app=parseXml(await part(zip,'docProps/app.xml'));
  for(const [tag,value] of [['Slides',count],['Notes',count],['PresentationFormat','On-screen Show (16:9)']]){const el=app.getElementsByTagNameNS(EP,String(tag))[0];if(el)el.textContent=String(value);}
  const head=app.getElementsByTagNameNS(EP,'HeadingPairs')[0];if(head){const ints=head.getElementsByTagNameNS(VT,'i4');if(ints.length>1)ints[1].textContent=String(count);}
  const titles=app.getElementsByTagNameNS(EP,'TitlesOfParts')[0];if(titles){const vec=titles.getElementsByTagNameNS(VT,'vector')[0];vec.replaceChildren();const names=['Office Theme','Le bien','Acquisition, travaux & valorisation'];if(count===3)names.push('Photothèque du bien');for(const name of names){const el=app.createElementNS(VT,'vt:lpstr');el.textContent=name;vec.appendChild(el);}vec.setAttribute('size',String(names.length));}
  zip.file('docProps/app.xml',xmlText(app));
}
