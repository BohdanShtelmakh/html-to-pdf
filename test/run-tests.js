const tests = [require('./smoke.test'), require('./pagination.test'), require('./links.test')];

async function main() {
  for (const t of tests) {
    const name = t.name || t.run?.name || 'test';
    await t.run();
    console.log(`ok - ${name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
