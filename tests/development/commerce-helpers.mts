import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommerceKernel } from '../../packages/commerce/kernel.mts';

export function commerceFixture() {
  const directory=mkdtempSync(join(tmpdir(),'rifare-commerce-'));
  const filename=join(directory,'fixture.sqlite'); const db=new DatabaseSync(filename);chmodSync(filename,0o600);
  let now=Date.UTC(2026,0,15,12);
  const kernel=new CommerceKernel(db,()=>now);
  const make=(tenant:string,store:string) => {
    kernel.provisionStore(tenant,store);kernel.provisionMember(tenant,store,'operator');kernel.provisionMember(tenant,store,'worker','worker');
    const bearer=kernel.issueSession(tenant,store,'operator'); const workerBearer=kernel.issueSession(tenant,store,'worker');
    return {tenant,store,bearer,scope:kernel.authenticate(bearer),workerBearer,worker:kernel.authenticate(workerBearer)};
  };
  const a=make('tenant-a','store-a'), b=make('tenant-b','store-b'),c=make('tenant-a','store-c');
  const seed=(scope:any,value='alpha',external='ORD-1001') => kernel.ingest(scope,{kind:'order',source_system:'synthetic',external_id:external,
    source_version:1,source_updated_at:now,customer_id:'C-1001',payload:{label:value,total_minor:value==='alpha'?12500:6400,status:'processing'}});
  return {kernel,db,directory,filename,a,b,c,seed,now:()=>now,advance:(ms:number)=>{now+=ms;},
    cleanup:()=>{db.close();rmSync(directory,{recursive:true,force:true});}};
}
