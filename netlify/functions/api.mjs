import { getStore } from '@netlify/blobs';
import { createHandler } from '../lib/api.mjs';

export const config = { path: '/api/*' };

export default async (req, context) => {
  const handle = createHandler({
    env: process.env,
    blobs: getStore({ name: 'aimsir-data', consistency: 'strong' }),
  });
  return handle(req, context);
};
