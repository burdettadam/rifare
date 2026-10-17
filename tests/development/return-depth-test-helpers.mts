import {startCommerceServer} from '../../apps/commerce-api/server.mts';
export async function withDepthServer(f:any,sources:any,fn:(post:any,app:any)=>unknown){
 const logs:any[]=[],app=await startCommerceServer({kernel:f.kernel,caps:f.caps,customers:f.customers,simulator:f.simulator,...sources,log:r=>logs.push(r)});
 try{return await fn(async(op:string,value:any,bearer:string|null=f.a.bearer)=>{const r=await fetch(app.url+'/v1/return-depth/'+op,{method:'POST',headers:{'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},body:JSON.stringify(value)});return {status:r.status,body:await r.json()};},{...app,logs});}
 finally{await app.close();}
}
