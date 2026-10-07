'use strict';
/**
 * Senha do painel e da tela Configurações (opcionais, no config.json).
 * Depois de entrar, o navegador guarda um cookie assinado (30 dias no painel, 12 h nas Configurações).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadSecret(dataDir) {
  const file = path.join(dataDir, 'segredo.key');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch (e) { /* cria abaixo */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, s + '\n', {mode: 0o600});
  return s;
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function sameText(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

class Auth {
  constructor(cfg) {
    this.cfg = cfg;
    this.secret = loadSecret(cfg.dataDir);
    this.attempts = new Map();
  }
  sign(scope, exp, pwd) {
    // A senha entra na assinatura: trocar a senha no config.json derruba os acessos antigos.
    return crypto.createHmac('sha256', this.secret).update(scope + '.' + exp + '.' + crypto.createHash('sha256').update(String(pwd)).digest('hex')).digest('hex');
  }
  token(scope, pwd, hours) {
    const exp = Date.now() + hours * 3600 * 1000;
    return exp + '.' + this.sign(scope, exp, pwd);
  }
  valid(req, scope, pwd) {
    if (!pwd) return true;
    const v = parseCookies(req)['jt_' + scope];
    if (!v) return false;
    const i = v.indexOf('.');
    const exp = Number(v.slice(0, i));
    if (!(exp > Date.now())) return false;
    return sameText(v.slice(i + 1), this.sign(scope, exp, pwd));
  }
  cookie(scope, pwd, hours, secure) {
    return 'jt_' + scope + '=' + this.token(scope, pwd, hours) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.round(hours * 3600) +
      (secure ? '; Secure' : '');
  }
  /** Limita tentativas de senha: 8 por minuto por endereço. */
  allowAttempt(ip) {
    const now = Date.now();
    const list = (this.attempts.get(ip) || []).filter(t => now - t < 60000);
    list.push(now);
    this.attempts.set(ip, list);
    if (this.attempts.size > 5000) this.attempts.clear();
    return list.length <= 8;
  }
  check(pwd, typed) { return !!pwd && sameText(pwd, typed); }
}

/** Pedido feito no próprio computador do servidor (e não repassado por um proxy/túnel). */
function isLocal(req) {
  if (req.headers['x-forwarded-for'] || req.headers.forwarded || req.headers['x-real-ip']) return false;
  const a = String(req.socket.remoteAddress || '');
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

module.exports = {Auth, isLocal, parseCookies};
