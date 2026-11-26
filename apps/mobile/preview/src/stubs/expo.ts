// Preview only: the few Expo calls the screens make directly.
export const reloadAppAsync = () => Promise.resolve();
export const StatusBar = () => null;
export const getRandomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
export const createURL = (path: string) => `hermit://${path}`;
export const openURL = () => Promise.resolve();
export const useURL = () => null;
export const parse = (url: string) => ({ path: url, queryParams: {} });
export const addEventListener = () => ({ remove() {} });
export const getInitialURL = () => Promise.resolve(null);
