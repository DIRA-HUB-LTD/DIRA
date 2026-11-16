// Set the phone number (and record voice consent) that after-lesson calls go to.
//   npm run teacher:phone -- --to +2547XXXXXXXX                 every teacher
//   npm run teacher:phone -- --to +2547XXXXXXXX --school SCH001 one workspace
//   npm run teacher:phone -- --to +2547XXXXXXXX --teacher T001  one teacher
// Real-mode dispatch only claims jobs for teachers with both phone_e164 and
// voice_consent_at set, so a teacher without them is never called.
// Uses DATABASE_URL from .env.local (or the environment). The number is never
// stored anywhere but the database.
import pg from "pg";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // optional
    }
  }
  const to = arg("to")?.trim();
  const teacherId = arg("teacher")?.trim();
  const schoolId = arg("school")?.trim();
  if (!to || !/^\+[1-9]\d{7,14}$/.test(to)) {
    console.error("Usage: npm run teacher:phone -- --to +<country><number> [--teacher <id> | --school <id>]");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      `UPDATE teachers
         SET phone_e164 = $1,
             voice_consent_at = COALESCE(voice_consent_at, NOW())
       WHERE ($2::text IS NULL OR teacher_id = $2)
         AND ($3::text IS NULL OR school_id = $3)
       RETURNING teacher_id, school_id`,
      [to, teacherId ?? null, schoolId ?? null],
    );
    if (result.rowCount === 0) {
      console.error("No matching teacher.");
      process.exit(1);
    }
    const schools = new Set(result.rows.map((row) => row.school_id));
    console.log(
      `Phone and consent set for ${result.rowCount} teacher(s) in ${schools.size} workspace(s), ending ${to.slice(-3)}.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
