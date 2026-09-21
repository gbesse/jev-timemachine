// Purpose: Syntax-check every ESM JavaScript file without creating build output.
import { readdirSync } from 'node:fs'; import { join } from 'node:path'; import { execFileSync } from 'node:child_process';
function visit(dir){for(const e of readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git'].includes(e.name))continue;const p=join(dir,e.name);if(e.isDirectory())visit(p);else if(p.endsWith('.mjs'))execFileSync(process.execPath,['--check',p],{stdio:'inherit'});}}visit('.');console.log('JavaScript syntax checks passed');
