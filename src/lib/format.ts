import { formatBusinessDate } from './dates';

const baht = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'THB', maximumFractionDigits: 2 });

export function formatQuantity(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatBaht(value: number | string): string {
  return baht.format(Number(value) || 0);
}

export function formatDate(value: string): string {
  return formatBusinessDate(value);
}

export function formatFoodVariant(menuName: string | null | undefined, meatName?: string | null): string {
  const menu = menuName?.trim() || 'Food item';
  return meatName?.trim() ? `${menu} · ${meatName.trim()}` : menu;
}
