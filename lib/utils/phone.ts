/**
 * Build an international (E.164) number from a country code and the number as people
 * write it locally. Spaces, dashes, brackets and a leading trunk 0 are allowed; so is
 * typing the full number with its country code. Shared by the browser form (instant
 * feedback) and the server (which always checks again).
 */
export type PhoneCheck = { ok: true; e164: string } | { ok: false; message: string };

export function normalisePhone(countryCode: string, localNumber: string): PhoneCheck {
  const code = countryCode.replace(/[^\d]/g, "");
  if (!/^[1-9]\d{0,2}$/.test(code)) {
    return { ok: false, message: "Choose a country code, for example +254 for Kenya." };
  }
  const raw = localNumber.trim();
  if (!raw) return { ok: false, message: "Enter the phone number to call." };
  if (/[^\d\s()+-]/.test(raw)) {
    return { ok: false, message: "A phone number can only contain digits." };
  }
  let digits = raw.replace(/[^\d]/g, "");
  if (raw.startsWith("+") || (digits.startsWith(code) && digits.length > code.length + 6)) {
    if (!digits.startsWith(code)) {
      return { ok: false, message: `That number starts with a different country code from +${code}.` };
    }
    digits = digits.slice(code.length);
  }
  digits = digits.replace(/^0+/, "");
  if (code === "254" && !/^[17]\d{8}$/.test(digits)) {
    return {
      ok: false,
      message: "A Kenyan number has 9 digits after +254 and starts with 7 or 1, for example 0712 345 678.",
    };
  }
  const total = code.length + digits.length;
  if (digits.length < 6 || total < 8 || total > 15) {
    return { ok: false, message: "That number is too short or too long for an international phone number." };
  }
  return { ok: true, e164: `+${code}${digits}` };
}
