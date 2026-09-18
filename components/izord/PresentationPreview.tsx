"use client";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectData } from "@/lib/izord/model";
import { presentationSlides, presentationMaps, renderedFont, photoSlideEnabled, preparedPhotos, photoLayout, photoCaption, galleryHeaderTexts, type SlideSpec } from "@/lib/izord/presentation";
import type { PreparedPhoto } from "@/lib/izord/presentation-layout";
import styles from "./IzordGenerator.module.css";

function Shape({spec,text,data}:{spec:SlideSpec;text?:string;data:ProjectData}) {
  const position={left:spec.x,top:spec.y,width:spec.w,height:spec.h};
  if(spec.kind==="image")return <Image className={styles.slidePart} src={data.photos[spec.role]} width={spec.w} height={spec.h} unoptimized alt={spec.role} style={position}/>;
  if(spec.kind==="rect")return <div className={styles.slidePart} style={{...position,background:spec.fill}}/>;
  const value=text??spec.text;
  return <div className={styles.slidePart} style={{...position,fontFamily:spec.font,fontSize:renderedFont(spec,value),fontWeight:spec.bold?700:400,color:spec.color,textAlign:spec.align,lineHeight:spec.line}}>{value}</div>;
}
/** Native source slide specifications and optional native photo-layout coordinates. */
export default function PresentationPreview({data}:{data:ProjectData}) {
  const host=useRef<HTMLDivElement>(null), [scale,setScale]=useState(0.5), [items,setItems]=useState<PreparedPhoto[]>([]);
  useEffect(()=>{const element=host.current;if(!element)return;const observer=new ResizeObserver(entries=>{setScale(entries[0].contentRect.width/960);});observer.observe(element);return()=>observer.disconnect();},[]);
  const photoInput=useMemo(()=>({photos:data.photos,importGallery:data.importGallery,photoGalleryRoles:data.photoGalleryRoles}),[data.photos,data.importGallery,data.photoGalleryRoles]);
  useEffect(()=>{
    const controller=new AbortController();
    // Preparation only reads these photo fields; it never mutates the project.
    void preparedPhotos(photoInput as ProjectData,controller.signal).then(value=>{if(!controller.signal.aborted)setItems(value);}).catch(()=>{if(!controller.signal.aborted)setItems([]);});
    return()=>controller.abort();
  },[photoInput]);
  const maps=presentationMaps(data.state),headers=galleryHeaderTexts(data.state,items.length);
  return <div data-presentation-preview><div className={styles.previewGrid}>{presentationSlides.map((specs,index)=><div key={index}><div className={styles.previewHost} ref={index===0?host:undefined}><div className={styles.slide} style={{transform:`scale(${scale})`}}>{specs.map((spec,i)=><Shape key={i} spec={spec} text={maps[index][spec.id]} data={data}/>)}</div></div><p className={styles.muted}>{index===0?"01 — LE BIEN":"02 — L’OPÉRATION"}</p></div>)}
  {photoSlideEnabled(data)&&<div><div className={styles.previewHost}><div className={styles.slide} style={{transform:`scale(${scale})`}}>{presentationSlides[1].filter(spec=>spec.id>=3&&spec.id<=12).map((spec,i)=><Shape key={i} spec={spec} text={headers[spec.id]} data={data}/>)}{photoLayout(items).map(cell=><div key={cell.index}><Image className={styles.slidePart} src={items[cell.index].data} unoptimized width={cell.w} height={cell.h} alt={items[cell.index].label} style={{left:cell.x,top:cell.y,width:cell.w,height:cell.h,objectFit:"contain"}}/><div className={styles.slidePart} style={{left:cell.x,top:cell.captionY,width:cell.w,height:cell.captionH,fontSize:cell.font,fontFamily:"Arial",color:"#667681"}}>{photoCaption(items[cell.index],cell.index)}</div></div>)}</div></div><p className={styles.muted}>03 — PHOTOTHÈQUE DU BIEN · {items.length} photos</p></div>}</div></div>;
}
