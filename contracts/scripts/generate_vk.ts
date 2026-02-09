/**
 * Generate verification keys for private functions in a contract artifact.
 *
 * This replaces the need for `aztec compile` (Docker) for VK generation.
 * Uses the local bb binary from @aztec/bb.js to generate VKs.
 *
 * Usage:
 *   npx ts-node scripts/generate_vk.ts <artifact-path>
 *
 * Example:
 *   npx ts-node scripts/generate_vk.ts target/cloak_registry-CloakRegistry.json
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BB_PATH = path.resolve(__dirname, '../node_modules/@aztec/bb.js/build/arm64-macos/bb');

async function main() {
  const artifactPath = process.argv[2];
  if (!artifactPath) {
    console.error('Usage: npx ts-node scripts/generate_vk.ts <artifact-path>');
    process.exit(1);
  }

  const fullPath = path.resolve(artifactPath);
  console.log(`Loading artifact: ${fullPath}`);
  const raw = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));

  // Ensure bb is executable
  try {
    fs.chmodSync(BB_PATH, '755');
  } catch {}

  let modified = false;

  for (const fn of raw.functions) {
    if (fn.custom_attributes?.includes('abi_private')) {
      console.log(`\nProcessing private function: ${fn.name}`);

      if (fn.verification_key) {
        console.log(`  Already has VK, skipping.`);
        continue;
      }

      // Write bytecode to temp file
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aztec-vk-'));
      const bytecodePath = path.join(tmpDir, 'bytecode');
      const vkDir = path.join(tmpDir, 'vk_out');

      // The bytecode is base64 encoded in the artifact
      const bytecodeBuffer = Buffer.from(fn.bytecode, 'base64');
      fs.writeFileSync(bytecodePath, bytecodeBuffer);
      fs.mkdirSync(vkDir, { recursive: true });

      try {
        // Use bb to generate VK
        console.log(`  Generating VK with bb...`);
        execSync(
          `"${BB_PATH}" write_vk -b "${bytecodePath}" -o "${vkDir}" --scheme chonk`,
          { stdio: 'pipe', timeout: 120000 }
        );

        // Find the VK file in the output directory
        const vkFiles = fs.readdirSync(vkDir);
        console.log(`  VK output files: ${vkFiles.join(', ')}`);

        // Look for the VK binary file
        const vkFile = vkFiles.find(f => f.includes('vk') || f.endsWith('.bin')) || vkFiles[0];
        if (!vkFile) throw new Error('No VK file found in output');

        const vkBuffer = fs.readFileSync(path.join(vkDir, vkFile));
        fn.verification_key = vkBuffer.toString('base64');
        modified = true;
        console.log(`  VK generated (${vkBuffer.length} bytes)`);
      } catch (err: any) {
        console.error(`  Failed to generate VK: ${err.message}`);
        if (err.stderr) console.error(`  stderr: ${err.stderr.toString()}`);
      } finally {
        // Clean up temp files
        try {
          fs.rmSync(tmpDir, { recursive: true });
        } catch {}
      }
    }
  }

  if (modified) {
    fs.writeFileSync(fullPath, JSON.stringify(raw));
    console.log(`\nArtifact updated: ${fullPath}`);
  } else {
    console.log('\nNo changes needed.');
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
