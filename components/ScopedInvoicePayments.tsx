"use client";
import { moduleMessage } from "@/lib/i18n/moduleMessage";
import { useI18n } from "@/lib/i18n/I18nProvider";
import {useState,useRef} from 'react';
import {useScopedOperations,isCancelled} from '@/lib/access/operations';
import {maskIban} from '@/lib/vendorBanking';
import type {Contact,VendorInvoice,VendorBankAccount} from '@/lib/types';
export default function ScopedInvoicePayments({invoices,revision,onResult}:{invoices:VendorInvoice[];revision:string;onResult:(v:unknown)=>void}){
  const {t} = useI18n();

 const begin=useScopedOperations('vendorInvoices'),[invoice,setInvoice]=useState(''),[accounts,setAccounts]=useState<VendorBankAccount[]>([]),[account,setAccount]=useState(''),[message,setMessage]=useState('');
 const selection=useRef(0);
 return <section className="card"><h2>{t("modules.scopedInvoicePayments.prepareAPayment")}</h2><p>{t("modules.scopedInvoicePayments.explicitlyChooseAVerifiedAccountNoTransferIsMade")}</p><label>{t("modules.scopedInvoicePayments.invoice")}<select value={invoice} onChange={async e=>{const turn=++selection.current;const id=e.target.value;setInvoice(id);setAccount('');setAccounts([]);try{const op=await begin();const r=await op.run(()=>op.client.rpc('crm_read_module',{p_module:'contacts'}));if(r.error)throw r.error;const supplier=(r.data.collections.contacts as Contact[]).find(c=>c.id===invoices.find(i=>i.id===id)?.contactId);if(turn!==selection.current)return;setAccounts(supplier?.supplierBankAccounts?.filter(a=>a.status==='Vérifié')??[]);}catch(e){if(!isCancelled(e))setMessage('Comptes bancaires non accessibles.');}}}><option value="">{t("modules.scopedDocuments.choose")}</option>{invoices.map(i=><option value={i.id} key={i.id}>{i.title}</option>)}</select></label><label>{t("modules.vendorBanking.verifiedAccount")}<select value={account} onChange={e=>setAccount(e.target.value)}><option value="">{t("modules.scopedInvoicePayments.chooseExplicitly")}</option>{accounts.map(a=><option value={a.id} key={a.id}>{a.accountHolder} · {maskIban(a.iban)}{a.isPrimary?t("modules.vendorBanking.primary"):''}</option>)}</select></label><button disabled={!account||!invoice} onClick={async()=>{if(!window.confirm(t("modules.scopedInvoicePayments.preparePaymentUsingTheSelectedAccount")))return;try{const op=await begin();const r=await op.run(()=>op.client.rpc('crm_prepare_payment',{p_invoice:invoice,p_account:account,p_revision:revision}));if(r.error)throw r.error;await op.check();onResult(r.data);setMessage('Compte de paiement confirmé. Aucun virement émis.');}catch(e){if(!isCancelled(e))setMessage('Paiement non préparé : vérifiez le compte et la révision.');}}}>{t("modules.vendorBanking.preparePayment")}</button>{message&&<p role="status">{moduleMessage(message, t)}</p>}</section>;
}
