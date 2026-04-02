const tests = [
  require('./smoke.test'),
  require('./pagination.test'),
  require('./links.test'),
  require('./tables.test'),
  require('./images.test'),
  require('./layout.test'),
  require('./css.test'),
  require('./blockquote.test'),
  require('./validation.test'),
  require('./fonts.test'),
  require('./elements.test'),
];

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
