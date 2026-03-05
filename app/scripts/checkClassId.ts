import { loadContractArtifact } from '@aztec/stdlib/abi';
import { getContractClassFromArtifact } from '@aztec/stdlib/contract';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  // Load same way the app does (loadNargoArtifact)
  const raw = JSON.parse(readFileSync(resolve(__dirname, '../src/lib/aztec/artifacts/DuelCloak.json'), 'utf-8'));
  raw.transpiled = true;
  const artifact = loadContractArtifact(raw);
  const contractClass = await getContractClassFromArtifact(artifact);
  console.log('App artifact class ID:', contractClass.id.toString());

  // Load same way the deploy script does
  const raw2 = JSON.parse(readFileSync(resolve(__dirname, '../../contracts/target/duel_cloak-duel_cloak.json'), 'utf-8'));
  raw2.transpiled = true;
  // Strip names like loadArtifact does
  if (raw2.functions) {
    for (const fn of raw2.functions) {
      if (fn.name?.startsWith('__aztec_nr_internals__')) {
        fn.name = fn.name.replace('__aztec_nr_internals__', '');
      }
    }
  }
  const artifact2 = loadContractArtifact(raw2);
  const contractClass2 = await getContractClassFromArtifact(artifact2);
  console.log('Target artifact class ID:', contractClass2.id.toString());

  console.log('\nExpected (deployed):', '0x26c45dd43f8caaf43957496963330de1a5020c246dd72c56421b05ffbed5c336');
  console.log('Match app?', contractClass.id.toString() === '0x26c45dd43f8caaf43957496963330de1a5020c246dd72c56421b05ffbed5c336');
  console.log('Match target?', contractClass2.id.toString() === '0x26c45dd43f8caaf43957496963330de1a5020c246dd72c56421b05ffbed5c336');
}

main().catch((err) => { console.error(err); process.exit(1); });
