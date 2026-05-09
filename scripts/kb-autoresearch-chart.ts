import path from 'node:path';
import { writeAutoresearchChart } from '../packages/kb-autoresearch/src/chart.js';

function main() {
  const [arg0, arg1] = process.argv.slice(2);
  const runId = arg0 === '--run' ? arg1 : arg0;
  const outputPath = writeAutoresearchChart(process.cwd(), runId);
  console.log(`kb-autoresearch chart: ${path.relative(process.cwd(), outputPath)}`);
}

main();
