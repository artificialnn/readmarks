// Test setup: a throwaway "agent" signing key, the key directories the dev server should trust, an empty transcript fixture file.
import crypto from 'node:crypto'; import fs from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const jwk = publicKey.export({ format: 'jwk' });
fs.writeFileSync(dir + 'agent-key.json', JSON.stringify({ jwk, pkcs8: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') }));
fs.writeFileSync(dir + 'transcripts.json', '{}');
const D = '/.well-known/http-message-signatures-directory';
process.stdout.write(JSON.stringify({ ['https://chatgpt.com' + D]: [jwk], ['https://agent.bot.goog' + D]: [jwk], ['https://unregistered-agent.example' + D]: [jwk] }));
