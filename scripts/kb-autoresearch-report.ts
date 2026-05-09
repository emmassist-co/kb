import { renderAutoresearchReport, renderAutoresearchStatus, renderAutoresearchSummary } from '../packages/kb-autoresearch/src/report.js';

function main() {
  const [arg0, arg1] = process.argv.slice(2);
  if (arg0 === '--summary') {
    process.stdout.write(renderAutoresearchSummary(process.cwd()));
    return;
  }
  if (arg0 === '--status') {
    process.stdout.write(renderAutoresearchStatus(process.cwd()));
    return;
  }
  const runId = arg0 ?? arg1;
  process.stdout.write(renderAutoresearchReport(process.cwd(), runId));
}

main();
