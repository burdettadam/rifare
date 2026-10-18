import {readFileSync,lstatSync} from 'node:fs';
import {buildCompatibilityMatrix} from '../packages/conformance/compatibility-matrix.mts';
import {exact} from '../packages/commerce/kernel.mts';

// Local report exporter. It never starts tests, a provider, an adapter or a job.
try{
 const args=process.argv.slice(2);let rows:unknown=[];
 if(args.length){
  if(args.length!==2||args[0]!=='--input')throw new Error('USAGE');
  const stat=lstatSync(args[1]);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw new Error('INPUT');
  const request=exact(JSON.parse(readFileSync(args[1],'utf8')),['schema_version','rows']);
  if(request.schema_version!==1)throw new Error('VERSION');rows=request.rows;
 }
 const report=buildCompatibilityMatrix(rows);console.log(JSON.stringify(report,null,2));
 if(report.catalog.status!=='source_pins_current'||report.rows.some(row=>row.status==='unsupported'))process.exitCode=1;
}catch{
 console.error('Compatibility export failed. Use: node --experimental-strip-types tools/compatibility-matrix.mts [--input FILE]');
 process.exitCode=2;
}
