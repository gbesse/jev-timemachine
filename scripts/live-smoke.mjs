// Purpose: Opt-in synthetic smoke test making one paid Jev request and printing usage and estimated cost.
import { createJevClient } from '../src/jev-client.mjs'; import { estimateCostUsd } from '../src/index.mjs';
const provider=createJevClient();const result=await provider({model:'jev-1.13.0',state:{text:'Synthetic urgent support request.'},questions:{urgent:{type:'noul',instructions:'This request needs prompt human review.'}}});console.log(JSON.stringify({...result,estimated_cost_usd:estimateCostUsd(result.usage.input_tokens)},null,2));
