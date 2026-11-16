// Parsing and validation for a school's data upload. Pure functions: no database, no
// Next.js, so they are unit-tested directly. DIRA_HUB_ROADMAP.md §6 describes the sheets.
//
//   staff.csv      full_name, email, role (teacher | admin; default teacher)
//   learners.csv   admission_number, full_name, grade, stream
//   timetable.csv  teacher_email, grade, stream, weekday, period, start, end, subject

export const MAX_ROWS_PER_FILE = 5_000;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface RowError {
  file: "staff" | "learners" | "timetable";
  /** 1-based spreadsheet row number, counting the header as row 1. 0 means the whole file. */
  row: number;
  message: string;
}

export interface StaffRow {
  row: number;
  full_name: string;
  email: string;
  role: "admin" | "teacher";
}
export interface LearnerRow {
  row: number;
  admission_number: string;
  full_name: string;
  grade: string;
  stream: string;
}
export interface TimetableRow {
  row: number;
  teacher_email: string;
  grade: string;
  stream: string;
  weekday: number;
  period: number;
  start: string;
  end: string;
  subject: string;
}

export interface ParsedSchoolImport {
  staff: StaffRow[];
  learners: LearnerRow[];
  timetable: TimetableRow[];
  errors: RowError[];
}

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF or LF, optional BOM. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Turn a parsed sheet into objects keyed by header. Reports missing required columns once. */
function toRecords(
  file: RowError["file"],
  text: string,
  required: string[],
  errors: RowError[],
): { row: number; values: Record<string, string> }[] {
  if (text.trim() === "") return [];
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map(normaliseHeader);
  const missing = required.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    errors.push({ file, row: 0, message: `Missing column(s): ${missing.join(", ")}` });
    return [];
  }
  if (rows.length - 1 > MAX_ROWS_PER_FILE) {
    errors.push({ file, row: 0, message: `Too many rows (the limit is ${MAX_ROWS_PER_FILE})` });
    return [];
  }
  return rows.slice(1).map((cells, index) => ({
    row: index + 2,
    values: Object.fromEntries(headers.map((header, column) => [header, (cells[column] ?? "").trim()])),
  }));
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const WEEKDAYS: Record<string, number> = {
  mon: 1, monday: 1, "1": 1,
  tue: 2, tues: 2, tuesday: 2, "2": 2,
  wed: 3, wednesday: 3, "3": 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, "4": 4,
  fri: 5, friday: 5, "5": 5,
};

function normaliseTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function parseSchoolImport(files: {
  staff?: string;
  learners?: string;
  timetable?: string;
}): ParsedSchoolImport {
  const errors: RowError[] = [];
  const staff: StaffRow[] = [];
  const learners: LearnerRow[] = [];
  const timetable: TimetableRow[] = [];

  const seenEmails = new Set<string>();
  for (const { row, values } of toRecords("staff", files.staff ?? "", ["full_name", "email"], errors)) {
    const email = normaliseEmail(values.email);
    const role = (values.role || "teacher").toLowerCase();
    if (values.full_name.length < 2) {
      errors.push({ file: "staff", row, message: "Full name is missing" });
    } else if (!EMAIL.test(email)) {
      errors.push({ file: "staff", row, message: `"${values.email}" is not a valid email` });
    } else if (role !== "teacher" && role !== "admin") {
      errors.push({ file: "staff", row, message: `Role must be teacher or admin, not "${values.role}"` });
    } else if (seenEmails.has(email)) {
      errors.push({ file: "staff", row, message: `${email} appears more than once` });
    } else {
      seenEmails.add(email);
      staff.push({ row, full_name: values.full_name, email, role });
    }
  }

  const seenAdmissions = new Set<string>();
  for (const { row, values } of toRecords(
    "learners",
    files.learners ?? "",
    ["admission_number", "full_name", "grade", "stream"],
    errors,
  )) {
    if (!values.admission_number) {
      errors.push({ file: "learners", row, message: "Admission number is missing" });
    } else if (values.full_name.length < 2) {
      errors.push({ file: "learners", row, message: "Full name is missing" });
    } else if (!values.grade || !values.stream) {
      errors.push({ file: "learners", row, message: "Grade and stream are both required" });
    } else if (seenAdmissions.has(values.admission_number)) {
      errors.push({
        file: "learners",
        row,
        message: `Admission number ${values.admission_number} appears more than once (a learner can be in only one class)`,
      });
    } else {
      seenAdmissions.add(values.admission_number);
      learners.push({
        row,
        admission_number: values.admission_number,
        full_name: values.full_name,
        grade: values.grade,
        stream: values.stream,
      });
    }
  }

  const seenSlots = new Set<string>();
  for (const { row, values } of toRecords(
    "timetable",
    files.timetable ?? "",
    ["teacher_email", "grade", "stream", "weekday", "period", "start", "end", "subject"],
    errors,
  )) {
    const email = normaliseEmail(values.teacher_email);
    const weekday = WEEKDAYS[values.weekday.toLowerCase()];
    const period = Number(values.period);
    const start = normaliseTime(values.start);
    const end = normaliseTime(values.end);
    if (!EMAIL.test(email)) {
      errors.push({ file: "timetable", row, message: `"${values.teacher_email}" is not a valid teacher email` });
    } else if (!values.grade || !values.stream || !values.subject) {
      errors.push({ file: "timetable", row, message: "Grade, stream and subject are all required" });
    } else if (!weekday) {
      errors.push({ file: "timetable", row, message: `Weekday must be Mon to Fri, not "${values.weekday}"` });
    } else if (!Number.isInteger(period) || period < 1) {
      errors.push({ file: "timetable", row, message: "Period must be a whole number from 1" });
    } else if (!start || !end) {
      errors.push({ file: "timetable", row, message: "Start and end must be times like 08:00" });
    } else if (end <= start) {
      errors.push({ file: "timetable", row, message: "End time must be after the start time" });
    } else {
      const slot = [values.grade, values.stream, weekday, period].join("|").toLowerCase();
      if (seenSlots.has(slot)) {
        errors.push({
          file: "timetable",
          row,
          message: `${values.grade} ${values.stream} already has a lesson in period ${period} on that day`,
        });
      } else {
        seenSlots.add(slot);
        timetable.push({
          row,
          teacher_email: email,
          grade: values.grade,
          stream: values.stream,
          weekday,
          period,
          start,
          end,
          subject: values.subject,
        });
      }
    }
  }

  return { staff, learners, timetable, errors };
}

export const TEMPLATES = {
  staff: "full_name,email,role\nGrace Wanjiku,grace@yourschool.example,teacher\n",
  learners: "admission_number,full_name,grade,stream\n1042,Amani Otieno,Grade 4,A\n",
  timetable:
    "teacher_email,grade,stream,weekday,period,start,end,subject\ngrace@yourschool.example,Grade 4,A,Mon,1,08:00,08:40,Mathematics\n",
} as const;
