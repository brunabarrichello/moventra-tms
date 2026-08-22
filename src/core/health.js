export const PRODUCT_NAME = 'Moventra TMS';
export const SERVICE_NAME = 'moventra-api';

export function getHealthSnapshot(version = process.env.APP_VERSION ?? 'development') {
  return Object.freeze({
    status: 'ok',
    product: PRODUCT_NAME,
    service: SERVICE_NAME,
    version,
  });
}
