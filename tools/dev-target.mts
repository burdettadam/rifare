console.error('TARGET_STACK_NOT_QUALIFIED: PostgreSQL and React dependency installation, lockfile, build, network isolation and connected tests remain required.');
console.error('No automatic fallback occurs. To run only the isolated synthetic SQLite diagnostic profile: npm run dev:smoke');
process.exitCode = 2;
