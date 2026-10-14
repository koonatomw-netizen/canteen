export type StockRecordMode = 'waste' | 'stock-out';

export function getStockRecordMode(closingStatus: string | null): StockRecordMode {
  return closingStatus === 'closed' ? 'stock-out' : 'waste';
}
