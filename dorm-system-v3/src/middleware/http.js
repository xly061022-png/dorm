import express from 'express';
import { fail } from '../domain.js';

// Same-origin application; nginx overwrites Host and forwarded headers.
// Only loopback proxies are trusted. No domain configuration is needed.
export function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('sec-fetch-site') === 'cross-site') fail('不允许跨站操作', 403);
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) fail('不允许跨站操作', 403);
  next();
}
export function securityHeaders(req, res, next) {
  res.set({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  });
  next();
}
export function jsonBody(limit = '16kb') {
  return [
    (req, res, next) => {
      if (!req.is('application/json')) fail('请求必须为JSON', 415);
      next();
    },
    express.json({ limit, strict: true }),
    (req, res, next) => {
      if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object')
        fail('数据格式错误');
      next();
    },
  ];
}
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const duplicate = String(error.message).includes('UNIQUE constraint failed');
  const status = error.status || (duplicate ? 409 : 500);
  const messages = { 'entity.parse.failed': 'JSON格式错误', 'entity.too.large': '上传数据过大' };
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: duplicate
      ? '名称已存在，请换一个名称'
      : messages[error.type] || (status < 500 ? error.message : '服务异常，请联系管理员'),
  });
}
