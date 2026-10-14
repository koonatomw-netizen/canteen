import { describe, expect, it } from 'vitest';
import {
  defaultMonthlyEndDate,
  normalizeGymPassInput,
  normalizeVoucherInput,
  suggestCouponColor,
  suggestedVoucherAmount,
  validateGymPassInput,
  validateVoucherInput,
  type GymPassInput,
  type VoucherInput,
} from './colivingModel';

const voucher: VoucherInput = {
  issue_date: '2026-10-14', guest_type: 'Outside Customer', coupon_color: 'green',
  quantity: 5, amount_thb: 850, payment_status: 'paid', complimentary_reason: null,
  recipient: '', notes: '',
};

const gym: GymPassInput = {
  issue_date: '2026-10-14', guest_type: 'Coliving', pass_type: 'monthly', quantity: 1,
  amount_thb: 1200, start_date: '2026-10-14', end_date: '2026-11-14', recipient: '', notes: '',
};

describe('Co-living tracking rules', () => {
  it('suggests coupon color by guest type while leaving color override to the form', () => {
    expect(suggestCouponColor('Outside Customer')).toBe('green');
    expect(suggestCouponColor('Event')).toBe('orange');
  });

  it('uses the documented Green package amounts and Orange per-voucher price', () => {
    expect([1, 5, 15, 30].map((quantity) => suggestedVoucherAmount('green', quantity))).toEqual([180, 850, 2250, 3960]);
    expect(suggestedVoucherAmount('orange', 3)).toBe(330);
    expect(suggestedVoucherAmount('green', 2)).toBe(360);
  });

  it('defaults monthly validity to one calendar month and clamps month ends', () => {
    expect(defaultMonthlyEndDate('2026-10-14')).toBe('2026-11-14');
    expect(defaultMonthlyEndDate('2026-01-31')).toBe('2026-02-28');
    expect(defaultMonthlyEndDate('2024-01-31')).toBe('2024-02-29');
    expect(defaultMonthlyEndDate('2026-02-30')).toBe('');
  });

  it('accepts real voucher issues with no recipient and no expiry field', () => {
    expect(validateVoucherInput(voucher)).toBeNull();
    expect(normalizeVoucherInput(voucher).recipient).toBeNull();
  });

  it('requires a zero amount and reason for complimentary vouchers', () => {
    expect(validateVoucherInput({ ...voucher, payment_status: 'complimentary', amount_thb: 0, complimentary_reason: '' })).toContain('reason');
    expect(validateVoucherInput({ ...voucher, payment_status: 'complimentary', amount_thb: 180, complimentary_reason: 'Owner guest' })).toContain('0 THB');
    expect(validateVoucherInput({ ...voucher, payment_status: 'complimentary', amount_thb: 0, complimentary_reason: 'Owner guest' })).toBeNull();
    expect(normalizeVoucherInput({ ...voucher, payment_status: 'complimentary', amount_thb: 0, complimentary_reason: ' Owner guest ' }).complimentary_reason).toBe('Owner guest');
  });

  it('requires a valid monthly date range and clears dates from day passes', () => {
    expect(validateGymPassInput(gym)).toBeNull();
    expect(validateGymPassInput({ ...gym, end_date: '2026-10-13' })).toContain('on or after');
    const dayPass = normalizeGymPassInput({ ...gym, pass_type: 'day' });
    expect(dayPass.start_date).toBeNull();
    expect(dayPass.end_date).toBeNull();
    expect(validateGymPassInput(dayPass)).toBeNull();
  });
});
