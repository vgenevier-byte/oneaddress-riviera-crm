import type { FonciereData } from './model';
import { validateRentalPlan, type RentalPlan } from './rentals';
export type RentalMergeConflict = { local: RentalPlan | null; remote: RentalPlan | null };
/** Three-way merge. Arrays are atomic; rental references and scenarios are dependent. */
export function mergeProjectDraft(base: FonciereData, local: FonciereData, remote: FonciereData) {
  const conflicts: string[] = [];
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  function merge(a: unknown, b: unknown, c: unknown, path: string): unknown {
    if (equal(a, b)) return c;
    if (equal(a, c) || equal(b, c)) return b;
    if (a && b && c && typeof a === 'object' && typeof b === 'object' && typeof c === 'object' && !Array.isArray(a) && !Array.isArray(b) && !Array.isArray(c)) {
      const aa=a as Record<string,unknown>, bb=b as Record<string,unknown>, cc=c as Record<string,unknown>;
      return Object.fromEntries([...new Set([...Object.keys(aa),...Object.keys(bb),...Object.keys(cc)])].map(k=>[k,merge(aa[k],bb[k],cc[k],path?path+'.'+k:k)]).filter(([,v])=>v!==undefined));
    }
    conflicts.push(path); return b;
  }
  const data = merge(base, local, remote, '') as FonciereData;
  let rentalConflict: RentalMergeConflict | null = null;
  let validationError = '';
  try { validateRentalPlan(data.rentalPlan); }
  catch (error) {
    if (!equal(local.rentalPlan, base.rentalPlan) && !equal(remote.rentalPlan, base.rentalPlan)) {
      rentalConflict={local:structuredClone(local.rentalPlan),remote:structuredClone(remote.rentalPlan)};
      // Keep the local candidate on screen, but require an explicit version choice.
      data.rentalPlan=structuredClone(local.rentalPlan);
      conflicts.push('rentalPlan.scenarios/referenceId');
    }
    validationError=error instanceof Error?error.message:'Invalid reconciled rental plan';
  }
  return {data,conflicts,rentalConflict,validationError};
}
