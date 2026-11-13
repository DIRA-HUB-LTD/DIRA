// Set (or reset) a teacher's sign-in PIN.
//   npm run teacher:pin -- --teacher T001 --pin 4821
// Until the admin dashboard exists, a school administrator runs this.
import pg from "pg";
import { hashPin, isValidPin } from "../lib/auth/pin";

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
  const teacherId = arg("teacher")?.trim();
  const pin = arg("pin")?.trim();
  if (!teacherId || !pin || !isValidPin(pin)) {
    console.error("Usage: npm run teacher:pin -- --teacher <teacher_id> --pin <4-8 digits>");
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
      "UPDATE teachers SET pin_hash = $2 WHERE teacher_id = $1 RETURNING display_name",
      [teacherId, hashPin(pin)],
    );
    if (result.rowCount === 0) {
      console.error(`No teacher with id ${teacherId}.`);
      process.exit(1);
    }
    console.log(`PIN set for ${result.rows[0].display_name} (${teacherId}).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
