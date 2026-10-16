// The caller supplies an authenticated transport. No database, approval, model thread,
// or provider credential enters this portable instruction executor.
export async function proposeReturnDraft(call:(path:string,body:unknown)=>Promise<any>,intent:unknown) {
  if(!intent||typeof intent!=='object'||Array.isArray(intent)||Object.keys(intent).sort().join(',')!=='case_id,request_key,resolution')throw new Error('INVALID_INTENT');
  const p=intent as Record<string,unknown>;
  if(!['refund','exchange'].includes(p.resolution as string)||!['case_id','request_key'].every(k=>typeof p[k]==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(p[k] as string)))throw new Error('INVALID_INTENT');
  const draft=await call('/v1/return-drafts/prepare',p);
  if(draft?.case_id!==p.case_id||draft?.financial_effect!==false||draft?.approval_required!==true||draft?.execution_authorized!==false)throw new Error('DRAFT_RESPONSE_INVALID');
  return draft;
}
