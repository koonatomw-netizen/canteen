interface MenuInput { name: string; default_shelf_life_days: number; notes: string; }

export function parseMenuInput(input: { name: string; default_shelf_life_days: string; notes: string }): MenuInput | null {
  const name = input.name.trim();
  const notes = input.notes.trim();
  const shelfLife = Number(input.default_shelf_life_days);
  if (!name || name.length > 100 || notes.length > 2000
    || !input.default_shelf_life_days.trim()
    || !Number.isInteger(shelfLife) || shelfLife < 1 || shelfLife > 30) return null;
  return { name, default_shelf_life_days: shelfLife, notes };
}
