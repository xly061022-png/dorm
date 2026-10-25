export function configFromEnv(env = process.env) {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT 必须是有效端口');
  return { port, host: '127.0.0.1', secure: env.NODE_ENV === 'production', trustProxy: 'loopback' };
}
