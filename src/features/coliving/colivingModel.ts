export const guestTypes = [
  'Coliving',
  'Residency',
  'Longevity',
  'Outside Customer',
  '4Seas Community Member',
  'Event',
  'Free Residency Project',
] as const;

export type GuestType = (typeof guestTypes)[number];
export type CouponColor = 'green' | 'orange';
export type PaymentStatus = 'paid' | 'complimentary';
export type GymPassType = 'day' | 'monthly';

export const greenPackages = [
  { quantity: 1, amount: 180 },
  { quantity: 5, amount: 850 },
  { quantity: 15, amount: 2250 },
  { quantity: 30, amount: 3960 },
] as const;

export function suggestCouponColor(guestType: GuestType): CouponColor {
  return guestType === 'Outside Customer' ? 'green' : 'orange';
}

export function suggestedVoucherAmount(color: CouponColor, quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1) return 0;
  if (color === 'orange') return quantity * 110;
  return greenPackages.find((item) => item.quantity === quantity)?.amount ?? quantity * 180;
}

export function defaultMonthlyEndDate(startDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const source = new Date(Date.UTC(year, month - 1, day));
  if (source.getUTCFullYear() !== year || source.getUTCMonth() !== month - 1 || source.getUTCDate() !== day) return '';
  const targetMonthIndex = year * 12 + month;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export interface VoucherInput {
  issue_date: string;
  guest_type: GuestType;
  coupon_color: CouponColor;
  quantity: number;
  amount_thb: number;
  payment_status: PaymentStatus;
  complimentary_reason: string | null;
  recipient: string | null;
  notes: string | null;
}

export interface GymPassInput {
  issue_date: string;
  guest_type: GuestType;
  pass_type: GymPassType;
  quantity: number;
  amount_thb: number;
  start_date: string | null;
  end_date: string | null;
  recipient: string | null;
  notes: string | null;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validAmount(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 9_999_999_999.99
    && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
}

function validQuantity(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 100_000;
}

function cleanOptional(value: string): string | null {
  return value.trim() || null;
}

export function validateVoucherInput(input: VoucherInput): string | null {
  if (!validDate(input.issue_date)) return 'Enter a valid issue date.';
  if (!guestTypes.includes(input.guest_type)) return 'Choose a guest type.';
  if (!['green', 'orange'].includes(input.coupon_color)) return 'Choose a coupon color.';
  if (!validQuantity(input.quantity)) return 'Quantity must be a whole number above zero.';
  if (!validAmount(input.amount_thb)) return 'Amount must be zero or a valid THB amount.';
  if (input.payment_status === 'complimentary') {
    if (input.amount_thb !== 0) return 'Complimentary vouchers must have an actual amount of 0 THB.';
    if (!input.complimentary_reason?.trim()) return 'Enter a reason for complimentary vouchers.';
  }
  if (input.payment_status === 'paid' && input.complimentary_reason) return 'Remove the complimentary reason for a paid issue.';
  return null;
}

export function validateGymPassInput(input: GymPassInput): string | null {
  if (!validDate(input.issue_date)) return 'Enter a valid issue date.';
  if (!guestTypes.includes(input.guest_type)) return 'Choose a guest type.';
  if (!['day', 'monthly'].includes(input.pass_type)) return 'Choose a gym pass type.';
  if (!validQuantity(input.quantity)) return 'Quantity must be a whole number above zero.';
  if (!validAmount(input.amount_thb)) return 'Amount must be zero or a valid THB amount.';
  if (input.pass_type === 'monthly') {
    if (!input.start_date || !input.end_date || !validDate(input.start_date) || !validDate(input.end_date)) return 'Enter the monthly pass start and end dates.';
    if (input.end_date < input.start_date) return 'The end date must be on or after the start date.';
  } else if (input.start_date || input.end_date) {
    return 'Day passes do not need a validity date range.';
  }
  return null;
}

export function normalizeVoucherInput(input: VoucherInput): VoucherInput {
  return {
    ...input,
    complimentary_reason: input.payment_status === 'complimentary' ? cleanOptional(input.complimentary_reason ?? '') : null,
    recipient: cleanOptional(input.recipient ?? ''),
    notes: cleanOptional(input.notes ?? ''),
  };
}

export function normalizeGymPassInput(input: GymPassInput): GymPassInput {
  return {
    ...input,
    start_date: input.pass_type === 'monthly' ? input.start_date : null,
    end_date: input.pass_type === 'monthly' ? input.end_date : null,
    recipient: cleanOptional(input.recipient ?? ''),
    notes: cleanOptional(input.notes ?? ''),
  };
}
