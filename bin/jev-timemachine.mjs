#!/usr/bin/env node
// Purpose: CLI for importing history, estimating/running policies, diffing versions and replaying stored probabilities.
import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { createJevClient, createFakeProvider } from '../src/jev-client.mjs';
import { importItems, estimateRun, runPolicy, diffPolicies, whatIf, sweep, timeline, htmlReport } from '../src/index.mjs';
const usage = 'Usage: jev-timemachine <import|estimate|run|diff|whatif|timeline|report> ... --store <dir>';
function args(argv) { const positionals=[],$={}; for(let i=0;i<argv.length;i++){if(argv[i].startsWith('--')){const k=argv[i].slice(2);$[k]=argv[i+1]?.startsWith('--')||argv[i+1]===undefined?true:argv[++i];}else positionals.push(argv[i]);} return {positionals,$}; }
const load = async path => JSON.parse(await readFile(path,'utf8'));
function parseCsv(text){const [head,...rows]=text.trim().split(/\r?\n/).map(line=>line.split(','));return rows.map(row=>Object.fromEntries(head.map((key,i)=>[key,row[i]])));}
async function main(){const {positionals,$}=args(process.argv.slice(2));const [cmd,...rest]=positionals;if(!cmd||cmd==='help'||cmd==='--help'){console.log(usage);return;}const store=$.store??'.jev-timemachine';
 if(cmd==='import'){const text=await readFile(rest[0],'utf8');const rows=extname(rest[0])==='.csv'?parseCsv(text):text.split('\n').filter(Boolean).map(JSON.parse);console.log(await importItems(store,rows,{id:$.id??'id',text:$.text??'text',time:$.time??'occurred_at',meta:typeof $.meta==='string'?[$.meta]:[]}));return;}
 const fake=$.fake?createFakeProvider((state,id,q)=>q.type==='noul'?{type:'noul',noul:state.text.includes('urgent')?.9:.2}:q.type==='choice'?{type:'choice',choice:Object.keys(q.criteria)[0],probabilities:Object.fromEntries(Object.keys(q.criteria).map((k,i)=>[k,i?0:1])),confidence:1}:{type:'score',score:0,probabilities:{0:1},confidence:1}):createJevClient();
 if(cmd==='estimate'){console.log(await estimateRun(store,await load(rest[0]),{from:$.from,to:$.to}));return;}
 if(cmd==='run'){console.log(await runPolicy(store,await load(rest[0]),{provider:fake,from:$.from,to:$.to,budgetUsd:$['budget-usd']?Number($['budget-usd']):Infinity}));return;}
 if(cmd==='diff'){console.log(await diffPolicies(store,await load(rest[0]),await load(rest[1]),{provider:fake,from:$.from,to:$.to,examples:Number($.examples??5)}));return;}
 if(cmd==='whatif'||cmd==='timeline'){const pack=await load(rest[0]),run=await load(rest[1]);if(cmd==='timeline')console.log(timeline(run,$.bucket??'month'));else if($.sweep){const [id,spec]=$.sweep.split('=');const [a,b,s]=spec.split(':').map(Number);console.log(sweep(pack,run,id,a,b,s));}else{const [id,v]=$.threshold.split('=');console.log(whatIf(pack,run,{[id]:Number(v)}));}return;}
 if(cmd==='report'){const data=await load(rest[0]);await writeFile($.html,htmlReport(data));console.log(`Wrote ${$.html}`);return;}throw new Error(usage);}
main().catch(error=>{console.error(`jev-timemachine: ${error.message}`);process.exit(1)});
