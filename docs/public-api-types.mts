// Purpose: Compile-check representative public API usage.
import { validatePolicy, createFakeProvider, runPolicy, wilson, type Policy } from '../src/index.mjs';
const policy={} as Policy;validatePolicy(policy);const p=createFakeProvider(()=>({type:'noul',noul:.5}));const run=await runPolicy('/tmp/x',policy,{provider:p,budgetUsd:1});const low:number=wilson(2,3).low;void[run,low];
