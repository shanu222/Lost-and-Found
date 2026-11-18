import request from 'supertest';
import { createApp } from '../src/app.js';

export const app = createApp();

/** Signs in with phone OTP and returns { agent, token, user }. */
export async function signIn(phone, countryCode, language = 'en') {
  const agent = request.agent(app);
  const sent = await agent.post('/api/auth/otp/request').send({ phone, countryCode, language }).expect(200);
  const res = await agent.post('/api/auth/otp/verify').send({ phone, countryCode, code: sent.body.devCode, language });
  if (res.status >= 300) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, token: res.body.accessToken, user: res.body.user, status: res.status };
}

export const auth = (token) => ({ Authorization: `Bearer ${token}` });

let counter = 0;
/** A fresh, valid, unique phone number for the given country. */
export function freshPhone(cc) {
  counter += 1;
  const n = String(1000000 + counter * 37 + Math.floor(Math.random() * 30)).slice(-7);
  return { PK: `+92300${n}`, GB: `+447700${n.slice(-6)}`, AE: `+97150${n}`, US: `+1212555${n.slice(-4)}` }[cc];
}
