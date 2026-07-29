export interface ServiceAddress {
  street1: string;
  city: string;
  province: string;
  postalCode: string;
  country: "US";
}

export interface PublicBookingCustomer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
}

export type PublicBookingCustomerValidation =
  | {
    ok: true;
    customer: PublicBookingCustomer;
    address: ServiceAddress;
  }
  | {
    ok: false;
    code:
      | "INVALID_CUSTOMER_NAME"
      | "INVALID_CUSTOMER_EMAIL"
      | "INVALID_CUSTOMER_PHONE"
      | "INCOMPLETE_SERVICE_ADDRESS"
      | "OUTSIDE_DFW_STATE";
    message: string;
  };

export interface JobberPropertyCandidate {
  id: string;
  address?: {
    street?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
  } | null;
}

function normalizeWords(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function comparable(value: string | null | undefined): string {
  return normalizeWords(value ?? "")
    .toLowerCase()
    .replace(/[.,#]/g, "")
    .replace(/\s+/g, " ");
}

export function parseServiceAddress(rawAddress: string): ServiceAddress | null {
  const parts = rawAddress.split(",").map(normalizeWords).filter(Boolean);
  if (parts.length !== 3) return null;

  const [street1, city, stateZip] = parts;
  const stateZipMatch = stateZip.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (
    !street1 ||
    !/\d/.test(street1) ||
    city.length < 2 ||
    !stateZipMatch
  ) {
    return null;
  }

  return {
    street1,
    city,
    province: stateZipMatch[1].toUpperCase(),
    postalCode: stateZipMatch[2],
    country: "US",
  };
}

export function normalizeUsPhone(rawPhone: string): string | null {
  const trimmed = rawPhone.trim();
  if (!trimmed || /[A-Za-z]/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function validatePublicBookingCustomer(
  raw: Partial<PublicBookingCustomer> | null | undefined,
): PublicBookingCustomerValidation {
  const firstName = normalizeWords(raw?.firstName ?? "");
  const lastName = normalizeWords(raw?.lastName ?? "");
  if (!firstName || !lastName || firstName.length > 50 || lastName.length > 50) {
    return {
      ok: false,
      code: "INVALID_CUSTOMER_NAME",
      message: "Please provide your first and last name.",
    };
  }

  const email = (raw?.email ?? "").trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return {
      ok: false,
      code: "INVALID_CUSTOMER_EMAIL",
      message: "Please provide a valid email address.",
    };
  }

  const phone = normalizeUsPhone(raw?.phone ?? "");
  if (!phone) {
    return {
      ok: false,
      code: "INVALID_CUSTOMER_PHONE",
      message: "Please provide a valid 10-digit US phone number.",
    };
  }

  const address = parseServiceAddress(raw?.address ?? "");
  if (!address) {
    return {
      ok: false,
      code: "INCOMPLETE_SERVICE_ADDRESS",
      message: "Please provide the full service street address, city, state, and ZIP code.",
    };
  }
  if (address.province !== "TX") {
    return {
      ok: false,
      code: "OUTSIDE_DFW_STATE",
      message: "Online booking is currently available only for eligible DFW, Texas addresses.",
    };
  }

  return {
    ok: true,
    customer: {
      firstName,
      lastName,
      email,
      phone,
      address: `${address.street1}, ${address.city}, ${address.province} ${address.postalCode}`,
    },
    address,
  };
}

export function findMatchingJobberProperty(
  expected: ServiceAddress,
  candidates: JobberPropertyCandidate[],
): JobberPropertyCandidate | null {
  const expectedPostal = expected.postalCode.slice(0, 5);
  return candidates.find((candidate) => {
    const address = candidate.address;
    if (!candidate.id || !address) return false;
    return (
      comparable(address.street) === comparable(expected.street1) &&
      comparable(address.city) === comparable(expected.city) &&
      comparable(address.province) === comparable(expected.province) &&
      comparable(address.postalCode).slice(0, 5) === expectedPostal
    );
  }) ?? null;
}
