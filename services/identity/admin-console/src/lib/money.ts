const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });

export function koboToNairaDisplay(kobo: number): string {
  return naira.format(kobo / 100);
}

export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}
