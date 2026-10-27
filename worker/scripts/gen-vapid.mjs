// Генерирует пару VAPID-ключей для Web Push.
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
const jwk = await crypto.subtle.exportKey('jwk', privateKey);
console.log('VAPID_PUBLIC_KEY  (в wrangler.toml):\n' + b64u(pub));
console.log('\nVAPID_PRIVATE_KEY (в секрет: npx wrangler secret put VAPID_PRIVATE_KEY):\n' + jwk.d);
