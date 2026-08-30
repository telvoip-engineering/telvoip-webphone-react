import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";

/** Built-in output formats for normalized phone numbers. */
export type DialTargetFormat = "preserve" | "national" | "e164";

/** A value accepted by startCall(). Country uses ISO 3166-1 alpha-2 codes. */
export interface DialTargetInput {
  number: string;
  country?: CountryCode;
}

export type DialTargetFormatter = (target: DialTargetInput) => string;

export const toDialTargetInput = (target: string | DialTargetInput): DialTargetInput =>
  typeof target === "string" ? { number: target } : target;

/**
 * Normalizes a phone number using libphonenumber-js. Explicit `+` numbers
 * carry their own country; local numbers use `country` then `defaultCountry`.
 * Extensions and numbers that cannot be parsed are preserved rather than
 * rejected, so a PBX's own extension dialing continues to work.
 */
export const formatDialTarget = (
  target: string | DialTargetInput,
  {
    format = "preserve",
    defaultCountry,
  }: { format?: DialTargetFormat; defaultCountry?: CountryCode } = {}
): string => {
  const input = toDialTargetInput(target);
  const raw = input.number.trim();
  if (format === "preserve" || !raw) return raw;

  const phone = parsePhoneNumberFromString(raw, input.country || defaultCountry);
  if (!phone?.isValid()) return raw;
  if (format === "e164") return phone.number;

  // `formatNational()` deliberately includes presentation spaces/punctuation.
  // SIP/PBX dialplans conventionally expect the compact national digits.
  return phone.formatNational().replace(/\D/g, "");
};

/** Convenience formatter for integrations that always dial nationally. */
export const createDialTargetFormatter = (
  format: DialTargetFormat,
  defaultCountry?: CountryCode
): DialTargetFormatter => (target) => formatDialTarget(target, { format, defaultCountry });
