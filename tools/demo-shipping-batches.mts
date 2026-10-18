import { shippingFixture } from '../tests/development/shipping-helpers.mts';
const f=shippingFixture();
try{
  const q=f.approved();f.source.setFault('purchase','package-b','after');
  const partial=await f.labels.purchase(f.a.scope,q),repaired=await f.labels.purchase(f.a.scope,q);
  f.packed();const manifested=await f.manifests.create(f.a.scope,{manifest_id:'demo-manifest',package_ids:['package-a','package-b']});
  f.source.recordEvent({manifest_id:'demo-manifest',package_id:'package-a',event_id:'demo-pickup',sequence:1,stage:'pickup',at:f.now()});
  f.source.recordEvent({manifest_id:'demo-manifest',package_id:'package-a',event_id:'demo-accepted',sequence:2,stage:'carrier_acceptance',at:f.now()});
  const carrier=await f.manifests.observe(f.a.scope,'demo-manifest');
  console.log(JSON.stringify({partial,repaired,manifested,carrier,source_ledger:f.source.ledger(),qualification:'synthetic_only',carrier_connected:false,financial_effect:false,physical_qualified:false,formal_goal_accepted:false},null,2));
}finally{f.cleanup();}
