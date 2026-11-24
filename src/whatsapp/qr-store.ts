let latestQr: string | undefined;

export const setLatestQr = (qr: string): void => {
  latestQr = qr;
};

export const getLatestQr = (): string | undefined => latestQr;

export const clearLatestQr = (): void => {
  latestQr = undefined;
};
