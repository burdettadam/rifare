import { assertRecoveryEgress } from './data-guards.mts';
import { timingSafeEqual } from 'node:crypto';
import { CommerceKernel, digest, exact, id, token } from './kernel.mts';
import type { Row } from './kernel.mts';

export type ProofDelivery = Readonly<{destination:string;challenge_id:string;proof:string;store_id:string}>;
export function email(value: unknown): string {
  if (typeof value!=='string' || value.length>254 || !/^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$/.test(value)) throw new Error('INVALID_INPUT');
  return value.trim().toLowerCase();
}

export class CustomerAccess {
  #kernel: CommerceKernel;
  #deliver: (proof:ProofDelivery)=>void;
  constructor(kernel: CommerceKernel, deliver: (proof:ProofDelivery)=>void) { this.#kernel=kernel;this.#deliver=deliver; }
  #owner(tenant:string,store:string,resource:string): Row | null {
    const db=this.#kernel.db;
    const order=db.prepare(`SELECT r.* FROM commerce_resources r JOIN commerce_stores s USING(tenant_id,store_id)
      WHERE r.tenant_id=? AND r.store_id=? AND r.id=? AND r.kind='order' AND s.active=1`).get(tenant,store,resource) as Row;
    if (!order?.customer_id) return null;
    const customer=db.prepare(`SELECT * FROM commerce_resources WHERE tenant_id=? AND store_id=? AND kind='customer'
      AND source_system=? AND external_id=?`).get(tenant,store,order.source_system,order.customer_id) as Row;
    if (!customer) return null;
    try {
      const address=email(JSON.parse(customer.payload).email);
      return {order,customer,address,owner_hash:digest(JSON.stringify([customer.id,customer.source_version,address]))};
    } catch {return null;}
  }
  #limited(bucket:string,max:number) {
    const k=this.#kernel, now=k.clock(), db=k.db;
    const row=db.prepare('SELECT * FROM commerce_challenge_rates WHERE bucket=?').get(bucket) as Row;
    if (!row || row.window_start<=now-600000) {
      db.prepare(`INSERT INTO commerce_challenge_rates VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET window_start=excluded.window_start,count=1`).run(bucket,now);
      return false;
    }
    db.prepare('UPDATE commerce_challenge_rates SET count=count+1 WHERE bucket=?').run(bucket);
    return row.count>=max;
  }
  request(input:unknown, clientAddress:string) {
    assertRecoveryEgress(this.#kernel);
    const r=exact(input,['store_id','order_number','email']);id(r.store_id);id(r.order_number);
    const address=email(r.email); if (typeof clientAddress!=='string'||!clientAddress||clientAddress.length>128) throw new Error('INVALID_INPUT');
    const k=this.#kernel, db=k.db, now=k.clock();const challenge='chal_'+token(), proof=token();
    let delivery: ProofDelivery | undefined;
    k.transaction(()=>{
      const clientLimited=this.#limited(digest('client:'+clientAddress),20);
      if(clientLimited) return;
      const targetLimited=this.#limited(digest(JSON.stringify(['target',r.store_id,r.order_number,address])),3);
      if (targetLimited) return;
      const rows=db.prepare(`SELECT r.* FROM commerce_resources r JOIN commerce_stores s USING(tenant_id,store_id)
        WHERE r.store_id=? AND r.kind='order' AND r.external_id=? AND s.active=1 LIMIT 2`).all(r.store_id,r.order_number) as Row[];
      const owner=rows.length===1?this.#owner(rows[0].tenant_id,r.store_id,rows[0].id):null;
      const match=owner && owner.address===address;
      db.prepare('INSERT INTO commerce_challenges VALUES(?,?,?,?,?,?,?,?,0,0)')
        .run(challenge,digest(challenge+':'+proof),match?owner.order.tenant_id:null,r.store_id,
          match?owner.order.id:null,match?owner.order.customer_id:null,match?owner.owner_hash:digest(token()),now+300000);
      if(match) delivery=Object.freeze({destination:owner.address,challenge_id:challenge,proof,store_id:r.store_id});
    });
    if(delivery) {
      try { this.#deliver(delivery); }
      catch {db.prepare('UPDATE commerce_challenges SET consumed=1 WHERE id=?').run(challenge);}
    }
    return {accepted:true,challenge_id:challenge,expires_in:300};
  }
  complete(input:unknown) {
    let r:Row;
    try {r=exact(input,['store_id','challenge_id','proof']);id(r.store_id);id(r.challenge_id);
      if(typeof r.proof!=='string'||r.proof.length>512) throw new Error('INVALID_INPUT');
    } catch {throw new Error('VERIFICATION_FAILED');}
    const k=this.#kernel,db=k.db,now=k.clock();
    const result=k.transaction(()=>{
      const row=db.prepare('SELECT * FROM commerce_challenges WHERE id=?').get(r.challenge_id) as Row;
      if(!row||row.consumed||row.attempts>=5||row.expires_at<=now) return null;
      db.prepare('UPDATE commerce_challenges SET attempts=attempts+1 WHERE id=?').run(row.id);
      const supplied=Buffer.from(digest(row.id+':'+r.proof),'hex'),expected=Buffer.from(row.proof_hash,'hex');
      if(row.store_id!==r.store_id||expected.length!==supplied.length||!timingSafeEqual(supplied,expected)||!row.resource_id) return null;
      const owner=this.#owner(row.tenant_id,row.store_id,row.resource_id);
      if(!owner||owner.owner_hash!==row.owner_hash||owner.order.customer_id!==row.customer_id) return null;
      const bearer=token(), expires=now+900000;
      db.prepare('UPDATE commerce_challenges SET consumed=1 WHERE id=?').run(row.id);
      db.prepare('INSERT INTO commerce_sessions VALUES(?,?,?,?,?,?,?,?,?,0)')
        .run(digest(bearer),row.tenant_id,row.store_id,row.customer_id,'customer',row.resource_id,row.customer_id,expires,now);
      return {token:bearer,expires_at:expires,resource_id:row.resource_id,operations:['order.read']};
    });
    if(!result) throw new Error('VERIFICATION_FAILED');return result;
  }
}
