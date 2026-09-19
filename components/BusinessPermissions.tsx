"use client";
import {createContext,useContext,type ComponentProps,type ReactNode,Children,isValidElement} from 'react';
import type {ModuleId} from '@/lib/access/modules';
export type BusinessPermissions={write:boolean;remove:boolean;export:boolean;read:(module:ModuleId)=>boolean;canWrite:(module:ModuleId)=>boolean;hiddenFields:string[];download:(path:string,name:string)=>Promise<void>;upload:(collection:string,id:string,file:File)=>Promise<string>;check:()=>Promise<void>;markDirty?:()=>void};
export const BusinessContext=createContext<BusinessPermissions|null>(null);
export const useBusinessPermissions=()=>useContext(BusinessContext);
export function BusinessForm({children,pending=false,...props}:ComponentProps<'form'>&{pending?:boolean}){const p=useBusinessPermissions();return <form {...props} aria-busy={pending}>{p&&!p.write&&props.onSubmit?<p className="muted-line">Lecture : la modification de ce module n’est pas autorisée.</p>:null}<fieldset className="business-form-fields" disabled={pending||(p?.write===false&&Boolean(props.onSubmit))}>{children}</fieldset></form>;}
function fields(node:ReactNode):string[]{return Children.toArray(node).flatMap(child=>{if(!isValidElement<{name?:string;children?:ReactNode}>(child))return [];return [...(child.props.name?[child.props.name]:[]),...fields(child.props.children)];});}
export function BusinessLabel({children,...props}:ComponentProps<'label'>){const p=useBusinessPermissions();if(p&&fields(children).some(f=>p.hiddenFields.includes(f)))return null;return <label {...props}>{children}</label>;}
export function BusinessButton({permission,disabled,...props}:ComponentProps<'button'>&{permission?:'write'|'remove'|'export'}){const p=useBusinessPermissions();const denied=Boolean(p&&permission&&!p[permission]);return <button {...props} disabled={disabled||denied} title={denied?'Action non autorisée par vos droits.':props.title}/>;}
export function BusinessSelect({disabled,...props}:ComponentProps<'select'>){const p=useBusinessPermissions();return <select {...props} disabled={disabled||p?.write===false}/>;}
