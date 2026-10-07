export type ExpiryStatus = 'normal' | 'tomorrow' | 'today' | 'expired';

export interface BatchMovement {
  quantity_delta: number;
  business_date: string;
}

export interface ClosingResult {
  expected: number;
  physical: number;
  sold: number;
  adjustment: number;
  difference: number;
}

export function getExpiryStatus(expiryDate: string, today: string): ExpiryStatus {
  if (expiryDate < today) return 'expired';
  if (expiryDate === today) return 'today';
  const tomorrow = new Date(`${today}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowDate = tomorrow.toISOString().slice(0, 10);
  return expiryDate === tomorrowDate ? 'tomorrow' : 'normal';
}

export function getBatchBalance(movements: BatchMovement[], asOfDate?: string): number {
  return movements.reduce(
    (total, movement) => total + (asOfDate && movement.business_date > asOfDate ? 0 : movement.quantity_delta),
    0,
  );
}

export function calculateClosing(expected: number, physical: number): ClosingResult {
  const difference = physical - expected;
  return {
    expected,
    physical,
    sold: Math.max(0, -difference),
    adjustment: Math.max(0, difference),
    difference,
  };
}

export function hasNegativeStock(movement: BatchMovement[], asOfDate?: string): boolean {
  return getBatchBalance(movement, asOfDate) < 0;
}
